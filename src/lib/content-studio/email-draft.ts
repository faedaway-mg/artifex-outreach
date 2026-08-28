// Content Studio — video-outreach email DRAFT model + dispatch policy (pure, fully testable). A draft
// binds a business + a share token + the approved video VERSION together. Its approval is invalidated
// automatically when the share is revoked or its bound version changes. The dispatch gate re-checks
// everything at send time AND forbids a silent fallback to a bare email when the video artifact is
// invalid — a broken/mismatched link blocks the send instead of quietly downgrading.
//
// NOTE: this is the POLICY layer. Wiring it into the live manual-email pipeline (comms/dispatch.ts:
// persisting a real draft, and calling this gate inside the existing suppression/quota/pause/auth path)
// is a coordinated change owned by the manual-email release — see the checkpoint. Nothing here sends.

import type { ShareRecord } from "./share";

export interface EmailDraft {
  id: string;
  businessId: string;
  shareToken: string;
  inputVersion: string; // the share version captured when the draft was prepared
  subject: string;
  bodyText: string;
  bodyHtml: string;
  artifactKind: "video-link" | "pdf";
  approvedAt: string | null;
  sentAt: string | null;
  sentVersion: string | null;
}

// A draft's approval is only valid while its bound share is live AND unchanged since approval.
export function draftApprovalValid(draft: EmailDraft, share: ShareRecord | null): boolean {
  if (!draft.approvedAt) return false;
  if (draft.artifactKind !== "video-link") return true; // pdf drafts don't depend on a share
  return !!share && !share.revokedAt && share.inputVersion === draft.inputVersion;
}

export interface DispatchContext {
  suppressed: boolean; // recipient on the suppression list
  paused: boolean; // sending paused (kill switch)
  authorized: boolean; // operator authorized to send
  quotaRemaining: number; // remaining sends in the shared 20/LA-day cap
  businessId: string; // the recipient business at dispatch time
}

export interface GateResult { ok: boolean; blockers: string[] }

// Final pre-dispatch gate. Empty blockers = safe to hand to the existing send. A video-link draft whose
// artifact fails validation is BLOCKED (never silently downgraded to a plain email).
export function videoDispatchGate(draft: EmailDraft, share: ShareRecord | null, ctx: DispatchContext): GateResult {
  const blockers: string[] = [];

  // Standard manual-workflow preconditions (composed with — not bypassing — the existing checks).
  if (ctx.suppressed) blockers.push("recipient is suppressed");
  if (ctx.paused) blockers.push("sending is paused");
  if (!ctx.authorized) blockers.push("not authorized to send");
  if (ctx.quotaRemaining <= 0) blockers.push("daily outreach quota reached");
  if (draft.businessId !== ctx.businessId) blockers.push("draft is bound to a different business than the recipient");

  // Video-artifact policy — no broken links, no silent fallback.
  if (draft.artifactKind === "video-link") {
    if (!share) blockers.push("viewing link is missing");
    else {
      if (share.revokedAt) blockers.push("viewing link has been revoked");
      if (share.inputVersion !== draft.inputVersion) blockers.push("video was changed since approval — re-approve the current version");
      if (draft.businessId && share.businessId && share.businessId !== draft.businessId) blockers.push("viewing link belongs to a different business");
    }
    if (!draftApprovalValid(draft, share)) blockers.push("draft is not approved for the current video version");
  } else if (draft.artifactKind === "pdf") {
    // PDF outreach keeps its existing protections; a video-link is NEVER substituted for it and vice
    // versa. (The existing Quick-Review/PDF path is preserved.)
    if (!draft.approvedAt) blockers.push("PDF draft not approved");
  }

  return { ok: blockers.length === 0, blockers };
}

// Revoking a share (or a new version) clears the bound draft's approval — the operator must re-approve.
export function invalidateApprovalOnShareChange(draft: EmailDraft, share: ShareRecord | null): EmailDraft {
  if (draft.artifactKind === "video-link" && !draftApprovalValid(draft, share)) {
    return { ...draft, approvedAt: null };
  }
  return draft;
}
