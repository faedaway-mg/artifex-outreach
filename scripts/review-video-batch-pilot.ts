// ─────────────────────────────────────────────────────────────────────────────
// Review Video Batch Pilot — local acceptance demo (Batch Pilot M1). Seeds a few NON-PRODUCTION leads,
// prepares a batch, and drives the job lifecycle to show the state model, the Lucas batch handoff (with
// id-bound filenames + safe matching), audio import (using the real Lucas MP3's duration for realism),
// the final render → review → private-approval gates, and the pilot event log. NOTHING is sent. All
// videos stay PRIVATE_ONLY. Run with tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { __resetStoreForTests } from "../src/lib/store";
import { insertLead, upsertBusinessIntelligence, allReviewVideoJobs, getLead } from "../src/lib/repo";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { prepareReviewVideoBatch, markVisualRendered, importJobAudio, markFinalRendered, approveReviewVideo, markDeliveryReady, failJob } from "../src/lib/review-video/batch";
import { buildLucasBatch, matchAudioToJobs, expectedAudioFilename } from "../src/lib/review-video/lucas-batch";
import { buildNarrationScript } from "../src/lib/content/narration";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { jobEvents, summarizePilot } from "../src/lib/review-video/measurement";
import { nextAction } from "../src/lib/review-video/job-state";

const CI = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"].map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s}</a>`).join("");
const rich = (h1: string) => `<body><h1>${h1}</h1><h2>Shop Our Collections</h2>${CI}<a href="/collections/test-old-home">t</a></body>`;
const LUCAS = "/Users/jordanjackson/.claude/uploads/9776a767-d87a-4115-939a-acf1d8f91a9a/14d6c6f6-Artifex_Labs__Urban_Americana__Voice_Over.mp3";
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());

async function seed(name: string, html: string, over: Record<string, unknown> = {}) {
  const lead = await insertLead({ ...(makeLead({ businessName: name, website: `https://${name.toLowerCase().replace(/\s+/g, "")}.com`, websiteDomain: `${name.toLowerCase().replace(/\s+/g, "")}.com`, rating: 4.8, reviewCount: 950, ...over }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html }] });
  if (over.oneFinding) bi.businessProfile.opportunities = [{ id: "o1", category: "Scheduling", observation: "The site has no online booking; reservations require a phone call.", whyItMatters: "After-hours demand slips away.", estimatedImpact: { level: "High", rationale: "Add booking." }, confidence: { label: "Observed", score: 0.95 }, basis: ["homepage HTML"] } as any];
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z" });
  return lead;
}

async function main() {
  __resetStoreForTests();
  const A = await seed("Urban Americana", rich("Urban Americana"));           // strong 3-finding
  const B = await seed("Long Beach Vintage", rich("Long Beach Vintage"));      // strong
  const C = await seed("Corner Cafe", "<body><h1>Corner Cafe</h1></body>", { oneFinding: true }); // weak → NEEDS_REVIEW
  const D = await seed("Broken Capture Co", rich("Broken Capture Co"));         // strong, but we'll fail its render

  console.log("── PREPARE BATCH (4 selected leads) ──");
  const prep = await prepareReviewVideoBatch([A.id, B.id, C.id, D.id], { batchId: "pilot-demo" });
  for (const r of prep) console.log(`  ${(await getLead(r.leadId))?.businessName?.padEnd(22) ?? r.leadId}  ${r.jobId ? r.status : "NOT_ELIGIBLE"}  readiness=${r.readiness?.readiness ?? "-"}  ${r.blockers.length ? "(" + r.blockers.join("; ") + ")" : ""}`);
  const jobId = (leadId: string) => prep.find((r) => r.leadId === leadId)?.jobId!;

  // Visual renders complete for the eligible jobs (simulated here — the CDP render is the real step).
  for (const id of [jobId(A.id), jobId(B.id), jobId(D.id)]) await markVisualRendered(id, { previewKey: `assets/${id}/preview.mp4` });
  // One job fails at render (isolated).
  await failJob(jobId(D.id), "capture", "screenshot capture failed");

  console.log("\n── LUCAS BATCH HANDOFF (jobs now needing voice) ──");
  const jobs = await allReviewVideoJobs();
  const { getBusinessIntelligence } = await import("../src/lib/repo");
  const handoff = buildLucasBatch(await Promise.all(jobs.map(async (j) => {
    const lead = await getLead(j.leadId);
    const bi = await getBusinessIntelligence(j.leadId);
    const review = buildQuickReview(lead!, (bi!.profile as any).businessProfile, cachedBrand((bi!.profile as any).businessProfile), {});
    return { job: j, businessName: lead!.businessName, copyBlock: buildNarrationScript(review).copyBlock };
  })));
  for (const h of handoff) console.log(`  ${h.businessName.padEnd(22)} target ${h.targetSeconds}s · ${h.narrationWords}w · file: ${h.expectedFilename}`);

  // Operator "returns from VEED" and drops files. One correctly named, plus a decoy to show safe matching.
  const lucasDur = existsSync(LUCAS) ? probe(LUCAS) : 58;
  const files = handoff.map((h) => h.expectedFilename).concat(["random-unlabeled.mp3"]);
  const match = matchAudioToJobs(files, handoff.map((h) => h.jobId));
  console.log(`\n── AUDIO IMPORT: ${match.matched.length} matched, ${match.ambiguous.length} ambiguous (refused), ${match.unmatchedJobs.length} unmatched ──`);
  for (const m of match.matched) { await importJobAudio(m.jobId, { audioKey: `assets/${m.jobId}/lucas.mp3`, durationSeconds: lucasDur }); }

  // Final renders complete (audio-master); operator reviews + approves one, leaves one for review.
  for (const m of match.matched) await markFinalRendered(m.jobId, { finalKey: `assets/${m.jobId}/final.mp4`, durationSeconds: lucasDur + 2.4 });
  await approveReviewVideo(jobId(A.id)); await markDeliveryReady(jobId(A.id));

  console.log("\n── BATCH STATUS BOARD ──");
  for (const j of await allReviewVideoJobs()) { const lead = await getLead(j.leadId); console.log(`  ${lead!.businessName.padEnd(22)} ${j.status.padEnd(18)} → ${nextAction(j.status)}${j.failure ? "  (" + j.failure.message + ")" : ""}`); }

  const allEvents: Array<{ action: string; meta?: any }> = [];
  for (const j of await allReviewVideoJobs()) allEvents.push(...(await jobEvents(j.id)));
  const sum = summarizePilot(allEvents.map((e) => ({ action: e.action, meta: (e as any).meta })));
  console.log("\n── PILOT SUMMARY ──", JSON.stringify({ prepared: sum.prepared, rendered: sum.rendered, approved: sum.approved, deliveryReady: sum.deliveryReady, sent: sum.sent }, null, 0));
  console.log("Lucas duration used:", lucasDur.toFixed(1) + "s  (real file:", existsSync(LUCAS) + ")");
  console.log("SAFETY: nothing sent; all jobs PRIVATE_ONLY.");
}
main().catch((e) => { console.error(e); process.exit(1); });
