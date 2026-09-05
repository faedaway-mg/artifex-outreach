"use server";
// ─────────────────────────────────────────────────────────────────────────────
// NEEDS_ATTENTION operator recovery actions (mandate 15 Part 3). Two SAFE, non-sending choices for a
// contacted company whose completed video is ready (e.g. Morris). Neither sends email, schedules a send,
// nor mutates the canonical lifecycle resolver — they record operator INTENT (editorial hold + an audit
// flag) which the UI reflects as a presentation sub-status so the item leaves the visible attention queue.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { appendAudit, listAudit, getLead } from "../repo";
import { skipReview } from "./review-revisions";
import { getEditorialState } from "./review-revisions";

export const MANUAL_FOLLOWUP_FLAG_ACTION = "prospect.manual-followup.flagged";

/** Choice A — HOLD: records the existing editorial "held" state (with a reason). Sends nothing. */
export async function holdProspectAction(leadId: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await skipReview(leadId, "Held from Needs attention by operator");
  try { revalidatePath("/queue/attention"); revalidatePath("/needs-attention"); revalidatePath("/"); } catch { /* best-effort; no request scope in tests */ }
  return r;
}

/** Choice B — FLAG for a manual follow-up decision: an append-only operator-intent marker. Sends nothing,
 *  schedules nothing, changes no canonical state — it only records that the operator will decide manually. */
export async function flagForManualFollowUpAction(leadId: string): Promise<{ ok: boolean }> {
  const lead = await getLead(leadId);
  await appendAudit({ action: MANUAL_FOLLOWUP_FLAG_ACTION, actor: "operator", targetType: "lead", targetId: leadId, meta: { business: lead?.businessName ?? null } as unknown as Record<string, unknown>, ip: null });
  try { revalidatePath("/queue/attention"); revalidatePath("/needs-attention"); revalidatePath("/"); } catch { /* best-effort; no request scope in tests */ }
  return { ok: true };
}

export type AttentionAck = "held" | "flagged" | null;

/** Read-only: has the operator already acknowledged this attention item (held or flagged)? Presentation
 *  only — does NOT affect the canonical resolver. Used to move handled items out of the active queue. */
export async function attentionAck(leadId: string, audit?: Array<{ action?: string; targetId?: string }>): Promise<AttentionAck> {
  const est = await getEditorialState(leadId).catch(() => null);
  if (est?.held) return "held";
  const rows = audit ?? (await listAudit(5000));
  if (rows.some((a) => a.action === MANUAL_FOLLOWUP_FLAG_ACTION && a.targetId === leadId)) return "flagged";
  return null;
}
