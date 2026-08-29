// ─────────────────────────────────────────────────────────────────────────────
// REAL Chrome/CDP acceptance for the generalized batch renderer (Batch M1.1 step 2). This is the
// mandatory proof that ONE renderer, driven from CANONICAL persisted lead state (stored Quick Review +
// sanitized surface package, NO re-crawl), renders arbitrary eligible leads through the batch + queue
// path with the DEFAULT (real) executor — not the injected fake. It seeds three MATERIALLY DIFFERENT
// leads (catalog/commerce, service, proof/content-heavy), drains the queue (real CDP), runs one REAL
// Lucas final and one TEST_AUDIO final through the queue, then extracts QA frames for inspection.
// Local, PRIVATE_ONLY. No send, no deploy, no production DB.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { insertLead, upsertBusinessIntelligence, getBusinessIntelligence, getReviewVideoJob } from "../src/lib/repo";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { buildSurfacePackage } from "../src/lib/review-video/surface";
import { prepareReviewVideoBatch, importJobAudio, approveReviewVideo } from "../src/lib/review-video/batch";
import { getRenderQueue } from "../src/lib/review-video/queue";
import type { Lead } from "../src/lib/types";

const LUCAS = "/Users/jordanjackson/.claude/uploads/9776a767-d87a-4115-939a-acf1d8f91a9a/14d6c6f6-Artifex_Labs__Urban_Americana__Voice_Over.mp3";
const QA = "/tmp/review-video-acceptance";
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const log = (m: string, x: unknown = "") => console.log(`[accept] ${m}`, x === "" ? "" : JSON.stringify(x));

// ── Three materially-different real surfaces. Each yields a visibly different capture + scene mix. ──
const COLLECTIONS = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"];
const CATALOG_BODY = `<nav><a href="/shop">Shop</a><a href="/collections">Collections</a><a href="/about">About</a><a href="/visit">Visit</a></nav><div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${COLLECTIONS.map((s) => `<a href="/collections/${s}">${s.replace(/-/g, " ")}</a>`).join("")}<a href="/collections/test-old-home">test-old-home</a><p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p>`;

const SERVICE_BODY = `<nav><a href="/services">Services</a><a href="/about">About</a><a href="/contact">Contact</a></nav><h1>Cascade Heating &amp; Air</h1><h2>Same-day HVAC repair in Portland</h2><p>Call <a href="tel:5035550142">(503) 555-0142</a> to book — our office is open Mon–Fri, 8am to 5pm.</p><h2>Our Services</h2><p>Furnace repair, AC installation, heat pumps, duct cleaning, and 24/7 emergency service.</p><p>We have served the greater Portland area for 22 years with over 1,200 five-star reviews.</p><p>No online booking is available; please phone during business hours to schedule an appointment.</p>`;

const PROOF_BODY = `<nav><a href="/work">Work</a><a href="/results">Results</a><a href="/team">Team</a></nav><h1>Meridian Growth Studio</h1><h2>What our clients say</h2><p>"Meridian rebuilt our funnel and doubled qualified leads in a quarter." — VP Marketing, Northwind</p><p>"The most rigorous team we've worked with. Data first, always." — Founder, Lumen</p><p>"They treated our budget like their own money." — CMO, Atlas Retail</p><h2>Case studies</h2><p>Northwind: 2.1x pipeline in 90 days. Lumen: 38% lower CAC. Atlas: 4.4x ROAS across paid social.</p><h2>Selected results</h2><p>Over 140 engagements delivered, $52M in attributed revenue, average 4.8/5 client rating.</p><p>Our reporting is fully transparent — every dollar traced to an outcome.</p>`;

/** An Observed opportunity (hand-crafted so a lead has a deterministic, evidence-backed finding count). */
const opp = (id: string, observation: string, whyItMatters: string, rationale: string, basis: string[]) => ({
  id, category: "Customer Acquisition", observation, whyItMatters,
  estimatedImpact: { level: "High", rationale }, confidence: { label: "Observed", score: 0.95 }, basis,
});

async function seed(name: string, over: Partial<Lead>, body: string, opps: any[] | null): Promise<Lead> {
  const lead = await insertLead({ ...(makeLead({ businessName: name, rating: 4.8, reviewCount: 950, ...over }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html: `<!doctype html><html><body>${body}</body></html>` }] });
  if (opps) bi.businessProfile.opportunities = opps as any; // deterministic finding count for the 2/3-finding cases
  const surfacePackage = buildSurfacePackage([{ url: lead.website!, html: `<body>${body}</body>`, role: "homepage" }], "2026-08-15T00:00:00Z");
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z", surfacePackage });
  return lead;
}

async function frames(jobId: string, label: string, kind: "visual" | "final") {
  const dir = `/tmp/review-video/${jobId}`;
  const file = kind === "visual" ? `${dir}/review-video-visual-preview.mp4` : `${dir}/review-video-final.mp4`;
  if (!existsSync(file)) { log(`QA: no ${kind} artifact for ${label}`, file); return null; }
  const dur = probe(file);
  const outDir = `${QA}/qa`; mkdirSync(outDir, { recursive: true });
  // Sample across the timeline: opening, evidence, quant, proof, start, close.
  const ts = [0.6, 0.18, 0.35, 0.52, 0.72, 0.92].map((f) => Math.max(0.1, Math.min(dur - 0.1, f * dur)));
  const shots: string[] = [];
  ts.forEach((t, i) => {
    const out = `${outDir}/${label}-${kind}-${i}-${t.toFixed(1)}s.png`;
    try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=540:-1", out]); shots.push(out); } catch { /* skip */ }
  });
  return { file, durationSeconds: Math.round(dur * 100) / 100, fileSizeBytes: statSync(file).size, shots };
}

async function main() {
  mkdirSync(QA, { recursive: true });
  if (!existsSync(LUCAS)) throw new Error(`Lucas audio missing: ${LUCAS}`);
  const lucasDur = probe(LUCAS);
  log("Lucas take duration", { seconds: lucasDur });

  // 1) Seed three materially-different eligible leads.
  const catalog = await seed("Urban Americana", { website: "https://urbanamericana.com", websiteDomain: "urbanamericana.com", industry: "Vintage marketplace", normalizedCategory: "furniture-store", city: "Long Beach", state: "CA" }, CATALOG_BODY, null);
  const service = await seed("Cascade Heating & Air", { website: "https://cascadehvac.com", websiteDomain: "cascadehvac.com", industry: "HVAC contractor", normalizedCategory: "hvac-contractor", city: "Portland", state: "OR" }, SERVICE_BODY, [
    opp("svc-booking", "The site has no online booking; every appointment requires a phone call during Mon–Fri 8–5 office hours.", "After-hours and weekend demand — when HVAC systems fail — slips to competitors who let customers book online.", "Add online scheduling to capture off-hours demand.", ["homepage HTML: 'No online booking is available; please phone during business hours'"]),
    opp("svc-response", "There is no way to request service or get a quote from the site except a single phone number.", "Every lead depends on a call being answered; missed calls are lost jobs with no fallback capture.", "Add a request-service form with instant confirmation.", ["homepage HTML: only a tel: link, no contact/quote form"]),
  ]);
  const proof = await seed("Meridian Growth Studio", { website: "https://meridiangrowth.com", websiteDomain: "meridiangrowth.com", industry: "Marketing agency", normalizedCategory: "marketing-agency", city: "Seattle", state: "WA" }, PROOF_BODY, [
    opp("prf-cta", "The homepage is dense with testimonials and results but has no visible call-to-action or contact path above the fold.", "Strong proof with no next step means motivated visitors leave without converting.", "Add a clear primary CTA next to the proof.", ["homepage HTML: testimonials + case studies present, no CTA/contact link"]),
    opp("prf-capture", "There is no lead-capture (no form, no calendar) anywhere on the page despite heavy proof content.", "The site persuades but cannot capture — every convinced visitor is lost.", "Add a booking/lead-capture block.", ["homepage HTML: no form or scheduling element"]),
    opp("prf-specificity", "Results are stated in prose ('2.1x pipeline', '$52M attributed') but not shown as scannable, verifiable figures.", "Buried numbers reduce the credibility of otherwise strong outcomes.", "Surface the key metrics as a proof strip.", ["homepage HTML: metrics embedded in paragraphs, not structured"]),
  ]);

  // Report the actual finding counts the pipeline derived (must exercise a 2- and a 3-finding case).
  for (const l of [catalog, service, proof]) {
    const bi = (await getBusinessIntelligence(l.id))!;
    const review = buildQuickReview(l, (bi.profile as any).businessProfile, cachedBrand((bi.profile as any).businessProfile), {});
    log("seeded lead", { name: l.businessName, id: l.id, findings: review.findings.length, topics: review.findings.map((f) => f.topic), surfaceLen: (bi.surfacePackage?.pages[0].html.length) });
  }

  // 2) Prepare the batch — enqueues a VISUAL render per eligible lead.
  const prep = await prepareReviewVideoBatch([catalog.id, service.id, proof.id]);
  log("prepared", prep.map((p) => ({ lead: p.leadId, job: p.jobId, status: p.status, created: p.created, blockers: p.blockers })));
  const jobByLead: Record<string, string> = {};
  prep.forEach((p) => { if (p.jobId) jobByLead[p.leadId] = p.jobId; });

  // 3) Drain the queue with the DEFAULT (real Chrome/CDP) executor — this is the mandatory real render.
  log("draining VISUAL renders through real Chrome/CDP (this takes minutes each)…");
  await getRenderQueue().drain();
  for (const [lead, job] of Object.entries(jobByLead)) log("post-visual", { lead, status: (await getReviewVideoJob(job))!.status, previewKey: (await getReviewVideoJob(job))!.previewKey });

  // 4) Real Lucas final for the CATALOG lead (Urban Americana — the take matches this narration), via the
  //    queue path: importJobAudio enqueues a FINAL render; drain runs the real executor.
  const catalogJob = jobByLead[catalog.id];
  if (catalogJob && (await getReviewVideoJob(catalogJob))!.status === "LUCAS_REQUIRED") {
    await importJobAudio(catalogJob, { audioKey: LUCAS, durationSeconds: lucasDur, isTest: false });
    log("real Lucas imported → draining FINAL render…", { job: catalogJob });
    await getRenderQueue().drain();
    log("post-final (catalog, REAL Lucas)", { status: (await getReviewVideoJob(catalogJob))!.status, finalKey: (await getReviewVideoJob(catalogJob))!.finalKey, finalDur: (await getReviewVideoJob(catalogJob))!.finalDurationSeconds });
  }

  // 5) TEST_AUDIO final for the SERVICE (2-finding) lead — exercises the final queue path with a synthetic
  //    tone, then proves it structurally CANNOT be approved.
  const serviceJob = jobByLead[service.id];
  if (serviceJob && (await getReviewVideoJob(serviceJob))!.status === "LUCAS_REQUIRED") {
    const target = (await getReviewVideoJob(serviceJob))!.targetSeconds;
    const testWav = `${QA}/test-audio-tone.wav`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=180:duration=${target}`, "-af", "volume=0.15", "-ar", "44100", "-ac", "1", testWav]);
    await importJobAudio(serviceJob, { audioKey: testWav, durationSeconds: probe(testWav), isTest: true });
    log("TEST_AUDIO imported → draining FINAL render…", { job: serviceJob, target });
    await getRenderQueue().drain();
    const j = (await getReviewVideoJob(serviceJob))!;
    log("post-final (service, TEST_AUDIO)", { status: j.status, audioIsTest: j.audioIsTest, finalKey: j.finalKey });
    let approvalBlocked = false;
    try { await approveReviewVideo(serviceJob); } catch (e) { approvalBlocked = true; log("approval correctly BLOCKED for TEST_AUDIO", { message: (e as Error).message }); }
    if (!approvalBlocked) throw new Error("SAFETY FAILURE: TEST_AUDIO job was approvable");
  }

  // 6) Extract QA frames from every produced artifact.
  const qa: Record<string, unknown> = {};
  qa["catalog-visual"] = await frames(jobByLead[catalog.id], "catalog", "visual");
  qa["catalog-final"] = await frames(jobByLead[catalog.id], "catalog", "final");
  qa["service-visual"] = await frames(jobByLead[service.id], "service", "visual");
  qa["service-final"] = await frames(jobByLead[service.id], "service", "final");
  qa["proof-visual"] = await frames(jobByLead[proof.id], "proof", "visual");

  const summary = {
    leads: { catalog: catalog.id, service: service.id, proof: proof.id },
    jobs: jobByLead,
    statuses: Object.fromEntries(await Promise.all(Object.entries(jobByLead).map(async ([lead, job]) => [lead, (await getReviewVideoJob(job))!.status]))),
    qa,
  };
  writeFileSync(`${QA}/summary.json`, JSON.stringify(summary, null, 2));
  log("DONE — summary written", `${QA}/summary.json`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
