// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TERMINAL REJECTION — the operation (mandate 21). rejectLead() atomically removes a company
// from the active pipeline and prevents ALL future automated outreach, while preserving history:
//   1) persist the terminal disposition on the stable lead entity (pipelineStage → "Rejected");
//   2) void pending UNSENT outreach — cancel the scheduled binding + stop pending follow-up plans
//      (append-only cancels; packages/artifacts/revisions/sent receipts/audit are NEVER deleted);
//   3) append ONE truthful lead.rejected audit event (reason, note, actor, prior stage, package/binding
//      references, contacted/sent facts). It NEVER writes a suppression/unsubscribe — an internal
//      rejection must not falsely claim the recipient opted out.
// Idempotent: a repeat converges to the same coherent state and appends no second event. Every dispatch/
// generation/allocation gate independently refuses a rejected lead (see rejection-core.isRejectedLead),
// so a rejected company can never be both dispatch-eligible AND terminally rejected.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, allEmailSends, auditForTarget, claimLeadRejection } from "../repo";
import { nowIso, newId } from "../store";
import { currentOperatorId } from "../auth";
import { cancelScheduled, listScheduledBindings } from "./scheduled-batch";
import { stopPlansForLead } from "../acquisition/stop";
import { latestProspectPackage } from "./prospect-package-store";
import {
  REJECTION_ACTION, REJECTED_STAGE, type RejectionReason, type RejectResult, type RejectionRecord,
} from "./rejection-core";

export interface RejectInput {
  leadId: string;
  reason: RejectionReason;
  note?: string | null;
  actor?: string;
}

/** The canonical operator action. Safe to call repeatedly; converges to one coherent rejected state. */
export async function rejectLead(input: RejectInput): Promise<RejectResult> {
  const leadId = input.leadId;
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const actor = input.actor ?? currentOperatorId() ?? "operator";
  const base: RejectResult = { ok: false, leadId, disposition: "REJECTED", reason: input.reason, alreadyRejected: false, priorStage: null, contacted: false, sent: false, cancelledBinding: false, stoppedPlans: 0 };

  const lead = await getLead(leadId);
  if (!lead) return { ...base, error: "lead not found" };

  // Truthful contacted/sent from the ledger — keyed to the ENTITY id, not the current email.
  const sends = (await allEmailSends()).filter((e) => e.leadId === leadId);
  const contacted = sends.length > 0;
  const sent = sends.some((e) => !!e.sentAt);

  // Capture references BEFORE the claim so the audit trail points at what existed at rejection time.
  const binding = (await listScheduledBindings()).find((b) => b.leadId === leadId)?.binding ?? null;
  const pkg = await latestProspectPackage(leadId).catch(() => null);
  const priorStageObserved = lead.pipelineStage === REJECTED_STAGE ? null : lead.pipelineStage;
  const transitionId = newId("rej");

  // ATOMIC EXACTLY-ONCE CLAIM (mandate 21B). The storage layer flips the stage active→"Rejected" AND appends
  // the single lead.rejected event in ONE transaction. Only one concurrent caller wins; the rest converge
  // without a second event. This is NOT a suppression — no addSuppression, no unsubscribe event is written.
  const claim = await claimLeadRejection({
    leadId,
    audit: {
      action: REJECTION_ACTION, actor, targetType: "lead", targetId: leadId,
      meta: {
        disposition: "REJECTED", reason: input.reason, note,
        priorStage: priorStageObserved, contacted, sent, transitionId,
        bindingRef: binding ? { revisionId: binding.revisionId, scheduledAt: binding.scheduledAt, batchId: binding.batchId } : null,
        packageRef: pkg ? { packageVersion: pkg.packageVersion, state: pkg.state, digest: pkg.packageDigest } : null,
        at: nowIso(),
      } as Record<string, unknown>,
      ip: null,
    },
  });

  if (!claim.claimed) {
    // Duplicate of an existing transition — append NOTHING. Converge idempotently (cancelScheduled is a no-op
    // once the winner has voided the binding; it also heals a crash between the winner's claim and its cancel).
    const prior = await latestRejection(leadId);
    const cancelledBinding = await cancelScheduled(leadId).catch(() => false);
    return { ok: true, leadId, disposition: "REJECTED", reason: input.reason, alreadyRejected: true, priorStage: prior?.priorStage ?? null, contacted, sent, cancelledBinding, stoppedPlans: 0 };
  }

  // WINNER — void pending UNSENT outreach exactly once (both idempotent; preserve packages/revisions/receipts).
  const cancelledBinding = await cancelScheduled(leadId).catch(() => false);
  const stoppedPlans = await stopPlansForLead(leadId, `rejected: ${input.reason}`).catch(() => 0);
  return { ok: true, leadId, disposition: "REJECTED", reason: input.reason, alreadyRejected: false, priorStage: claim.priorStage ?? priorStageObserved, contacted, sent, cancelledBinding, stoppedPlans };
}

/** The newest recorded rejection for a lead (for display, prior-state recovery, and reversal), or null. */
export async function latestRejection(leadId: string): Promise<RejectionRecord | null> {
  const rows = (await auditForTarget("lead", leadId))
    .filter((r) => r.action === REJECTION_ACTION)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const m = (latest.meta ?? {}) as Record<string, unknown>;
  return {
    reason: m.reason as RejectionReason,
    note: (m.note as string | null) ?? null,
    priorStage: (m.priorStage as string | null) ?? null,
    contacted: !!m.contacted,
    sent: !!m.sent,
    actor: latest.actor,
    at: (m.at as string) ?? latest.createdAt,
  };
}
