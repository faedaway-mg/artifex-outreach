// Review Video batch orchestration — integration over the store. Idempotent job creation, readiness
// gating, per-lead failure isolation, the full lifecycle (visual → Lucas → final → review → approve),
// audio safety, pilot events, and the hard rule that NOTHING is sent.
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { __resetRenderQueueForTests } from "./queue";
import { insertLead, upsertBusinessIntelligence, reviewVideoJobsForLead, getReviewVideoJob, auditForTarget } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { prepareReviewVideoBatch, markVisualRendered, importJobAudio, markFinalRendered, approveReviewVideo, markDeliveryReady, failJob, retryJob } from "./batch";
import { jobEvents } from "./measurement";
import { listReviewVideoCandidates, reviewVideoBoard } from "./board";

const CI = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"].map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s}</a>`).join("");
const RICH_HTML = `<body><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${CI}<a href="/collections/test-old-home">t</a></body>`;

async function seedLead(name: string, html: string, over: Record<string, unknown> = {}) {
  const lead = await insertLead({ ...(makeLead({ businessName: name, website: `https://${name.toLowerCase().replace(/\s+/g, "")}.com`, websiteDomain: `${name.toLowerCase().replace(/\s+/g, "")}.com`, rating: 4.8, reviewCount: 950, ...over }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html }] });
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z" });
  return lead;
}

// A lead whose review is only NEEDS_REVIEW (one evidence-backed finding) — below the video threshold.
async function seedOneFindingLead(name: string) {
  const lead = await insertLead({ ...(makeLead({ businessName: name, website: `https://${name.toLowerCase().replace(/\s+/g, "")}.com` }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html: `<body><h1>${name}</h1></body>` }] });
  bi.businessProfile.opportunities = [
    { id: "o1", category: "Scheduling", observation: "The site has no online booking; reservations require a phone call during business hours.", whyItMatters: "After-hours demand slips away.", estimatedImpact: { level: "High", rationale: "Add online booking." }, confidence: { label: "Observed", score: 0.95 }, basis: ["homepage HTML: no booking widget"] } as any,
  ];
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z" });
  return lead;
}

beforeEach(() => { __resetStoreForTests(); __resetRenderQueueForTests(); });

describe("batch preparation — eligibility, idempotency, failure isolation", () => {
  it("creates jobs for strong leads and refuses a thin one, in one batch (no poison)", async () => {
    const strong = await seedLead("Urban Americana", RICH_HTML);
    const weak = await seedOneFindingLead("Corner Cafe");
    const res = await prepareReviewVideoBatch([strong.id, weak.id, "does-not-exist"]);
    const byLead = Object.fromEntries(res.map((r) => [r.leadId, r]));
    expect(byLead[strong.id].created).toBe(true);
    expect(byLead[strong.id].status).toBe("PLANNING");
    expect(["STRONG", "READY"]).toContain(byLead[strong.id].readiness!.readiness);
    expect(byLead[weak.id].jobId).toBeNull();                  // NEEDS_REVIEW → not in the default batch
    expect(byLead[weak.id].readiness!.readiness).toBe("NEEDS_REVIEW");
    expect(byLead["does-not-exist"].blockers[0]).toMatch(/not found/); // isolated, didn't crash the batch
  });
  it("an operator override lets a NEEDS_REVIEW lead into the batch (approval-model semantics)", async () => {
    const weak = await seedOneFindingLead("Corner Cafe");
    const noOverride = await prepareReviewVideoBatch([weak.id]);
    expect(noOverride[0].jobId).toBeNull();
    const withOverride = await prepareReviewVideoBatch([weak.id], { allowOverride: true });
    expect(withOverride[0].jobId).not.toBeNull();
    expect(withOverride[0].created).toBe(true);
  });
  it("is idempotent — preparing the same lead twice reuses the active job", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const a = await prepareReviewVideoBatch([lead.id]);
    const b = await prepareReviewVideoBatch([lead.id]);
    expect(a[0].created).toBe(true); expect(b[0].created).toBe(false);
    expect(a[0].jobId).toBe(b[0].jobId);
    expect(await reviewVideoJobsForLead(lead.id)).toHaveLength(1); // no duplicate
  });
  it("stamps an id-bound expected Lucas filename and preserves findingIds for the reaction loop", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    const job = await getReviewVideoJob(r.jobId!);
    expect(job!.expectedAudioFilename).toContain(job!.id);
    expect(job!.findingIds.length).toBeGreaterThanOrEqual(2);
    expect(job!.rightsState).toBe("PRIVATE_ONLY");
  });
});

describe("job lifecycle — render → Lucas → final → review → approve → delivery", () => {
  it("advances through the states; approval is distinct from rendered and idempotent", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    const id = r.jobId!;
    await markVisualRendered(id, { previewKey: "key/preview.mp4" });
    expect((await getReviewVideoJob(id))!.status).toBe("LUCAS_REQUIRED");
    await importJobAudio(id, { audioKey: "key/lucas.mp3", durationSeconds: 58 });
    expect((await getReviewVideoJob(id))!.status).toBe("AUDIO_IMPORTED");
    await markFinalRendered(id, { finalKey: "key/final.mp4", durationSeconds: 60 });
    const ready = await getReviewVideoJob(id);
    expect(ready!.status).toBe("READY_FOR_REVIEW");        // rendered — but NOT approved
    expect(ready!.approvedAt).toBeNull();
    await approveReviewVideo(id);
    await approveReviewVideo(id);                            // idempotent
    const approved = await getReviewVideoJob(id);
    expect(approved!.status).toBe("APPROVED_PRIVATE"); expect(approved!.approvedAt).toBeTruthy();
    await markDeliveryReady(id);
    expect((await getReviewVideoJob(id))!.status).toBe("DELIVERY_READY");
  });
  it("rejects audio with an implausible duration (never attaches a wrong-length file)", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    await markVisualRendered(r.jobId!);
    await expect(importJobAudio(r.jobId!, { audioKey: "k", durationSeconds: 6 })).rejects.toThrow(/audio rejected/);
    expect((await getReviewVideoJob(r.jobId!))!.status).toBe("LUCAS_REQUIRED"); // unchanged
  });
  it("a failed job is isolated and can retry back to a re-runnable stage", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    await markVisualRendered(r.jobId!);
    await importJobAudio(r.jobId!, { audioKey: "k", durationSeconds: 58 });
    await failJob(r.jobId!, "final", "mux failure");
    const failed = await getReviewVideoJob(r.jobId!);
    expect(failed!.status).toBe("FAILED"); expect(failed!.failure?.stage).toBe("final");
    await retryJob(r.jobId!, "RENDERING_FINAL");
    expect((await getReviewVideoJob(r.jobId!))!.status).toBe("RENDERING_FINAL");
    expect((await getReviewVideoJob(r.jobId!))!.failure).toBeNull();
  });
});

describe("operator board data", () => {
  it("lists candidates by readiness and reflects live job status after prepare", async () => {
    const strong = await seedLead("Urban Americana", RICH_HTML);
    const weak = await seedOneFindingLead("Corner Cafe");
    const candidates = await listReviewVideoCandidates();
    const byLead = Object.fromEntries(candidates.map((c) => [c.leadId, c]));
    expect(["STRONG", "READY"]).toContain(byLead[strong.id].readiness.readiness);
    expect(byLead[weak.id].readiness.readiness).toBe("NEEDS_REVIEW");
    expect(candidates[0].readiness.readiness).toBe(byLead[strong.id].readiness.readiness); // strongest first
    await prepareReviewVideoBatch([strong.id]);
    const board = await reviewVideoBoard();
    expect(board.summary.PLANNING).toBe(1);
    expect(board.rows[0].nextAction).toBeTruthy();
    expect((await listReviewVideoCandidates()).find((c) => c.leadId === strong.id)!.hasJob).toBe(true);
  });
});

describe("measurement + safety", () => {
  it("records pilot events on the audit log and NEVER a fabricated view/sent event", async () => {
    const lead = await seedLead("Urban Americana", RICH_HTML);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    await markVisualRendered(r.jobId!);
    await importJobAudio(r.jobId!, { audioKey: "k", durationSeconds: 58 });
    await markFinalRendered(r.jobId!, { finalKey: "k", durationSeconds: 60 });
    await approveReviewVideo(r.jobId!);
    const events = (await jobEvents(r.jobId!)).map((e) => e.action);
    expect(events).toEqual(expect.arrayContaining(["review-video.prepared", "review-video.voice-added", "review-video.final-rendered", "review-video.approved"]));
    expect(events).not.toContain("review-video.sent");     // approval does NOT send
    expect(events).not.toContain("review-video.viewed");   // never fabricated
  });
});
