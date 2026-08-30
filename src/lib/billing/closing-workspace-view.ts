// ─────────────────────────────────────────────────────────────────────────────
// Authoritative Client-Closing workspace view-model (Gate 3). ONE server-derived shape
// the UI renders — the browser never recomputes legal/signing/payment truth. Pure: the
// caller loads persisted state (agreement, approval, send-auth, artifacts, live-pay-auth,
// invoices, payments, audit) and this assembles the view.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, Invoice, Payment, AuditEntry } from "../types";
import type { AgreementApproval } from "../agreement/approval";
import type { SendAuthorization } from "../agreement/send-authorization";
import { isSendAuthorizationUsable } from "../agreement/send-authorization";
import type { SignedArtifact } from "./retention";
import { retentionStatus } from "./retention";
import { esignModeOf, agreementEligibilityContext } from "./firewall-gate";
import { evaluateBillingEligibility, type EligibilityState } from "./eligibility";
import { signwellTestModeFor } from "../esign/mode";
import { resolveIssuerForSnapshot } from "./issuer";

export type SignerState = "not_sent" | "sent" | "viewed" | "signed";

export interface ClosingWorkspaceView {
  agreement: {
    id: string; number: string; version: number; status: Agreement["status"];
    esignMode: "test" | "production"; legallyBinding: boolean; signwellTestMode: boolean;
    createdAt: string; updatedAt: string;
  };
  provider: { legalEntity: string; signerName: string | null; signerEmail: string | null };
  client: { legalName: string; businessName: string; signerName: string; signerEmail: string; verified: boolean };
  terms: { scope: string[]; deliverables: string[]; totalCents: number; depositCents: number; remainingCents: number; currency: string; monthlyCents: number | null };
  document: {
    unsignedPdfSha256: string | null; approvalId: string | null; approvalDigest: string | null;
    sendAuthorizationState: "none" | "active" | "consumed" | "revoked" | "expired";
    esignRequestId: string | null; signedPdfSha256: string | null; auditPage: "none" | "embedded" | "separate";
  };
  signing: {
    provider: SignerState; client: SignerState; completedSigners: number; requiredSigners: number;
    lastEventAt: string | null; overall: string;
  };
  retention: { status: "not-required" | "pending" | "retrieving" | "retained" | "failed"; failureReason: string | null; retryAvailable: boolean; auditPageEmbedded: boolean; signedPdf: boolean; certificate: boolean };
  billing: { eligibility: EligibilityState; blockedReason: string; stripeMode: "test" | "live"; amountCents: number; currency: string; paymentAuthorized: boolean; paid: boolean };
  readiness: { providerConfigReady: boolean; clientVerified: boolean; approvalCurrent: boolean; sendAuthorizationCurrent: boolean; productionFlagsEnabled: boolean; nextAction: string; blockedReason: string | null };
  audit: Array<{ action: string; actor: string; at: string; outcome: string | null; meta: string }>;
}

export interface BuildWorkspaceInput {
  agreement: Agreement;
  approval: AgreementApproval | null;
  sendAuth: SendAuthorization | null;
  signedArtifacts: SignedArtifact[];
  livePaymentAuthorized: boolean;
  invoices: Invoice[];
  payments: Payment[];
  audit: AuditEntry[];
  providerConfigReady: boolean;
  productionFlagsEnabled: boolean;
  clientVerified: boolean;
  nowIso: string;
}

function signerStateFrom(agreement: Agreement, role: "provider" | "client", recips: Array<{ id?: string; status?: string }>): SignerState {
  const r = recips.find((x) => x.id === role);
  const s = (r?.status ?? "").toLowerCase();
  if (s === "completed" || s === "signed") return "signed";
  if (s === "viewed") return "viewed";
  if (agreement.esignRequestId) return "sent";
  return "not_sent";
}

export function buildClosingWorkspaceView(input: BuildWorkspaceInput): ClosingWorkspaceView {
  const { agreement: a } = input;
  const c = a.contentSnapshot;
  const mode = esignModeOf(a);
  const issuer = resolveIssuerForSnapshot(c);

  // Signer states from the latest recorded webhook payload if present, else lifecycle.
  const latestRecips: Array<{ id?: string; status?: string }> =
    (input.audit.find((e) => e.action === "signwell.recipients")?.meta as any)?.recipients ?? [];
  // A terminal document_completed (status "signed") means EVERY required signer completed —
  // even if per-recipient webhook rows were never recorded. Deriving both signers from the
  // lifecycle here keeps overall="Completed" and completedSigners=2 consistent (an invariant).
  const providerSigner: SignerState = a.status === "signed" ? "signed" : signerStateFrom(a, "provider", latestRecips);
  const clientSigner: SignerState = a.status === "signed" ? "signed" : signerStateFrom(a, "client", latestRecips);
  const completed = [providerSigner, clientSigner].filter((s) => s === "signed").length;

  const retention = retentionStatus(input.signedArtifacts, a);
  const signedPdf = input.signedArtifacts.some((x) => x.kind === "signed_pdf" && x.status === "retained");
  const cert = input.signedArtifacts.some((x) => x.kind === "audit_certificate" && x.status === "retained");

  const elig = evaluateBillingEligibility(agreementEligibilityContext(a, {
    approval: input.approval, currentBinding: input.approval?.binding ?? null,
    retention, recipientsPolicyOk: input.approval != null, ownerLivePaymentAuthorized: input.livePaymentAuthorized,
    amountMatchesApproval: true, modeConsistent: true, nowIso: input.nowIso,
  }));

  const sendAuthState: ClosingWorkspaceView["document"]["sendAuthorizationState"] =
    !input.sendAuth ? "none" : input.sendAuth.revokedAt ? "revoked" : input.sendAuth.consumedAt ? "consumed" : input.sendAuth.expiresAt && input.sendAuth.expiresAt <= input.nowIso ? "expired" : "active";

  const approvalCurrent = input.approval != null && !input.approval.revokedAt;
  const sendAuthUsable = !!(input.sendAuth && isSendAuthorizationUsable(input.sendAuth, input.nowIso));

  const overall =
    a.status === "signed" ? "Completed" :
    a.status === "declined" ? "Declined" : a.status === "voided" ? "Cancelled" :
    completed === 1 ? "Partially signed" :
    a.status === "sent" || a.status === "viewed" ? "Sent" :
    sendAuthUsable ? "Send authorized" :
    approvalCurrent ? "Approved" : a.status === "approved" ? "Needs review" : "Draft";

  // ── Top-level next action — derived from the EXACT authoritative state so it can never
  //    contradict the section controls. Ordered by precedence (terminal → blocked →
  //    lifecycle → billing). A production agreement whose client is unverified is a hard
  //    blocked state before any other action can be considered.
  const paid = input.payments.some((p) => p.type === "deposit" && p.status === "paid");
  const productionUnverified = mode === "production" && !input.clientVerified;
  const nextAction =
    paid ? "No action required" :
    a.status === "declined" ? "Agreement declined — no further action" :
    a.status === "voided" ? "Agreement cancelled — no further action" :
    productionUnverified ? "Verify client identity" :
    !approvalCurrent && a.status === "approved" ? "Complete operator review" :
    !approvalCurrent ? "Review agreement" :
    completed === 1 ? "Await remaining signature" :
    a.status === "sent" || a.status === "viewed" || (a.esignRequestId && a.status !== "signed") ? "Await signatures" :
    !sendAuthUsable && !a.esignRequestId ? "Authorize sending" :
    !a.esignRequestId ? "Send agreement" :
    // signed from here
    mode === "production" && retention === "failed" ? "Retry signed-document retention" :
    mode === "production" && retention === "pending" ? "Retain signed documents" :
    mode === "production" && retention === "not-required" ? "Retain signed documents" :
    elig.state === "BLOCKED_LIVE_AUTH_MISSING" ? "Authorize exact payment" :
    elig.state === "ELIGIBLE_TEST_PAYMENT" ? "Collect test deposit" :
    elig.state === "ELIGIBLE_LIVE_PAYMENT" ? "Authorize exact payment" :
    "No action required";

  const view: ClosingWorkspaceView = {
    agreement: { id: a.id, number: c.agreementNumber, version: a.version, status: a.status, esignMode: mode, legallyBinding: mode === "production", signwellTestMode: signwellTestModeFor(mode), createdAt: a.createdAt, updatedAt: a.updatedAt },
    provider: { legalEntity: issuer.legalEntity, signerName: input.approval?.binding.providerSignerEmail ? c.artifexSignatory : c.artifexSignatory, signerEmail: input.approval?.binding.providerSignerEmail ?? null },
    client: { legalName: c.clientLegalName, businessName: c.clientBusinessName, signerName: c.clientContactName, signerEmail: input.approval?.binding.clientEmail ?? c.clientEmail, verified: input.clientVerified },
    terms: { scope: c.scope, deliverables: c.deliverables, totalCents: c.totalPriceCents, depositCents: c.depositAmountCents, remainingCents: c.remainingBalanceCents, currency: c.currency, monthlyCents: c.monthlyPartnershipCents },
    document: {
      unsignedPdfSha256: input.approval?.binding.unsignedPdfSha256 ?? null, approvalId: input.approval?.id ?? null, approvalDigest: input.approval?.digest ?? null,
      sendAuthorizationState: sendAuthState, esignRequestId: a.esignRequestId,
      signedPdfSha256: input.signedArtifacts.find((x) => x.kind === "signed_pdf")?.sha256 ?? null,
      auditPage: cert ? "separate" : signedPdf ? "embedded" : "none",
    },
    signing: { provider: providerSigner, client: clientSigner, completedSigners: completed, requiredSigners: 2, lastEventAt: a.signedAt ?? a.viewedAt ?? null, overall },
    retention: { status: retention === "not-required" ? "not-required" : retention, failureReason: retention === "failed" ? "retrieval failed — retry available" : null, retryAvailable: retention === "failed", auditPageEmbedded: signedPdf && !cert, signedPdf, certificate: cert },
    billing: { eligibility: elig.state, blockedReason: elig.reason, stripeMode: mode === "production" ? "live" : "test", amountCents: c.depositAmountCents, currency: c.currency, paymentAuthorized: input.livePaymentAuthorized, paid },
    readiness: {
      providerConfigReady: input.providerConfigReady, clientVerified: input.clientVerified,
      approvalCurrent,
      sendAuthorizationCurrent: sendAuthUsable,
      productionFlagsEnabled: input.productionFlagsEnabled, nextAction, blockedReason: elig.state.startsWith("BLOCKED") ? elig.reason : null,
    },
    audit: input.audit.slice().sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || "")).slice(0, 40).map((e) => ({ action: e.action, actor: e.actor, at: e.createdAt, outcome: (e.meta as any)?.outcome ?? null, meta: safeMeta(e.meta) })),
  };

  // Fail closed: if the PERSISTED data assembled into an impossible combination, this
  // throws rather than rendering a self-contradicting workspace.
  assertWorkspaceInvariants(view);
  return view;
}

/**
 * Guard the assembled view against impossible state combinations. Throws
 * WorkspaceInvariantError on any contradiction so we fail closed rather than render a
 * workspace whose sections disagree with each other. Called at the end of
 * `buildClosingWorkspaceView`; also exported for direct testing.
 */
export class WorkspaceInvariantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[workspace-invariant:${code}] ${message}`);
    this.name = "WorkspaceInvariantError";
    this.code = code;
  }
}

export function assertWorkspaceInvariants(view: ClosingWorkspaceView): void {
  const { agreement: a, client, signing, retention, billing } = view;
  const production = a.esignMode === "production";
  const paymentEligible = billing.eligibility === "ELIGIBLE_LIVE_PAYMENT" || billing.eligibility === "BLOCKED_LIVE_AUTH_MISSING";
  const fail = (code: string, msg: string): never => { throw new WorkspaceInvariantError(code, msg); };

  // A production agreement that has reached a live-payment-eligible state cannot have an
  // unverified client — verification is a prerequisite for any live-payment path.
  if (production && paymentEligible && !client.verified)
    fail("PROD_PAYMENT_ELIGIBLE_UNVERIFIED_CLIENT", "production + live-payment-eligible + client.verified=false is impossible.");

  // "Completed"/2-of-2 requires two completed signers.
  if ((signing.overall === "Completed" || signing.completedSigners >= signing.requiredSigners) && signing.completedSigners < 2)
    fail("COMPLETED_WITH_INSUFFICIENT_SIGNERS", `overall='${signing.overall}' but completedSigners=${signing.completedSigners} (<2).`);

  // Retention cannot be "retained" unless signing itself completed.
  if (retention.status === "retained" && signing.overall !== "Completed")
    fail("RETAINED_BEFORE_SIGNING_COMPLETE", `retention retained while signing overall='${signing.overall}' (not Completed).`);

  // A TEST agreement can never reach ELIGIBLE_LIVE_PAYMENT.
  if (billing.eligibility === "ELIGIBLE_LIVE_PAYMENT" && a.esignMode === "test")
    fail("LIVE_PAYMENT_FOR_TEST_AGREEMENT", "ELIGIBLE_LIVE_PAYMENT on a test agreement is impossible.");

  // Paid requires a payment authorization to have occurred.
  if (billing.paid && !billing.paymentAuthorized)
    fail("PAID_WITHOUT_AUTHORIZATION", "billing.paid=true while paymentAuthorized=false is impossible.");

  // A legally-binding agreement cannot be in SignWell test mode.
  if (a.legallyBinding && a.signwellTestMode)
    fail("LEGALLY_BINDING_IN_TEST_MODE", "legallyBinding=true while signwellTestMode=true is impossible.");

  // "Retained" requires the required signed artifact to be present.
  if (retention.status === "retained" && !retention.signedPdf)
    fail("RETAINED_MISSING_ARTIFACT", "retention retained while the signed PDF artifact is missing.");
}

// A compact per-row projection of the authoritative view, for the overview/list route.
// Derived from the SAME view-model so a row can never contradict the detail page.
export interface ClosingRowSummary {
  id: string;
  number: string;
  client: string;
  mode: "test" | "production";
  legallyBinding: boolean;
  totalCents: number;
  depositCents: number;
  currency: string;
  overall: string;
  completedSigners: number;
  requiredSigners: number;
  retention: ClosingWorkspaceView["retention"]["status"];
  eligibility: EligibilityState;
  eligibilityBlocked: boolean;
  nextAction: string;
  clientVerified: boolean;
  updatedAt: string;
}

export function summarizeWorkspaceRow(view: ClosingWorkspaceView): ClosingRowSummary {
  return {
    id: view.agreement.id,
    number: view.agreement.number,
    client: view.client.businessName || view.client.legalName,
    mode: view.agreement.esignMode,
    legallyBinding: view.agreement.legallyBinding,
    totalCents: view.terms.totalCents,
    depositCents: view.terms.depositCents,
    currency: view.terms.currency,
    overall: view.signing.overall,
    completedSigners: view.signing.completedSigners,
    requiredSigners: view.signing.requiredSigners,
    retention: view.retention.status,
    eligibility: view.billing.eligibility,
    eligibilityBlocked: view.billing.eligibility.startsWith("BLOCKED"),
    nextAction: view.readiness.nextAction,
    clientVerified: view.client.verified,
    updatedAt: view.agreement.updatedAt,
  };
}

function safeMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  const pick = ["kind", "milestoneKey", "amountCents", "digest", "sha256", "esignMode", "outcome"];
  const out: string[] = [];
  for (const k of pick) if (m[k] != null) out.push(`${k}=${String(m[k]).slice(0, 24)}`);
  return out.join(" · ");
}
