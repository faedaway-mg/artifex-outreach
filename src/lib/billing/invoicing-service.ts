// ─────────────────────────────────────────────────────────────────────────────
// Invoicing service — composes the pure billing domain with persistence into the
// two operator-facing steps, kept deliberately distinct:
//
//   prepareMilestoneInvoice  → create a local DRAFT invoice (no external call).
//   issueMilestoneInvoice    → finalize/issue at the provider (external, gated).
//
// Guards enforced here: agreement must be signed; milestone must be eligible
// (deposit on signature, others on recorded acceptance); schedule must reconcile
// to the signed total; the invoice binds to the exact agreement version + issuer;
// creation is idempotent; and a deposit already paid via legacy Checkout is not
// re-invoiced. Issuing is refused in live mode unless sending is explicitly enabled
// AND never touches a live provider key during a test-mode rehearsal.
// ─────────────────────────────────────────────────────────────────────────────
import type { Invoice } from "../types";
import {
  getAgreement,
  paymentsForAgreement,
  invoicesForAgreement,
  insertInvoiceIfAbsent,
  getInvoice,
  updateInvoice,
  appendAudit,
} from "../repo";
import { resolveIssuerForSnapshot } from "./issuer";
import { deriveSchedule, reconcileSchedule, isMilestoneEligible } from "./milestones";
import { invoiceIdempotencyKey, shouldSkipForPaidCheckoutDeposit, canTransition, type InvoiceState } from "./invoice";
import { agreementSendingEnabled } from "../esign/gate";
import { prepareInvoice, finalizeInvoice, type FetchImpl } from "../payments/stripe-invoice";
import { reconcileInvoiceFromEvents } from "../payments/reconcile";
import { nowIso } from "../store";
import { closingCan } from "./authz";
import type { Role } from "../operators/roles";

export interface PrepareOpts {
  actor: string;
  /** Actor's role, resolved SERVER-SIDE (never from client input). */
  actorRole: Role;
  /** Milestone keys the operator has recorded acceptance evidence for. */
  acceptedKeys?: string[];
}

export interface ServiceResult {
  ok: boolean;
  invoice?: Invoice;
  inserted?: boolean;
  skipped?: boolean; // legitimately not created (e.g. Checkout deposit already paid)
  blocked?: boolean; // config/mode/authorization/eligibility block, not an error
  reason?: string;
}

/** Create (or return the existing) DRAFT invoice for one milestone. No external call. */
export async function prepareMilestoneInvoice(
  agreementId: string,
  milestoneKey: string,
  opts: PrepareOpts,
): Promise<ServiceResult> {
  if (!closingCan(opts.actorRole, "createInvoice")) {
    return { ok: false, blocked: true, reason: `Role '${opts.actorRole}' is not authorized to create invoices.` };
  }
  const agreement = await getAgreement(agreementId);
  if (!agreement) return { ok: false, blocked: true, reason: "Agreement not found." };
  if (agreement.status !== "signed") return { ok: false, blocked: true, reason: "The agreement is not signed yet." };
  if (agreement.supersededById) return { ok: false, blocked: true, reason: "This agreement version has been superseded." };

  const snap = agreement.contentSnapshot;
  const issuer = resolveIssuerForSnapshot(snap);
  const schedule = deriveSchedule(snap);
  const recon = reconcileSchedule(schedule, snap.totalPriceCents);
  if (!recon.ok) return { ok: false, blocked: true, reason: `Schedule does not reconcile: ${recon.errors.join(" ")}` };

  const term = schedule.find((m) => m.key === milestoneKey);
  if (!term) return { ok: false, blocked: true, reason: `No milestone '${milestoneKey}' in the agreed schedule.` };

  const eligible = isMilestoneEligible(term, { agreementSigned: true, acceptedKeys: opts.acceptedKeys ?? [] });
  if (!eligible) return { ok: false, blocked: true, reason: `Milestone '${milestoneKey}' is not yet eligible (needs recorded acceptance).` };

  // Coexistence: never double-bill a deposit already collected via legacy Checkout.
  const priorPayments = await paymentsForAgreement(agreementId);
  if (shouldSkipForPaidCheckoutDeposit(milestoneKey, priorPayments)) {
    return { ok: true, skipped: true, reason: "Deposit already paid via Checkout; no duplicate invoice created." };
  }

  const idempotencyKey = invoiceIdempotencyKey({
    issuerId: issuer.id,
    agreementId,
    agreementVersion: agreement.version,
    milestoneKey,
  });

  const { inserted, row } = await insertInvoiceIfAbsent({
    leadId: agreement.leadId,
    agreementId,
    agreementVersion: agreement.version,
    issuerId: issuer.id,
    milestoneKey,
    milestoneLabel: term.label,
    amountCents: term.amountCents,
    currency: snap.currency,
    state: "draft",
    idempotencyKey,
    provider: "stripe",
    providerInvoiceId: null,
    hostedInvoiceUrl: null,
    issuedAt: null,
    paidAt: null,
    failedAt: null,
    voidedAt: null,
    refundedAt: null,
    disputedAt: null,
    amountRefundedCents: 0,
  });

  if (inserted) {
    await appendAudit({
      action: "invoice.prepare",
      actor: opts.actor,
      targetType: "invoice",
      targetId: row.id,
      meta: { agreementId, agreementVersion: agreement.version, issuerId: issuer.id, milestoneKey, amountCents: term.amountCents },
      ip: null,
    });
  }
  return { ok: true, invoice: row, inserted };
}

export interface IssueOpts {
  actor: string;
  /** Actor's role, resolved SERVER-SIDE. */
  actorRole: Role;
  /** Rehearsal safety: when true, refuse to touch a live provider key. */
  requireTestMode: boolean;
  fetchImpl?: FetchImpl;
}

/**
 * Issue (finalize) a prepared DRAFT invoice at the provider. This is the EXTERNAL
 * step and is refused unless sending is explicitly enabled — except in a test-mode
 * rehearsal, which is allowed but forced onto a test key by the adapter.
 */
export async function issueMilestoneInvoice(invoiceId: string, opts: IssueOpts): Promise<ServiceResult> {
  if (!closingCan(opts.actorRole, "issueInvoice")) {
    return { ok: false, blocked: true, reason: `Role '${opts.actorRole}' is not authorized to issue invoices.` };
  }
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return { ok: false, blocked: true, reason: "Invoice not found." };
  if (!canTransition(invoice.state as InvoiceState, "issued")) {
    return { ok: false, blocked: true, reason: `Invoice in state '${invoice.state}' cannot be issued.` };
  }
  // Live issuing requires the explicit sending gate; test-mode rehearsal is exempt
  // (the adapter still refuses a live key when requireTestMode is set).
  if (!opts.requireTestMode && !agreementSendingEnabled()) {
    return { ok: false, blocked: true, reason: "Live issuing is disabled (AGREEMENT_SENDING_ENABLED is off)." };
  }

  const agreement = await getAgreement(invoice.agreementId);
  const snap = agreement?.contentSnapshot;
  const prepared = await prepareInvoice({
    issuerId: invoice.issuerId,
    requireTestMode: opts.requireTestMode,
    fetchImpl: opts.fetchImpl,
    customerEmail: snap?.clientEmail ?? "",
    customerName: snap?.clientLegalName ?? snap?.clientBusinessName ?? "",
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    description: `${invoice.milestoneLabel} — ${snap?.agreementNumber ?? invoice.agreementId}`,
    metadata: { agreementId: invoice.agreementId, agreementVersion: String(invoice.agreementVersion), milestoneKey: invoice.milestoneKey, invoiceId: invoice.id },
  });
  if (!prepared.ok || !prepared.data) return { ok: false, blocked: prepared.blocked, reason: prepared.error };

  const finalized = await finalizeInvoice(
    { issuerId: invoice.issuerId, requireTestMode: opts.requireTestMode, fetchImpl: opts.fetchImpl },
    prepared.data.invoiceId,
  );
  if (!finalized.ok || !finalized.data) return { ok: false, blocked: finalized.blocked, reason: finalized.error };

  await updateInvoice(invoice.id, {
    state: "issued",
    providerInvoiceId: finalized.data.invoiceId,
    hostedInvoiceUrl: finalized.data.hostedInvoiceUrl,
    issuedAt: nowIso(),
  });
  // Absorb any events that arrived before this invoice had a provider id (races).
  const reconciled = await reconcileInvoiceFromEvents(invoice.id);
  const updated = reconciled?.invoice ?? (await getInvoice(invoice.id));
  await appendAudit({
    action: "invoice.issue",
    actor: opts.actor,
    targetType: "invoice",
    targetId: invoice.id,
    meta: { providerInvoiceId: finalized.data.invoiceId, testMode: opts.requireTestMode },
    ip: null,
  });
  return { ok: true, invoice: updated ?? invoice, inserted: false };
}
