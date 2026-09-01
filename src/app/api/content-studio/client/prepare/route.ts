import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { getLead, getBusinessIntelligence } from "@/lib/repo";
import { buildQuickReview, cachedBrand } from "@/lib/outreach/quick-review";
import { quickReviewApproved } from "@/lib/outreach/review-approval";
import type { BusinessProfile } from "@/lib/business-intelligence/types";
import { buildBusinessTemplate, type ScreenshotByFinding } from "@/lib/content-studio/client-video";
import { saveTemplate, loadTemplate, REPO_ROOT } from "@/lib/content-studio/store";
import { normalizeCaptureUrl } from "@/lib/content-studio/ssrf-guard";
import { createScreenshotJob, latestReadyShot, captureTargetFor } from "@/lib/content-studio/screenshot-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { leadId, allowOverride?, regenerate? } → build an EVIDENCE-LED review video template for a
// business, BOUND to it. Two gates are honored: readiness (unchanged) and section-F evidence (a
// ratings/reviews-only review is refused as "needs evidence" — never a generic substitute). Every
// material narration line is bound to its finding's evidence. On prepare we ALSO enqueue a secure
// screenshot capture of the business's verified website (section G) so the operator gets a real image.
//
// Owner-edit protection (F #9): if the operator has hand-edited the script, a re-prepare does NOT silently
// regenerate — pass regenerate:true to explicitly overwrite. Revisions are persisted (revision counter).
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const leadId = String(body?.leadId ?? "").trim();
  const allowOverride = Boolean(body?.allowOverride);
  const regenerate = Boolean(body?.regenerate);
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "unknown business" }, { status: 404 });

  const templateId = `client-${leadId}`.replace(/[^0-9a-z_-]/gi, "-").slice(0, 40);
  const existing = await loadTemplate(templateId);

  // Owner-edit protection: never clobber hand-edited narration on a routine re-prepare.
  if (existing?.ownerEdited && !regenerate) {
    return NextResponse.json({
      pieceId: templateId, businessId: leadId, businessName: existing.businessName,
      preserved: true, revision: existing.revision ?? 1,
      narration: existing.narration, narrationEvidence: existing.narrationEvidence ?? [],
      note: "This script was hand-edited — left untouched. Pass regenerate:true to rebuild from evidence.",
    }, { status: 200 });
  }

  const bi = await getBusinessIntelligence(leadId);
  const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
  if (!profile) return NextResponse.json({ error: "This business has no stored evidence yet — nothing to review.", evidenceState: "needs-evidence" }, { status: 422 });

  const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });

  // Attach any REAL captured homepage screenshot to the strongest finding it supports (never fabricated).
  const screenshots: ScreenshotByFinding = {};
  const shot = await latestReadyShot(leadId, "mobile").catch(() => null);
  if (shot?.outputKey && review.findings[0]) screenshots[review.findings[0].id] = shot.outputKey;

  const { template, readiness, narrationNote, evidenceState, blockedReason } = buildBusinessTemplate(review, { leadId, allowOverride, screenshots });
  if (!template) {
    return NextResponse.json({
      error: evidenceState === "needs-evidence" ? (blockedReason || "Needs evidence.") : "Not eligible for a review video.",
      evidenceState, readiness: readiness.readiness, blockers: readiness.blockers,
    }, { status: 422 });
  }

  // Persist with a bumped revision (F #9: revisions are tracked). A fresh generation clears ownerEdited.
  template.revision = (existing?.revision ?? 0) + 1;
  template.ownerEdited = false;
  await saveTemplate(template);

  // Enqueue a secure capture of the verified website (idempotent — an in-flight capture is reused).
  let screenshotJobId: string | null = null;
  if (lead.website) {
    const norm = normalizeCaptureUrl(lead.website);
    if (norm.ok) {
      try {
        const { job } = await createScreenshotJob({ businessId: leadId, pieceId: templateId, requestedUrl: captureTargetFor(norm.url!.href), viewport: "mobile" });
        screenshotJobId = job.id;
      } catch { /* capture is best-effort; the script is still evidence-led without it */ }
    }
  }

  const worker = path.join(REPO_ROOT, "scripts", "render-template-thumbnail.mjs");
  const child = spawn(process.execPath, [worker, template.id], { cwd: REPO_ROOT, detached: true, stdio: "ignore", env: process.env });
  child.unref();

  return NextResponse.json({
    pieceId: template.id, businessId: leadId, businessName: template.businessName,
    readiness: readiness.readiness, evidenceState, narrationNote, revision: template.revision,
    narration: template.narration, narrationEvidence: template.narrationEvidence ?? [],
    screenshotJobId,
    note: "Evidence-backed review video prepared; every material line bound to its source. Capturing the live site. Upload your voiceover, then Generate.",
  }, { status: 201 });
}
