"use server";
// ─────────────────────────────────────────────────────────────────────────────
// NEEDS_ATTENTION operator recovery ACTIONS (mandate 15 Part 3). A "use server" module may export ONLY
// async functions. Two SAFE, non-sending choices for a contacted company whose completed video is ready
// (e.g. Morris): neither sends email, schedules a send, nor mutates the canonical lifecycle resolver — they
// record operator INTENT (editorial hold + an audit flag) which the UI reflects as a presentation sub-status.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { appendAudit, getLead } from "../repo";
import { skipReview } from "./review-revisions";
import { MANUAL_FOLLOWUP_FLAG_ACTION } from "./attention-status";
import { prepareVideoFollowUp, holdCompany, type FollowUpResult } from "./video-follow-up";

function revalidateAttention() {
  try { revalidatePath("/queue/attention"); revalidatePath("/needs-attention"); revalidatePath("/"); } catch { /* no request scope in tests */ }
}

/** HOLD (mandate 24): resumable editorial hold — leaves active Needs Attention, preserves history, distinct
 *  from Reject/unsubscribe, sends/schedules nothing, idempotent. */
export async function holdProspectAction(leadId: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await holdCompany(leadId);
  revalidateAttention();
  return r;
}

/** PREPARE VIDEO FOLLOW-UP (mandate 24): the canonical Needs-Attention → Ready-to-Approve action for a
 *  contacted company whose completed video wasn't delivered. Creates ONE reviewable VIDEO_FOLLOW_UP package
 *  (never approves/schedules/sends). Idempotent; blocks rejected/suppressed/already-delivered. */
export async function prepareVideoFollowUpAction(leadId: string): Promise<FollowUpResult> {
  const r = await prepareVideoFollowUp({ leadId });
  revalidateAttention();
  return r;
}

/** DEPRECATED (mandate 24): the old "flag for manual follow-up" intent marker, kept only for back-compat
 *  reconciliation of the pre-existing operator flag. New UI uses prepareVideoFollowUpAction / holdProspectAction. */
export async function flagForManualFollowUpAction(leadId: string): Promise<{ ok: boolean }> {
  const lead = await getLead(leadId);
  await appendAudit({ action: MANUAL_FOLLOWUP_FLAG_ACTION, actor: "operator", targetType: "lead", targetId: leadId, meta: { business: lead?.businessName ?? null } as unknown as Record<string, unknown>, ip: null });
  revalidateAttention();
  return { ok: true };
}
