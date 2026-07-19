"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Client-agreement server actions — the lifecycle orchestration.
//
//   Proposal Accepted → Generate → (review) → Approve → Send (SignWell)
//   → Signed (webhook) → Deposit unlocked → Deposit sent → Paid → Kickoff
//
// Every externally-visible step is guarded: the production gate (AGREEMENT_SENDING
// _ENABLED) blocks live sends, the deposit hard-gate blocks any deposit before a
// signed agreement, and the immutable snapshot is frozen at approval. No secrets
// are logged. Sensitive steps write an audit record.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  getLead,
  updateLead,
  getProposal,
  updateProposal,
  contactsForLead,
  deliverablesForLead,
  getSettings,
  allAgreements,
  agreementsForProposal,
  getAgreement,
  insertAgreement,
  updateAgreement,
  getPayment,
  updatePayment,
  insertEmailSendIfAbsent,
  updateEmailSend,
  appendAudit,
} from "./repo";
import { nowIso } from "./store";
import { buildAgreementContent, type AgreementOverrides } from "./agreement/snapshot";
import { nextAgreementNumber } from "./agreement/numbering";
import { AGREEMENT_TEMPLATE_VERSION } from "./agreement/template";
import { checkDepositAllowed, DepositGateError } from "./agreement/deposit-gate";
import { agreementSendingEnabled, assertSendingEnabled } from "./esign/gate";
import { getEsignProvider } from "./esign/provider";
import { renderAgreementPdf } from "./pdf/render-agreement";
import { getEmailProvider } from "./comms/provider";
import { createDepositCheckoutSession, stripeConfigured } from "./payments/stripe";
import { agreementReadyEmail, depositRequestEmail } from "./agreement/emails";

// ── local helpers ────────────────────────────────────────────────────────────
function touch(leadId: string) {
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/relationship`);
  revalidatePath("/approvals");
}

async function audit(action: string, targetType: string, targetId: string, meta?: Record<string, unknown>) {
  let ip: string | null = null;
  try {
    ip = headers().get("x-forwarded-for");
  } catch {
    /* outside a request context (rehearsal script) */
  }
  await appendAudit({ action, actor: "jordan", targetType, targetId, meta: meta ?? null, ip });
}

function fromAddress(contactEmail: string): string {
  return process.env.RESEND_FROM ?? `Artifex Labs <${contactEmail}>`;
}

/**
 * Send a client-facing agreement email through the Artifex sender identity, via
 * the existing send ledger (idempotent). Gated: throws if production sending is
 * disabled or no email provider is configured. NEVER uses AshMap identity.
 */
async function sendAgreementEmail(opts: {
  leadId: string;
  to: string;
  fromContactEmail: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<void> {
  assertSendingEnabled();
  const provider = getEmailProvider();
  if (!provider.canSend) throw new Error("Email provider is not configured — cannot send. Set RESEND_API_KEY + RESEND_FROM.");
  const from = fromAddress(opts.fromContactEmail);
  const { inserted, row } = await insertEmailSendIfAbsent({
    idempotencyKey: opts.idempotencyKey,
    stepId: null,
    planId: null,
    leadId: opts.leadId,
    toAddr: opts.to,
    fromAddr: from,
    subject: opts.subject,
    status: "sending",
    provider: provider.name,
    providerMessageId: null,
    attempts: 1,
    lastError: null,
    lastErrorCode: null,
    nextAttemptAt: null,
    queuedAt: nowIso(),
    sendingAt: nowIso(),
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    complainedAt: null,
    unsubscribedAt: null,
    failedAt: null,
  });
  // Idempotent: skip only if this key already sent successfully. A previously
  // FAILED attempt must be retryable (never silently report success), so we reset
  // it to sending and re-dispatch — Resend's Idempotency-Key dedupes provider-side.
  if (!inserted && row.status === "sent") return;
  if (!inserted) await updateEmailSend(row.id, { status: "sending", sendingAt: nowIso(), lastError: null, lastErrorCode: null });
  const result = await provider.send({ to: opts.to, from, subject: opts.subject, text: opts.body, idempotencyKey: opts.idempotencyKey });
  if (result.sent) {
    await updateEmailSend(row.id, { status: "sent", providerMessageId: result.providerMessageId, sentAt: nowIso() });
  } else {
    await updateEmailSend(row.id, { status: "failed", failedAt: nowIso(), lastError: result.reason ?? "send failed", lastErrorCode: result.errorCode ?? null });
    throw new Error(`Email send failed: ${result.reason ?? result.errorCode ?? "unknown"}`);
  }
}

// ── Phase: Proposal Accepted ─────────────────────────────────────────────────
export async function acceptProposalAction(leadId: string, proposalId: string): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal || proposal.leadId !== leadId) throw new Error("Proposal not found for this lead.");
  await updateProposal(proposalId, { status: "accepted", acceptedAt: nowIso() });
  await updateLead(leadId, { pipelineStage: "Proposal Accepted" });
  await audit("proposal.accept", "proposal", proposalId);
  touch(leadId);
}

// ── Phase: Generate Agreement ────────────────────────────────────────────────
function parseOverrides(formData: FormData): AgreementOverrides {
  const str = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || undefined;
  };
  const lines = (k: string) => {
    const v = String(formData.get(k) ?? "");
    const arr = v.split("\n").map((x) => x.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  };
  const monthlyDollars = Number(formData.get("monthlyPartnership"));
  const depositPercent = Number(formData.get("depositPercent"));
  return {
    projectName: str("projectName"),
    projectSummary: str("projectSummary"),
    timeline: str("timeline"),
    scope: lines("scope"),
    deliverables: lines("deliverables"),
    exclusions: lines("exclusions"),
    startDateAssumption: str("startDateAssumption"),
    effectiveDate: str("effectiveDate"),
    signerName: str("signerName"),
    signerEmail: str("signerEmail"),
    clientLegalName: str("clientLegalName"),
    depositPercent: Number.isFinite(depositPercent) && depositPercent > 0 ? depositPercent : undefined,
    monthlyPartnershipCents: Number.isFinite(monthlyDollars) && monthlyDollars > 0 ? Math.round(monthlyDollars * 100) : undefined,
  };
}

export async function generateAgreementAction(leadId: string, proposalId: string, formData: FormData): Promise<{ ok: boolean; errors: string[]; agreementId?: string }> {
  const [lead, proposal, contacts, deliverables, settings, existingAgreements] = await Promise.all([
    getLead(leadId),
    getProposal(proposalId),
    contactsForLead(leadId),
    deliverablesForLead(leadId),
    getSettings(),
    allAgreements(),
  ]);
  if (!lead) throw new Error("Lead not found.");
  if (!proposal || proposal.leadId !== leadId) throw new Error("Proposal not found for this lead.");

  // Guard against accidental duplicate generation: refuse if a live (non-terminal)
  // agreement already exists for this proposal. Use "Create a new version" to
  // supersede an existing one intentionally.
  const forProposal = await agreementsForProposal(proposalId);
  if (forProposal.some((a) => a.status !== "voided" && a.status !== "declined")) {
    throw new Error("An agreement already exists for this proposal. Void it or create a new version instead.");
  }

  const agreementNumber = nextAgreementNumber(existingAgreements.map((a) => a.agreementNumber), nowIso());
  const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const { content, errors } = buildAgreementContent({
    agreementNumber,
    version: 1,
    lead,
    contact,
    proposal,
    deliverable: deliverables.find((d) => d.status !== "draft") ?? deliverables[0] ?? null,
    settings,
    overrides: parseOverrides(formData),
    nowIso: nowIso(),
  });
  if (!content) return { ok: false, errors };

  const agreement = await insertAgreement({
    leadId,
    proposalId,
    agreementNumber,
    templateVersion: AGREEMENT_TEMPLATE_VERSION,
    version: 1,
    supersedesId: null,
    supersededById: null,
    status: "generated",
    contentSnapshot: content,
    effectiveDate: content.effectiveDate || null,
    signerName: content.clientContactName,
    signerEmail: content.clientEmail,
    signerCompany: content.clientBusinessName,
    pdfKey: null,
    pdfUrl: null,
    signedPdfKey: null,
    signedPdfUrl: null,
    certificateUrl: null,
    esignProvider: null,
    esignRequestId: null,
    esignUrl: null,
    approvedAt: null,
    sentAt: null,
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    voidedAt: null,
  });
  await audit("agreement.generate", "agreement", agreement.id, { agreementNumber });
  touch(leadId);
  return { ok: true, errors: [], agreementId: agreement.id };
}

/** Regenerate an unapproved agreement in place (draft/generated only). */
export async function regenerateAgreementAction(agreementId: string, formData: FormData): Promise<{ ok: boolean; errors: string[] }> {
  const agreement = await getAgreement(agreementId);
  if (!agreement) throw new Error("Agreement not found.");
  if (agreement.status !== "generated" && agreement.status !== "draft") {
    throw new Error("Only an unapproved agreement can be regenerated. Create a new version instead.");
  }
  const [lead, proposal, contacts, deliverables, settings] = await Promise.all([
    getLead(agreement.leadId),
    getProposal(agreement.proposalId),
    contactsForLead(agreement.leadId),
    deliverablesForLead(agreement.leadId),
    getSettings(),
  ]);
  if (!lead || !proposal) throw new Error("Lead or proposal missing.");
  const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const { content, errors } = buildAgreementContent({
    agreementNumber: agreement.agreementNumber,
    version: agreement.version,
    lead,
    contact,
    proposal,
    deliverable: deliverables.find((d) => d.status !== "draft") ?? deliverables[0] ?? null,
    settings,
    overrides: parseOverrides(formData),
    nowIso: nowIso(),
  });
  if (!content) return { ok: false, errors };
  await updateAgreement(agreementId, {
    contentSnapshot: content,
    effectiveDate: content.effectiveDate || null,
    signerName: content.clientContactName,
    signerEmail: content.clientEmail,
    signerCompany: content.clientBusinessName,
    pdfKey: null,
    pdfUrl: null,
  });
  touch(agreement.leadId);
  return { ok: true, errors: [] };
}

// ── Phase: Approve (freeze snapshot) ─────────────────────────────────────────
export async function approveAgreementAction(agreementId: string): Promise<void> {
  const agreement = await getAgreement(agreementId);
  if (!agreement) throw new Error("Agreement not found.");
  if (agreement.status !== "generated") throw new Error("Only a generated agreement can be approved.");
  await updateAgreement(agreementId, { status: "approved", approvedAt: nowIso() });
  await audit("agreement.approve", "agreement", agreementId, { agreementNumber: agreement.agreementNumber, templateVersion: agreement.templateVersion });
  touch(agreement.leadId);
}

// ── Phase: Send through SignWell ─────────────────────────────────────────────
export async function sendAgreementForSignatureAction(agreementId: string, opts: { testMode?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const agreement = await getAgreement(agreementId);
  if (!agreement) throw new Error("Agreement not found.");
  if (agreement.status !== "approved") throw new Error("Only an approved agreement can be sent for signature.");

  const testMode = Boolean(opts.testMode);
  // Live (non-test) sends require the production gate. Test-mode rehearsal does not,
  // so the SignWell integration can be exercised safely without going live.
  if (!testMode) assertSendingEnabled();

  const provider = getEsignProvider();
  if (!provider.canSend) return { ok: false, error: "SignWell is not configured (SIGNWELL_API_KEY not set)." };

  const settings = await getSettings();
  const pdf = await renderAgreementPdf(agreement, !agreementSendingEnabled());
  const pdfBase64 = pdf.toString("base64");
  const ready = agreementReadyEmail(agreement, settings);

  const res = await provider.createSignatureRequest({
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    pdfBase64,
    subject: ready.subject,
    message: `Please review and sign your Professional Services Agreement (${agreement.agreementNumber}).`,
    signer: { name: agreement.signerName ?? agreement.contentSnapshot.clientContactName, email: agreement.signerEmail ?? agreement.contentSnapshot.clientEmail },
    ccEmail: settings.contactEmail,
    testMode,
    metadata: { leadId: agreement.leadId },
  });
  if (!res.ok) return { ok: false, error: res.error ?? "SignWell request failed." };

  await updateAgreement(agreementId, {
    status: "sent",
    sentAt: nowIso(),
    esignProvider: "signwell",
    esignRequestId: res.requestId,
    esignUrl: res.signingUrl,
  });
  await audit("agreement.send", "agreement", agreementId, { agreementNumber: agreement.agreementNumber, testMode, esignRequestId: res.requestId });
  touch(agreement.leadId);
  return { ok: true };
}

// ── Void / new version ───────────────────────────────────────────────────────
export async function voidAgreementAction(agreementId: string): Promise<void> {
  const agreement = await getAgreement(agreementId);
  if (!agreement) throw new Error("Agreement not found.");
  if (agreement.status === "signed") throw new Error("A signed agreement cannot be voided here — supersede it with a new version.");
  await updateAgreement(agreementId, { status: "voided", voidedAt: nowIso() });
  await audit("agreement.void", "agreement", agreementId);
  touch(agreement.leadId);
}

/** Create a superseding version after approval (material correction). */
export async function createNewAgreementVersionAction(agreementId: string, formData: FormData): Promise<{ ok: boolean; errors: string[]; agreementId?: string }> {
  const prev = await getAgreement(agreementId);
  if (!prev) throw new Error("Agreement not found.");
  const [lead, proposal, contacts, deliverables, settings] = await Promise.all([
    getLead(prev.leadId),
    getProposal(prev.proposalId),
    contactsForLead(prev.leadId),
    deliverablesForLead(prev.leadId),
    getSettings(),
  ]);
  if (!lead || !proposal) throw new Error("Lead or proposal missing.");
  const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const { content, errors } = buildAgreementContent({
    agreementNumber: prev.agreementNumber, // same document, new version
    version: prev.version + 1,
    lead,
    contact,
    proposal,
    deliverable: deliverables.find((d) => d.status !== "draft") ?? deliverables[0] ?? null,
    settings,
    overrides: parseOverrides(formData),
    nowIso: nowIso(),
  });
  if (!content) return { ok: false, errors };

  const next = await insertAgreement({
    leadId: prev.leadId,
    proposalId: prev.proposalId,
    agreementNumber: prev.agreementNumber,
    templateVersion: AGREEMENT_TEMPLATE_VERSION,
    version: prev.version + 1,
    supersedesId: prev.id,
    supersededById: null,
    status: "generated",
    contentSnapshot: content,
    effectiveDate: content.effectiveDate || null,
    signerName: content.clientContactName,
    signerEmail: content.clientEmail,
    signerCompany: content.clientBusinessName,
    pdfKey: null,
    pdfUrl: null,
    signedPdfKey: null,
    signedPdfUrl: null,
    certificateUrl: null,
    esignProvider: null,
    esignRequestId: null,
    esignUrl: null,
    approvedAt: null,
    sentAt: null,
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    voidedAt: null,
  });
  await updateAgreement(prev.id, { supersededById: next.id, status: prev.status === "signed" ? prev.status : "voided", voidedAt: prev.status === "signed" ? prev.voidedAt : nowIso() });
  await audit("agreement.new_version", "agreement", next.id, { supersedes: prev.id, version: next.version });
  touch(prev.leadId);
  return { ok: true, errors: [], agreementId: next.id };
}

// ── Phase: Deposit (hard-gated) ──────────────────────────────────────────────
export async function sendDepositRequestAction(paymentId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const payment = await getPayment(paymentId);
  if (!payment) throw new Error("Deposit not found.");
  const agreement = await getAgreement(payment.agreementId);

  // Layer 1: domain gate.
  const gate = checkDepositAllowed(agreement, payment, payment.leadId);
  if (!gate.allowed) throw new DepositGateError(gate.reason ?? "Deposit not allowed.");

  // Layer 2: production send gate.
  assertSendingEnabled();

  const [lead, contacts, settings] = await Promise.all([getLead(payment.leadId), contactsForLead(payment.leadId), getSettings()]);
  if (!lead || !agreement) throw new Error("Lead or agreement missing.");
  const signerEmail = agreement.signerEmail ?? agreement.contentSnapshot.clientEmail;

  // Determine the Stripe payment link: operator-provided, else auto-create.
  let paymentLinkUrl = String(formData.get("paymentLinkUrl") ?? "").trim() || null;
  let sessionId: string | null = payment.stripeSessionId;
  if (!paymentLinkUrl) {
    if (!stripeConfigured()) return { ok: false, error: "No payment link provided and STRIPE_SECRET_KEY is not set." };
    const link = await createDepositCheckoutSession({
      amountCents: payment.amountCents,
      currency: payment.currency,
      productName: `Deposit — ${agreement.contentSnapshot.projectName} (${agreement.agreementNumber})`,
      metadata: { agreementId: agreement.id, paymentId: payment.id, leadId: payment.leadId },
    });
    if (!link.ok || !link.url) return { ok: false, error: link.error ?? "Failed to create Stripe payment link." };
    paymentLinkUrl = link.url;
    sessionId = link.sessionId;
  }

  const msg = depositRequestEmail(agreement, paymentLinkUrl, settings);
  await sendAgreementEmail({
    leadId: payment.leadId,
    to: signerEmail,
    fromContactEmail: settings.contactEmail,
    subject: msg.subject,
    body: msg.body,
    idempotencyKey: `deposit:${payment.id}`,
  });

  await updatePayment(payment.id, { status: "link_sent", sentAt: nowIso(), stripePaymentLinkUrl: paymentLinkUrl, stripeSessionId: sessionId });
  await audit("deposit.send", "payment", payment.id, { agreementId: agreement.id, amountCents: payment.amountCents });
  touch(payment.leadId);
  return { ok: true };
}

/** Explicit, audited manual fallback to mark a deposit paid (e.g. bank transfer). */
export async function markDepositPaidAction(paymentId: string): Promise<void> {
  const payment = await getPayment(paymentId);
  if (!payment) throw new Error("Deposit not found.");
  const agreement = await getAgreement(payment.agreementId);
  if (!agreement || agreement.status !== "signed") throw new Error("Deposit cannot be marked paid before its agreement is signed.");
  await updatePayment(payment.id, { status: "paid", paidAt: nowIso() });
  await updateLead(payment.leadId, { pipelineStage: "Deposit Paid" });
  await audit("deposit.mark_paid_manual", "payment", payment.id, { manual: true, amountCents: payment.amountCents });
  touch(payment.leadId);
}

// ── Phase: Kickoff ───────────────────────────────────────────────────────────
export async function scheduleKickoffAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead not found.");
  // Kickoff means the engagement is active. Journey mapping presents Implementation
  // / Ongoing Partnership from here.
  await updateLead(leadId, { pipelineStage: "Won" });
  await audit("agreement.kickoff", "lead", leadId);
  touch(leadId);
}
