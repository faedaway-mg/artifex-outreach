// Renderer generalization safety (Batch M1.1 step 2). These prove the guards that must hold BEFORE any
// Chrome/CDP work — so they run fast and deterministically without launching a browser:
//   • The queue's render-core reads the CANONICAL persisted state and NEVER re-crawls; a missing surface
//     package fails with SURFACE_PACKAGE_MISSING (repair BI, don't crawl in the renderer).
//   • The render CORE rejects a malformed snapshot (no findings) and a final without audio, up front.
//   • A TEST_AUDIO job can render technically but can NEVER be approved / reach DELIVERY_READY.
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { __resetRenderQueueForTests } from "./queue";
import { insertLead, upsertBusinessIntelligence, getBusinessIntelligence } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { buildQuickReview, cachedBrand } from "../outreach/quick-review";
import { buildSurfacePackage } from "./surface";
import { runReviewVideoRender } from "../../../scripts/review-video-render-core";
import { renderReviewVideoCore } from "../../../scripts/render-review-video-m2";
import { prepareReviewVideoBatch, markVisualRendered, importJobAudio, markFinalRendered, approveReviewVideo, markDeliveryReady } from "./batch";
import { getReviewVideoJob } from "../repo";

const CI = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"].map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s}</a>`).join("");
const RICH = `<body><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${CI}<a href="/collections/test-old-home">t</a></body>`;

async function seed(name: string, html: string, withSurface: boolean) {
  const lead = await insertLead({ ...(makeLead({ businessName: name, website: `https://${name.toLowerCase().replace(/\s+/g, "")}.com`, rating: 4.8, reviewCount: 950 }) as any) });
  const bi = await analyzeBusiness({ lead, pages: [{ url: lead.website!, html }] });
  const surfacePackage = withSurface ? buildSurfacePackage([{ url: lead.website!, html, role: "homepage" }], "2026-08-15T00:00:00Z") : undefined;
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-08-15T00:00:00Z", surfacePackage });
  return lead;
}

beforeEach(() => { __resetStoreForTests(); __resetRenderQueueForTests(); });

describe("render-core adapter — canonical state, no re-crawl", () => {
  it("fails with SURFACE_PACKAGE_MISSING (not a crawl) when no surface was persisted", async () => {
    const lead = await seed("No Surface Co", RICH, /* withSurface */ false);
    expect((await getBusinessIntelligence(lead.id))!.surfacePackage ?? null).toBeNull();
    const res = await runReviewVideoRender({ jobId: "job-x", leadId: lead.id, reviewId: "rv-x", mode: "visual", outputPrefix: "/tmp/should-not-render" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/SURFACE_PACKAGE_MISSING/);
    expect(res.error).toMatch(/no re-crawl/i);
  });
  it("fails cleanly when the lead is gone (no fabricated render)", async () => {
    const res = await runReviewVideoRender({ jobId: "job-x", leadId: "does-not-exist", reviewId: "rv-x", mode: "visual", outputPrefix: "/tmp/nope" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/lead not found/);
  });
  it("fails when the lead has no stored review/profile yet", async () => {
    const lead = await insertLead({ ...(makeLead({ businessName: "Bare Lead" }) as any) });
    const res = await runReviewVideoRender({ jobId: "job-x", leadId: lead.id, reviewId: "rv-x", mode: "visual", outputPrefix: "/tmp/nope" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no stored review/);
  });
});

describe("render CORE — up-front guards (no Chrome)", () => {
  it("rejects a malformed snapshot (a review with no findings) as INVALID_PLAN", async () => {
    const lead = await seed("Urban Americana", RICH, true);
    const bi = (await getBusinessIntelligence(lead.id))!;
    const profile = (bi.profile as any).businessProfile;
    const review = buildQuickReview(lead, profile, cachedBrand(profile), {});
    const empty = { ...review, findings: [], presentations: [] };
    const res = await renderReviewVideoCore({ leadId: lead.id, businessName: lead.businessName, review: empty as any, bodyHtml: RICH, reviewId: "rv-empty", mode: "visual", outDir: "/tmp/should-not-render" });
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe("INVALID_PLAN");
  });
  it("rejects a final render with no audio as AUDIO_MISSING (before launching Chrome)", async () => {
    const lead = await seed("Urban Americana", RICH, true);
    const bi = (await getBusinessIntelligence(lead.id))!;
    const profile = (bi.profile as any).businessProfile;
    const review = buildQuickReview(lead, profile, cachedBrand(profile), {});
    const res = await renderReviewVideoCore({ leadId: lead.id, businessName: lead.businessName, review, bodyHtml: RICH, reviewId: "rv-final", mode: "final", audioPath: "/tmp/nonexistent-lucas.mp3", outDir: "/tmp/should-not-render" });
    expect(res.success).toBe(false);
    expect(res.errorKind).toBe("AUDIO_MISSING");
  });
});

describe("TEST_AUDIO safety — renders technically, never approvable", () => {
  it("a job voiced with TEST_AUDIO can reach READY_FOR_REVIEW but CANNOT be approved or delivered", async () => {
    const lead = await seed("Urban Americana", RICH, true);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    const id = r.jobId!;
    await markVisualRendered(id, { previewKey: "k/preview.mp4" });
    await importJobAudio(id, { audioKey: "k/test-audio.mp3", durationSeconds: 58, isTest: true });
    expect((await getReviewVideoJob(id))!.audioIsTest).toBe(true);
    await markFinalRendered(id, { finalKey: "k/final.mp4", durationSeconds: 60 });
    expect((await getReviewVideoJob(id))!.status).toBe("READY_FOR_REVIEW"); // technically rendered
    await expect(approveReviewVideo(id)).rejects.toThrow(/TEST_AUDIO/);
    expect((await getReviewVideoJob(id))!.status).toBe("READY_FOR_REVIEW"); // never advanced
    // …and because approval is the only gate to delivery, DELIVERY_READY is unreachable too.
    await expect(markDeliveryReady(id)).rejects.toThrow(); // illegal transition from READY_FOR_REVIEW
  });
  it("a real (non-test) audio job approves normally — proving the block is specific to TEST_AUDIO", async () => {
    const lead = await seed("Urban Americana", RICH, true);
    const [r] = await prepareReviewVideoBatch([lead.id]);
    const id = r.jobId!;
    await markVisualRendered(id, { previewKey: "k/preview.mp4" });
    await importJobAudio(id, { audioKey: "k/lucas.mp3", durationSeconds: 58 }); // isTest omitted → real
    expect((await getReviewVideoJob(id))!.audioIsTest).toBe(false);
    await markFinalRendered(id, { finalKey: "k/final.mp4", durationSeconds: 60 });
    await approveReviewVideo(id);
    expect((await getReviewVideoJob(id))!.status).toBe("APPROVED_PRIVATE");
  });
});
