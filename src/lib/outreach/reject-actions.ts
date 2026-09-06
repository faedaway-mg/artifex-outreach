"use server";
// ─────────────────────────────────────────────────────────────────────────────
// REJECT / STOP-FUTURE-OUTREACH server action (mandate 21). The ONE surface-facing entry point behind the
// shared Reject control; a thin wrapper over the canonical rejectLead() domain op. It contacts no provider,
// consumes no send slot, and writes no suppression/unsubscribe. Revalidates the operator surfaces so the
// rejected company leaves every active queue immediately.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { rejectLead } from "./rejection";
import { isRejectionReason, type RejectResult } from "./rejection-core";

export async function rejectLeadAction(input: { leadId: string; reason: string; note?: string | null }): Promise<RejectResult> {
  const leadId = String(input.leadId ?? "");
  if (!leadId) return { ok: false, leadId, disposition: "REJECTED", alreadyRejected: false, priorStage: null, contacted: false, sent: false, cancelledBinding: false, stoppedPlans: 0, error: "missing lead id" };
  if (!isRejectionReason(input.reason)) return { ok: false, leadId, disposition: "REJECTED", alreadyRejected: false, priorStage: null, contacted: false, sent: false, cancelledBinding: false, stoppedPlans: 0, error: "invalid reason" };

  const result = await rejectLead({ leadId, reason: input.reason, note: input.note ?? null, actor: currentActor() });

  // The rejected company must vanish from every active operator surface right away.
  revalidatePath("/"); revalidatePath("/schedule"); revalidatePath("/queue/ready");
  revalidatePath(`/company/${leadId}`); revalidatePath(`/leads/${leadId}`);
  return result;
}
