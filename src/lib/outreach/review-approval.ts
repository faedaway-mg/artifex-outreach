// ─────────────────────────────────────────────────────────────────────────────
// Quick Review approval — the explicit, auditable operator decision that lets a NEEDS_REVIEW review
// (one evidence-backed finding, below the SENDABLE threshold) proceed to attachment. Approval is a
// deliberate act: it records an append-only audit event, so it is visible, auditable in state, and
// impossible to trigger by accident. INSUFFICIENT_EVIDENCE can NEVER be approved through this path.
// ─────────────────────────────────────────────────────────────────────────────
import { appendAudit, auditForTarget } from "../repo";
import { currentOperatorId } from "../auth";

export const REVIEW_APPROVED_ACTION = "quick-review.approved";

/** Has an operator explicitly approved this lead's Quick Review? Pure read of the audit log. */
export async function quickReviewApproved(leadId: string): Promise<boolean> {
  const rows = await auditForTarget("lead", leadId);
  return rows.some((a) => a.action === REVIEW_APPROVED_ACTION);
}

/** Record an explicit operator approval. Refuses INSUFFICIENT_EVIDENCE — there is nothing credible
 *  to wave through; the operator must add evidence first. Returns whether it was recorded. */
export async function approveQuickReview(leadId: string, status: string): Promise<{ ok: boolean; reason?: string }> {
  if (status === "INSUFFICIENT_EVIDENCE") {
    return { ok: false, reason: "This review has no evidence-backed findings — it can't be approved. Re-run analysis to gather evidence." };
  }
  if (await quickReviewApproved(leadId)) return { ok: true }; // idempotent
  await appendAudit({ action: REVIEW_APPROVED_ACTION, actor: currentOperatorId() ?? "operator", targetType: "lead", targetId: leadId, meta: { status }, ip: null });
  return { ok: true };
}
