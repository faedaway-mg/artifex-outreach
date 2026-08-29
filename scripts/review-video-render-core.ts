// ─────────────────────────────────────────────────────────────────────────────
// Real render core adapter (Batch M1.1 step 2) — the default production executor the render QUEUE calls.
// It loads a job's CANONICAL persisted state (lead identity + stored Quick Review + the sanitized
// surface package) and drives the ONE renderer (renderReviewVideoCore in render-review-video-m2). No
// re-crawl, no fixture, no duplicate renderer. Returns the render-service structured result (never CLI
// stdout). The visual/final input versions come from the deterministic versioning module.
// ─────────────────────────────────────────────────────────────────────────────
import type { RenderRequest, RenderResult } from "../src/lib/review-video/render-service";
import { getLead, getBusinessIntelligence, getReviewVideoJob } from "../src/lib/repo";
import type { BusinessProfile } from "../src/lib/business-intelligence/types";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { primarySurfaceBody } from "../src/lib/review-video/surface";
import { visualInputVersion, finalInputVersion } from "../src/lib/review-video/version";

export async function runReviewVideoRender(req: RenderRequest): Promise<RenderResult> {
  const t0 = Date.now();
  const fail = (error: string): RenderResult => ({ success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: Date.now() - t0, inputVersion: "", error });

  const job = await getReviewVideoJob(req.jobId);
  const lead = await getLead(req.leadId);
  if (!lead) return fail("lead not found");
  const bi = await getBusinessIntelligence(req.leadId);
  const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
  if (!profile) return fail("no stored review for lead");
  const surfacePackage = bi?.surfacePackage ?? null;
  if (!surfacePackage) return fail("SURFACE_PACKAGE_MISSING: no persisted surface — repair BI (no re-crawl here)");
  const bodyHtml = primarySurfaceBody(surfacePackage); // null → text-only fallback (honest, not fabricated)

  const review = buildQuickReview(lead, profile, cachedBrand(profile), {});
  const visualVersion = visualInputVersion(review, surfacePackage);
  const version = req.mode === "final"
    ? finalInputVersion(visualVersion, { key: req.audioKey, durationSeconds: req.audioDurationSeconds })
    : visualVersion;

  // Resolve the Lucas audio path for final mode (prefer an absolute local key on the request or job).
  const audioPath = req.mode === "final"
    ? [req.audioKey, job?.audioKey].find((k) => k && k.startsWith("/")) ?? req.audioKey ?? null
    : null;

  // Lazy-import the renderer (Chrome) only when actually rendering.
  const { renderReviewVideoCore } = await import("./render-review-video-m2");
  const outDir = req.outputPrefix.startsWith("/") ? req.outputPrefix : `/tmp/review-video/${req.jobId}`;
  const res = await renderReviewVideoCore({
    leadId: req.leadId, businessName: lead.businessName, review, bodyHtml, reviewId: req.reviewId,
    mode: req.mode, audioPath, outDir, sourceUrl: lead.website, port: 9247 + (hashPort(req.jobId) % 40),
  });

  if (!res.success) return { success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: Date.now() - t0, inputVersion: version, error: `${res.errorKind ?? "RENDER_FAILED"}: ${res.error ?? ""}` };
  return {
    success: true, mode: req.mode, jobId: req.jobId,
    artifacts: req.mode === "visual" ? { previewKey: res.previewPath } : { finalKey: res.finalPath, sfxKey: res.sfxPath, previewKey: res.previewPath },
    durationSeconds: res.durationSeconds, width: res.width, height: res.height, fileSizeBytes: res.fileSizeBytes,
    renderMs: Date.now() - t0, inputVersion: version,
  };
}

function hashPort(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = Math.abs((h * 31 + s.charCodeAt(i)) | 0); return Math.abs(h); }
