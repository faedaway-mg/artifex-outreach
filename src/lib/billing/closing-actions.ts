"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Closing server actions. Authorization is SERVER-SIDE: the actor is taken from the
// authenticated session (currentActor), the role from the persisted operator, and
// every money/legal action is capability-checked before the service runs — hidden
// buttons are not the security boundary. External issuing is forced to test-mode in
// this milestone (no live charges). Milestone acceptance is recorded in the audit
// log (no new table); the view derives eligibility from it.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { appendAudit, auditForTarget } from "../repo";
import { resolveActorRole, closingCan } from "./authz";
import { prepareMilestoneInvoice, issueMilestoneInvoice, type ServiceResult } from "./invoicing-service";

export async function acceptedKeysForAgreement(agreementId: string): Promise<string[]> {
  const entries = await auditForTarget("agreement", agreementId);
  return entries
    .filter((e) => e.action === "milestone.accept")
    .map((e) => (e.meta as { milestoneKey?: string } | null)?.milestoneKey)
    .filter((k): k is string => Boolean(k));
}

export async function recordMilestoneAcceptanceAction(agreementId: string, milestoneKey: string): Promise<ServiceResult> {
  const actor = currentActor();
  const role = await resolveActorRole(actor);
  if (!closingCan(role, "createInvoice")) return { ok: false, blocked: true, reason: `Role '${role}' is not authorized to record acceptance.` };
  await appendAudit({ action: "milestone.accept", actor, targetType: "agreement", targetId: agreementId, meta: { milestoneKey }, ip: null });
  revalidatePath(`/leads`);
  return { ok: true };
}

export async function prepareMilestoneInvoiceAction(agreementId: string, milestoneKey: string): Promise<ServiceResult> {
  const actor = currentActor();
  const role = await resolveActorRole(actor);
  const acceptedKeys = await acceptedKeysForAgreement(agreementId);
  const res = await prepareMilestoneInvoice(agreementId, milestoneKey, { actor, actorRole: role, acceptedKeys });
  revalidatePath(`/leads`);
  return res;
}

export async function issueMilestoneInvoiceAction(invoiceId: string): Promise<ServiceResult> {
  const actor = currentActor();
  const role = await resolveActorRole(actor);
  // M3: issuing is TEST-MODE ONLY — never a live charge from the app UI.
  const res = await issueMilestoneInvoice(invoiceId, { actor, actorRole: role, requireTestMode: true });
  revalidatePath(`/leads`);
  return res;
}
