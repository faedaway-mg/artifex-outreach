// ─────────────────────────────────────────────────────────────────────────────
// THE ONE CANONICAL PROSPECT LIFECYCLE (mandate 12 part 1). Every prospect occupies EXACTLY ONE operator
// state, derived here from authoritative persisted signals only. Today, Studio, Activity, the focused
// screen, the cron workers, and package approval all read THIS resolver — no competing status logic.
//
// The operator-ready contract (part 2) is enforced structurally: a prospect can only be NEEDS_VOICEOVER
// when EVERY prerequisite the operator depends on already exists (finding, screenshot, gate-passing
// narration, email subject+body, frozen PDF w/ SHA, template, INCOMPLETE draft package). Anything missing
// routes to PREPARING_AUTOMATICALLY or AUTOMATIC_REPAIR — never to the operator queue.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProspectPackageState } from "./prospect-package";

export type ProspectState =
  | "PREPARING_AUTOMATICALLY"
  | "NEEDS_VOICEOVER"
  | "RENDERING"
  | "READY_TO_APPROVE"
  | "SCHEDULED"
  | "SENT"
  | "AUTOMATIC_REPAIR"
  | "NEEDS_ATTENTION"
  | "AUTOMATICALLY_EXCLUDED";

export interface LifecycleSignals {
  // eligibility / lineage
  internal: boolean;
  terminalStage: boolean;
  suppressed: boolean;
  contacted: boolean;               // in an outreach sequence (any email send row)
  sent: boolean;                    // an authoritative send (sentAt) exists
  scheduledFuture: boolean;         // a FUTURE email-only scheduled binding exists
  eligible: boolean;                // reanalysisEligibility().eligible
  recaptureExcluded: boolean;       // recapture state machine reached AUTOMATICALLY_EXCLUDED
  // operator-ready prerequisites (video prospect)
  hasTemplate: boolean;
  hasFinding: boolean;
  hasScreenshot: boolean;
  narrationPass: boolean;
  frozenPdf: boolean;               // frozen Quick Review PDF resolves with a verified SHA
  emailSubject: boolean;
  emailBody: boolean;
  draftPackageState: ProspectPackageState | null; // latest package state, or null
  // voiceover / render pipeline
  uploadPresent: boolean;           // an operator voiceover upload is persisted
  renderActive: boolean;            // a render job is queued or rendering
  renderReadyVerified: boolean;     // a completed render with a verified MP4 (outputKey) exists
  renderFailed: boolean;            // the latest render job failed
  renderAttempts: number;
  packageVideoBound: boolean;       // the package has the verified video bound
  maxRenderAttempts?: number;       // default 3
}

export interface LifecycleVerdict {
  state: ProspectState;
  missing: string[];                // which operator-ready prerequisites are absent
  reason: string;                   // plain-language explanation / repair action
}

/** Does this record carry ANY prospect-video intent? (Pure email leads are classified elsewhere.) */
export function hasVideoIntent(s: Pick<LifecycleSignals, "hasTemplate" | "uploadPresent" | "renderActive" | "renderReadyVerified" | "renderFailed" | "draftPackageState">): boolean {
  return s.hasTemplate || s.uploadPresent || s.renderActive || s.renderReadyVerified || s.renderFailed || s.draftPackageState != null;
}

/** The operator-ready prerequisites — ALL must be present for NEEDS_VOICEOVER (part 2). */
export function voiceoverPrereqsMissing(s: LifecycleSignals): string[] {
  const missing: string[] = [];
  if (!s.hasFinding) missing.push("finding");
  if (!s.hasScreenshot) missing.push("screenshot");
  if (!s.narrationPass) missing.push("narration");
  if (!s.emailSubject) missing.push("emailSubject");
  if (!s.emailBody) missing.push("emailBody");
  if (!s.frozenPdf) missing.push("frozenPDF");
  if (!s.hasTemplate) missing.push("template");
  if (s.draftPackageState == null) missing.push("draftPackage");
  return missing;
}

/**
 * THE resolver. Precedence is ordered so the most decisive/committed condition wins, and so the operator
 * never sees work that isn't genuinely ready. Video work outranks a stale email-only binding (operator
 * decision: a completed video supersedes an email-only scheduled send).
 */
export function resolveProspectState(s: LifecycleSignals): LifecycleVerdict {
  const maxAttempts = s.maxRenderAttempts ?? 3;
  const hasCompletedVideo = s.renderReadyVerified || s.packageVideoBound;

  // 0) Durable exclusions first.
  if (s.suppressed) return { state: "AUTOMATICALLY_EXCLUDED", missing: [], reason: "suppressed or unsubscribed" };
  if (s.terminalStage) return { state: "AUTOMATICALLY_EXCLUDED", missing: [], reason: "terminal pipeline stage" };
  if (s.recaptureExcluded && !hasVideoIntent(s)) return { state: "AUTOMATICALLY_EXCLUDED", missing: [], reason: "evidence insufficient after bounded recapture" };

  // 1) Outreach lineage (part 5). A completed voiceover on a company we've already contacted/sent is a
  //    genuine human decision — never auto-send, never discard the operator's recording.
  if ((s.contacted || s.sent) && hasCompletedVideo) {
    return { state: "NEEDS_ATTENTION", missing: [], reason: "already contacted — completed video ready; bind to a follow-up or skip (your call)" };
  }
  if (s.sent) return { state: "SENT", missing: [], reason: "outreach sent" };

  // 2) A complete, approvable video package (uncontacted).
  if (s.draftPackageState === "READY_TO_APPROVE" && s.packageVideoBound && s.emailBody && s.frozenPdf) {
    return { state: "READY_TO_APPROVE", missing: [], reason: "complete package: email + PDF + video" };
  }
  // A FROZEN package that has been scheduled (approved AND a future binding exists) is SCHEDULED, not still
  // awaiting approval; a frozen package with no binding yet is READY_TO_APPROVE.
  if (s.draftPackageState === "FROZEN") return s.scheduledFuture
    ? { state: "SCHEDULED", missing: [], reason: "approved & scheduled" }
    : { state: "READY_TO_APPROVE", missing: [], reason: "frozen package awaiting schedule" };
  if (s.draftPackageState === "SCHEDULED" || s.draftPackageState === "SENT") return s.draftPackageState === "SENT"
    ? { state: "SENT", missing: [], reason: "sent" }
    : { state: "SCHEDULED", missing: [], reason: "scheduled" };

  // 3) Post-render assembly pending — the exact Motion bug: verified MP4 but the package never bound it.
  if (s.renderReadyVerified && !s.packageVideoBound) {
    return { state: "AUTOMATIC_REPAIR", missing: [], reason: "verified render not yet assembled into the package" };
  }

  // 4) Actively rendering — a persisted voiceover with an in-flight render. NEVER counted as voiceover-ready.
  if (s.uploadPresent && s.renderActive) return { state: "RENDERING", missing: [], reason: "rendering the uploaded voiceover" };

  // 5) Render failures — bounded automatic repair, then a human.
  if (s.renderFailed) {
    if (s.renderAttempts < maxAttempts) return { state: "AUTOMATIC_REPAIR", missing: [], reason: `render failed (attempt ${s.renderAttempts}/${maxAttempts}) — retrying` };
    return { state: "NEEDS_ATTENTION", missing: [], reason: "render failed after max attempts" };
  }

  // 6) An upload exists but no render job at all — repair by (re)enqueuing exactly one render.
  if (s.uploadPresent && !s.renderActive && !s.renderReadyVerified) {
    return { state: "AUTOMATIC_REPAIR", missing: [], reason: "voiceover uploaded but no render job — enqueue" };
  }

  // 7) A committed email-only scheduled send (the 8 leads). Not video work.
  if (s.scheduledFuture) return { state: "SCHEDULED", missing: [], reason: "email-only scheduled send" };

  // 8) The operator-ready contract: NEEDS_VOICEOVER only when EVERY prerequisite already exists.
  const missing = voiceoverPrereqsMissing(s);
  if (missing.length === 0 && s.draftPackageState === "INCOMPLETE" && !s.uploadPresent && s.eligible) {
    return { state: "NEEDS_VOICEOVER", missing: [], reason: "all prerequisites present; awaiting voiceover" };
  }

  // 9) Otherwise it is being built automatically (or waiting on eligibility). Never shown to the operator.
  if (!s.eligible) return { state: "AUTOMATIC_REPAIR", missing, reason: "not currently eligible for operator work" };
  return { state: "PREPARING_AUTOMATICALLY", missing, reason: missing.length ? `preparing: missing ${missing.join(", ")}` : "preparing" };
}

/** The compact operator-facing bucket a count belongs to (mandate part 9). */
export const OPERATOR_COUNT_STATES: ProspectState[] = ["NEEDS_VOICEOVER", "RENDERING", "READY_TO_APPROVE", "SCHEDULED", "SENT", "NEEDS_ATTENTION"];
