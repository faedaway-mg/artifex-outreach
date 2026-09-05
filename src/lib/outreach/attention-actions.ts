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

/** Choice A — HOLD: records the existing editorial "held" state (with a reason). Sends nothing. */
export async function holdProspectAction(leadId: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await skipReview(leadId, "Held from Needs attention by operator");
  try { revalidatePath("/queue/attention"); revalidatePath("/needs-attention"); revalidatePath("/"); } catch { /* no request scope in tests */ }
  return r;
}

/** Choice B — FLAG for a manual follow-up decision: an append-only operator-intent marker. Sends nothing,
 *  schedules nothing, changes no canonical state — it only records that the operator will decide manually. */
export async function flagForManualFollowUpAction(leadId: string): Promise<{ ok: boolean }> {
  const lead = await getLead(leadId);
  await appendAudit({ action: MANUAL_FOLLOWUP_FLAG_ACTION, actor: "operator", targetType: "lead", targetId: leadId, meta: { business: lead?.businessName ?? null } as unknown as Record<string, unknown>, ip: null });
  try { revalidatePath("/queue/attention"); revalidatePath("/needs-attention"); revalidatePath("/"); } catch { /* no request scope in tests */ }
  return { ok: true };
}
