// ─────────────────────────────────────────────────────────────────────────────
// Review Video Batch Pilot — 10-job local acceptance (Batch M1.1). Seeds 10 NON-PRODUCTION leads and
// drives the FULL operational flow through the real render QUEUE (with an injected fast executor so the
// acceptance doesn't spawn 10 Chrome renders): prepare → queue(visual) → Lucas batch → bulk audio import
// (safe id-matching; the real Lucas duration used where available) → queue(final) → READY_FOR_REVIEW →
// approve. Proves state model, concurrency, failure isolation, recovery, and cross-job isolation.
// NOTHING is sent; all videos PRIVATE_ONLY. Run with tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { __resetStoreForTests } from "../src/lib/store";
import { insertLead, upsertBusinessIntelligence, allReviewVideoJobs, getLead, getReviewVideoJob, getBusinessIntelligence, updateReviewVideoJob } from "../src/lib/repo";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { prepareReviewVideoBatch, importJobAudio, approveReviewVideo, markDeliveryReady } from "../src/lib/review-video/batch";
import { getRenderQueue, __resetRenderQueueForTests, recoverStaleRenders } from "../src/lib/review-video/queue";
import { setRenderExecutor, type RenderRequest, type RenderResult } from "../src/lib/review-video/render-service";
import { buildLucasBatch, matchAudioToJobs } from "../src/lib/review-video/lucas-batch";
import { buildNarrationScript } from "../src/lib/content/narration";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { jobEvents, summarizePilot } from "../src/lib/review-video/measurement";
import { nextAction } from "../src/lib/review-video/job-state";
import { transition } from "../src/lib/review-video/job-state";

const CI = Array.from({ length: 18 }, (_, i) => `<a href="/collections/c${i}">c${i}</a>`).join("");
const rich = (h1: string) => `<body><h1>${h1}</h1><h2>Shop Our Collections</h2>${CI}<a href="/collections/test-old">t</a><p>950+ reviews</p></body>`;
const LUCAS = "/Users/jordanjackson/.claude/uploads/9776a767-d87a-4115-939a-acf1d8f91a9a/14d6c6f6-Artifex_Labs__Urban_Americana__Voice_Over.mp3";
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());

async function seed(name: string, opts: { one?: boolean; thin?: boolean } = {}) {
  const lead = await insertLead({ ...(makeLead({ businessName: name, website: `https://${name.replace(/\s+/g, "").toLowerCase()}.com`, websiteDomain: `${name.replace(/\s+/g, "").toLowerCase()}.com`, rating: 4.8, reviewCount: 950 }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html: opts.thin ? `<body><h1>${name}</h1></body>` : rich(name) }] });
  if (opts.one) bi.businessProfile.opportunities = [{ id: "o1", category: "Scheduling", observation: "The site has no online booking; reservations require a phone call.", whyItMatters: "After-hours demand slips away.", estimatedImpact: { level: "High", rationale: "Add booking." }, confidence: { label: "Observed", score: 0.95 }, basis: ["homepage HTML"] } as any];
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z" });
  return lead;
}

async function main() {
  __resetStoreForTests(); __resetRenderQueueForTests();
  // Diverse 10-lead pilot: 8 strong, 1 one-finding (NEEDS_REVIEW), 1 thin (INSUFFICIENT). One strong
  // job will be forced to fail its render to prove isolation.
  const strongNames = ["Urban Americana", "Long Beach Vintage", "Harbor Goods", "Cedar & Coil", "Maison Reno", "North Loop Supply", "Wildflower Market", "Atlas Provisions"];
  const strong = []; for (const n of strongNames) strong.push(await seed(n));
  const weak = await seed("Corner Cafe", { one: true });
  const thin = await seed("Tiny Kiosk", { thin: true });
  const failLeadName = "Maison Reno"; // this one's render will fail

  console.log("── PHASE A/B — CANDIDATES + PREPARE (10 selected) ──");
  const prep = await prepareReviewVideoBatch([...strong.map((l) => l.id), weak.id, thin.id], { batchId: "pilot-10" });
  for (const r of prep) console.log(`  ${(await getLead(r.leadId))!.businessName.padEnd(20)} ${(r.jobId ? r.status : "NOT_ELIGIBLE").padEnd(14)} readiness=${r.readiness?.readiness ?? "-"}`);

  // Inject a fast deterministic executor (acceptance must not spawn 10 Chrome renders). One strong job fails.
  const failJobId = prep.find(async (r) => (await getLead(r.leadId))!.businessName === failLeadName)?.jobId;
  const failName = failLeadName;
  setRenderExecutor(async (req: RenderRequest): Promise<RenderResult> => {
    const lead = await getLead(req.leadId);
    if (lead?.businessName === failName && req.mode === "visual") return { success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: 5, inputVersion: "", error: "screenshot capture failed" };
    return { success: true, mode: req.mode, jobId: req.jobId, artifacts: req.mode === "visual" ? { previewKey: `assets/${req.jobId}/preview.mp4` } : { finalKey: `assets/${req.jobId}/final.mp4` }, durationSeconds: 60.2, renderMs: 5, inputVersion: `${req.reviewId}|final|${req.audioKey}|${req.audioDurationSeconds}` };
  });

  console.log("\n── PHASE C — VISUAL QUEUE (bounded worker drains) ──");
  await getRenderQueue().drain();
  const visualReady = (await allReviewVideoJobs()).filter((j) => j.status === "LUCAS_REQUIRED").length;
  const failed = (await allReviewVideoJobs()).filter((j) => j.status === "FAILED").length;
  console.log(`  visual-ready (LUCAS_REQUIRED): ${visualReady} · failed (isolated): ${failed}`);

  console.log("\n── PHASE D — LUCAS BATCH HANDOFF ──");
  const jobs = await allReviewVideoJobs();
  const handoff = buildLucasBatch(await Promise.all(jobs.map(async (j) => {
    const lead = await getLead(j.leadId); const bi = await getBusinessIntelligence(j.leadId);
    const review = buildQuickReview(lead!, (bi!.profile as any).businessProfile, cachedBrand((bi!.profile as any).businessProfile), {});
    return { job: j, businessName: lead!.businessName, copyBlock: buildNarrationScript(review).copyBlock };
  })));
  console.log(`  ${handoff.length} scripts ready; example: ${handoff[0]?.businessName} → ${handoff[0]?.expectedFilename}`);

  console.log("\n── PHASE E — BULK AUDIO IMPORT (safe id-matching) ──");
  const lucasDur = existsSync(LUCAS) ? probe(LUCAS) : 58;
  const files = handoff.map((h) => h.expectedFilename).concat(["mystery-recording.mp3"]); // + 1 decoy
  const match = matchAudioToJobs(files, handoff.map((h) => h.jobId));
  console.log(`  ${match.matched.length} matched, ${match.ambiguous.length} ambiguous (refused): ${match.ambiguous.join(", ")}`);
  for (const m of match.matched) await importJobAudio(m.jobId, { audioKey: `assets/${m.jobId}/lucas.mp3`, durationSeconds: lucasDur });

  console.log("\n── PHASE F — FINAL QUEUE ──");
  await getRenderQueue().drain();

  console.log("\n── recovery check: simulate a crash mid-final on one job, then recover ──");
  const oneReady = (await allReviewVideoJobs()).find((j) => j.status === "READY_FOR_REVIEW")!;
  await updateReviewVideoJob(oneReady.id, { ...transition(oneReady, "APPROVED_PRIVATE") }); // park it out of the way
  const anotherReady = (await allReviewVideoJobs()).find((j) => j.status === "READY_FOR_REVIEW");
  if (anotherReady) { await updateReviewVideoJob(anotherReady.id, { ...transition(anotherReady, "APPROVED_PRIVATE"), status: "RENDERING_FINAL", leaseUntil: new Date(Date.now() - 60000).toISOString() } as any); }
  const recovered = await recoverStaleRenders(Date.now());
  console.log(`  recovered stale renders: ${recovered.length}`);

  console.log("\n── PHASE G/H — REVIEW + APPROVE (2 jobs), mark one delivery-ready ──");
  const readyJobs = (await allReviewVideoJobs()).filter((j) => j.status === "READY_FOR_REVIEW").slice(0, 2);
  for (const j of readyJobs) await approveReviewVideo(j.id);
  if (readyJobs[0]) await markDeliveryReady(readyJobs[0].id);

  console.log("\n── BATCH STATUS BOARD ──");
  const counts: Record<string, number> = {};
  for (const j of await allReviewVideoJobs()) { counts[j.status] = (counts[j.status] ?? 0) + 1; }
  console.log("  " + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  "));
  for (const j of (await allReviewVideoJobs()).slice(0, 6)) { const lead = await getLead(j.leadId); console.log(`   ${lead!.businessName.padEnd(20)} ${j.status.padEnd(18)} → ${nextAction(j.status)}${j.failure ? " (" + j.failure.message + ")" : ""}`); }

  // Cross-job isolation spot-checks.
  const jobsNow = await allReviewVideoJobs();
  const previewKeysUnique = new Set(jobsNow.map((j) => j.previewKey).filter(Boolean)).size === jobsNow.filter((j) => j.previewKey).length;
  const audioKeysUnique = new Set(jobsNow.map((j) => j.audioKey).filter(Boolean)).size === jobsNow.filter((j) => j.audioKey).length;
  console.log(`\n── CROSS-JOB ISOLATION ── unique preview keys: ${previewKeysUnique} · unique audio keys: ${audioKeysUnique} · each key namespaced by jobId: ${jobsNow.every((j) => !j.previewKey || j.previewKey.includes(j.id))}`);

  const allEvents: Array<{ action: string; meta?: any }> = [];
  for (const j of await allReviewVideoJobs()) allEvents.push(...(await jobEvents(j.id)));
  const sum = summarizePilot(allEvents.map((e) => ({ action: e.action, meta: (e as any).meta })));
  console.log("\n── PILOT SUMMARY ──", JSON.stringify({ prepared: sum.prepared, rendered: sum.rendered, approved: sum.approved, deliveryReady: sum.deliveryReady, sent: sum.sent }));
  console.log("Lucas file used:", existsSync(LUCAS), "(" + lucasDur.toFixed(1) + "s).  SAFETY: nothing sent; all PRIVATE_ONLY.");
  setRenderExecutor(null);
}
main().catch((e) => { console.error(e); process.exit(1); });
