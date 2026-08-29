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
  const providerSigner = signerStateFrom(a, "provider", latestRecips);
  const clientSigner = a.status === "signed" ? "signed" : signerStateFrom(a, "client", latestRecips);
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

  const overall =
    a.status === "signed" ? "Completed" :
    a.status === "declined" ? "Declined" : a.status === "voided" ? "Cancelled" :
    completed === 1 ? "Partially signed" :
    a.status === "sent" || a.status === "viewed" ? "Sent" :
    input.sendAuth && isSendAuthorizationUsable(input.sendAuth, input.nowIso) ? "Send authorized" :
    input.approval ? "Approved" : a.status === "approved" ? "Needs review" : "Draft";

  const nextAction =
    !input.approval ? "Review & approve the agreement" :
    !(input.sendAuth && isSendAuthorizationUsable(input.sendAuth, input.nowIso)) && a.status !== "signed" && !a.esignRequestId ? "Authorize sending" :
    !a.esignRequestId ? "Send for signature" :
    a.status !== "signed" ? "Awaiting signatures" :
    retention !== "retained" && mode === "production" ? "Retention in progress" :
    elig.state === "BLOCKED_LIVE_AUTH_MISSING" ? "Authorize live payment" :
    elig.state === "ELIGIBLE_TEST_PAYMENT" ? "Collect test deposit" :
    elig.state === "ELIGIBLE_LIVE_PAYMENT" ? "Collect deposit" : "—";

  return {
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
    billing: { eligibility: elig.state, blockedReason: elig.reason, stripeMode: mode === "production" ? "live" : "test", amountCents: c.depositAmountCents, currency: c.currency, paymentAuthorized: input.livePaymentAuthorized, paid: input.payments.some((p) => p.type === "deposit" && p.status === "paid") },
    readiness: {
      providerConfigReady: input.providerConfigReady, clientVerified: input.clientVerified,
      approvalCurrent: input.approval != null && !input.approval.revokedAt,
      sendAuthorizationCurrent: !!(input.sendAuth && isSendAuthorizationUsable(input.sendAuth, input.nowIso)),
      productionFlagsEnabled: input.productionFlagsEnabled, nextAction, blockedReason: elig.state.startsWith("BLOCKED") ? elig.reason : null,
    },
    audit: input.audit.slice().sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || "")).slice(0, 40).map((e) => ({ action: e.action, actor: e.actor, at: e.createdAt, outcome: (e.meta as any)?.outcome ?? null, meta: safeMeta(e.meta) })),
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
