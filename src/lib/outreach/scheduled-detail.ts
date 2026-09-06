// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE-AWARE SCHEDULED DETAIL (mandate 22). Resolves the EXACT frozen content a scheduled binding will
// send — from the SAME binding + revision that validateScheduled and the dispatch path use, never a fresh
// preview off mutable lead data. It classifies the real package type and surfaces only what that type
// actually carries, so an EMAIL_ONLY / EMAIL_PDF item never shows a bogus "no video package" warning.
//
// packageType:
//   EMAIL_ONLY      — email + (compliance footer/unsubscribe applied at send). No PDF, no video.
//   EMAIL_PDF       — email + frozen Quick Review PDF (bound by SHA).
//   EMAIL_VIDEO     — email + PDF + completed video + signed share link.
//   VIDEO_FOLLOW_UP — a video package on a company we've already contacted (prior-send lineage).
//
// A missing-content warning is emitted ONLY when the binding DECLARES a component it lacks (e.g. a video
// package whose video is missing) — those bindings are marked quarantined so the UI routes them to Needs
// Attention instead of pretending the schedule is complete.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, allEmailSends } from "../repo";
import { listScheduledBindings, validateScheduled } from "./scheduled-batch";
import { latestProspectPackage, packageShareUrl, resolveCurrentVideo, type CurrentVideo } from "./prospect-package-store";
import { effectiveReviewFor } from "./review-revisions";
import { getArtifactStore } from "../content-studio/storage-factory";
import type { ProspectPackageType } from "./dispatch-integrity";

export interface ScheduledDetail {
  leadId: string;
  business: string;
  recipient: string;
  scheduledAt: string;
  windowTz: string;
  packageType: ProspectPackageType;
  revisionId: string;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  pdf: { required: boolean; present: boolean; href: string | null; sha256: string | null };
  video: { required: boolean; present: boolean; shareUrl: string | null };
  evidenceSummary: string[];
  compliance: { footerAtSend: boolean; signedUnsubscribeAtSend: boolean };
  validator: { ok: boolean; reason: string | null };
  quarantined: boolean;
  missing: string[];
  /** The canonical current video (operator preview + recipient-share status), resolved once for this lead. */
  currentVideo: CurrentVideo;
}

/** Resolve the scheduled detail for a lead, or null if the lead has no scheduled binding. Read-only. */
export async function resolveScheduledDetail(leadId: string, baseUrl = ""): Promise<ScheduledDetail | null> {
  const entry = (await listScheduledBindings()).find((b) => b.leadId === leadId);
  if (!entry) return null; // not a scheduled item — caller falls back to the normal view
  const binding = entry.binding;
  const [lead, pkg, sends, validator, eff, currentVideo] = await Promise.all([
    getLead(leadId),
    latestProspectPackage(leadId).catch(() => null),
    allEmailSends(),
    validateScheduled(leadId, binding),
    effectiveReviewFor(leadId).catch(() => null),
    resolveCurrentVideo(leadId, { baseUrl }),
  ]);
  if (!lead) return null;

  const leadSends = sends.filter((e) => e.leadId === leadId);
  const priorSend = leadSends.length > 0;

  // What the binding/package DECLARES it carries (drives the package type), vs. what actually exists.
  const declaresVideo = !!pkg?.video;
  const declaresPdf = !!pkg?.review || !!binding.pdfSha256;
  const videoArtifactOk = declaresVideo ? !!(await getArtifactStore().getMeta(pkg!.video!.videoKey).catch(() => null)) : false;
  const hasVideo = declaresVideo && videoArtifactOk; // a declared-but-missing video is NOT present → quarantine
  const hasPdf = declaresPdf;
  const packageType: ProspectPackageType = declaresVideo
    ? (priorSend ? "VIDEO_FOLLOW_UP" : "EMAIL_VIDEO")
    : (hasPdf ? "EMAIL_PDF" : "EMAIL_ONLY");

  // Subject/body: prefer the frozen prospect package; else the frozen review revision (validator OK proves
  // the current review == the frozen one, so this IS the content that will send — not a mutable re-render).
  let subject = pkg?.subject ?? binding.subject;
  let bodyText: string | null = pkg?.bodyText ?? null;
  let bodyHtml: string | null = pkg?.bodyHtml ?? null;
  const review = (eff?.review ?? null) as { openingHook?: string | null; whyItMatters?: string; findings?: Array<{ observation?: string }> } | null;
  if (!bodyText && !bodyHtml && review) {
    subject = binding.subject || subject;
    bodyText = [review.openingHook, review.whyItMatters].filter(Boolean).join("\n\n") || null;
  }
  const evidenceSummary = (review?.findings ?? []).map((f) => f.observation).filter((o): o is string => !!o).slice(0, 3);

  // What this package TYPE declares it carries, and what is actually present.
  const videoRequired = packageType === "EMAIL_VIDEO" || packageType === "VIDEO_FOLLOW_UP";
  const pdfRequired = packageType === "EMAIL_PDF" || videoRequired; // video packages also attach the PDF
  const missing: string[] = [];
  if (videoRequired && !hasVideo) missing.push("video");
  if (pdfRequired && !hasPdf) missing.push("PDF");
  const quarantined = !validator.ok || missing.length > 0;

  return {
    leadId,
    business: lead.businessName,
    recipient: binding.recipient,
    scheduledAt: binding.scheduledAt,
    windowTz: binding.windowTz,
    packageType,
    revisionId: binding.revisionId,
    subject,
    bodyText,
    bodyHtml,
    pdf: { required: pdfRequired, present: hasPdf, href: hasPdf ? `/api/quick-review/${leadId}/pdf` : null, sha256: pkg?.review?.sha256 ?? binding.pdfSha256 ?? null },
    video: { required: videoRequired, present: hasVideo, shareUrl: pkg?.video && pkg?.share ? packageShareUrl(pkg, baseUrl) : null },
    evidenceSummary,
    compliance: { footerAtSend: true, signedUnsubscribeAtSend: true },
    validator: { ok: validator.ok, reason: validator.reason ?? null },
    quarantined,
    missing,
    currentVideo,
  };
}
