// DEV-ONLY visual preview of the ClosingWorkspace across synthetic states, for browser
// screenshot verification (Playwright). Returns 404 in production. Uses only synthetic
// ClosingWorkspaceView objects — no store, no provider, no network. Select a state with
// ?state=<key>: draft | approved | send_authorized | partial | completed |
// retention_failed | retained | eligible_live | paid | unverified.
import { notFound } from "next/navigation";
import { ClosingWorkspace } from "@/components/closing/ClosingWorkspace";
import type { ClosingWorkspaceView } from "@/lib/billing/closing-workspace-view";

const SHA = "a".repeat(64);
const DIGEST = "b".repeat(64);

function base(over: Partial<ClosingWorkspaceView> = {}): ClosingWorkspaceView {
  return {
    agreement: {
      id: "agr_preview", number: "AL-A-2026-001", version: 1, status: "approved",
      esignMode: "test", legallyBinding: false, signwellTestMode: true,
      createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
    },
    provider: { legalEntity: "Artifex Labs Systems LLC", signerName: "Jordan Jackson", signerEmail: "contracts@artifexlabs.tech" },
    client: { legalName: "Copper Oak Holdings LLC", businessName: "Copper Oak", signerName: "Dana Rivera", signerEmail: "dana@copperoak.com", verified: true },
    terms: {
      scope: ["Brand identity system", "Marketing site (5 pages)"],
      deliverables: ["Logo suite", "Design system", "Deployed site"],
      totalCents: 1_450_000, depositCents: 725_000, remainingCents: 725_000, currency: "usd", monthlyCents: null,
    },
    document: {
      unsignedPdfSha256: SHA, approvalId: null, approvalDigest: null,
      sendAuthorizationState: "none", esignRequestId: null, signedPdfSha256: null, auditPage: "none",
    },
    signing: { provider: "not_sent", client: "not_sent", completedSigners: 0, requiredSigners: 2, lastEventAt: null, overall: "Draft" },
    retention: { status: "not-required", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: false, certificate: false },
    billing: { eligibility: "BLOCKED_UNSIGNED", blockedReason: "Agreement is 'approved', not signed.", stripeMode: "test", amountCents: 725_000, currency: "usd", paymentAuthorized: false, paid: false },
    readiness: { providerConfigReady: true, clientVerified: true, approvalCurrent: false, sendAuthorizationCurrent: false, productionFlagsEnabled: false, nextAction: "Review agreement", blockedReason: null },
    audit: [
      { action: "agreement.generated", actor: "jordan", at: "2026-08-01T00:00:00Z", outcome: null, meta: "" },
    ],
    ...over,
  };
}

// A valid production agreement ALWAYS has a verified client — an unverified production
// client can never make valid progress (see the explicit `unverified` fixture below).
const production = (v: ClosingWorkspaceView): ClosingWorkspaceView => ({
  ...v,
  agreement: { ...v.agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false },
  client: { ...v.client, verified: true },
  billing: { ...v.billing, stripeMode: "live" },
  readiness: { ...v.readiness, clientVerified: true },
});

const STATES: Record<string, ClosingWorkspaceView> = {
  draft: base(),
  approved: base({
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "none" },
    signing: { ...base().signing, overall: "Approved" },
    readiness: { ...base().readiness, approvalCurrent: true, nextAction: "Authorize sending" },
    audit: [
      { action: "agreement.approved", actor: "jordan", at: "2026-08-20T00:00:00Z", outcome: null, meta: `digest=${DIGEST.slice(0, 16)}` },
      { action: "agreement.generated", actor: "jordan", at: "2026-08-01T00:00:00Z", outcome: null, meta: "" },
    ],
  }),
  send_authorized: base({
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "active" },
    signing: { ...base().signing, overall: "Send authorized" },
    readiness: { ...base().readiness, approvalCurrent: true, sendAuthorizationCurrent: true, nextAction: "Send agreement" },
  }),
  partial: production(base({
    agreement: { ...base().agreement, status: "sent" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1" },
    signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "2026-08-21T00:00:00Z", overall: "Partially signed" },
    billing: { ...base().billing, eligibility: "BLOCKED_PARTIAL_SIGNATURE", blockedReason: "Not all required signers have completed (no document_completed).", stripeMode: "live" },
    readiness: { ...base().readiness, approvalCurrent: true, sendAuthorizationCurrent: false, productionFlagsEnabled: true, nextAction: "Await remaining signature" },
  })),
  completed: production(base({
    agreement: { ...base().agreement, status: "signed" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", signedPdfSha256: SHA, auditPage: "separate" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "2026-08-22T00:00:00Z", overall: "Completed" },
    retention: { status: "retained", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: true, certificate: true },
    billing: { ...base().billing, eligibility: "BLOCKED_LIVE_AUTH_MISSING", blockedReason: "Explicit owner live-payment authorization is required.", stripeMode: "live" },
    readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Authorize exact payment" },
  })),
  retention_failed: production(base({
    agreement: { ...base().agreement, status: "signed" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", auditPage: "none" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "2026-08-22T00:00:00Z", overall: "Completed" },
    retention: { status: "failed", failureReason: "retrieval failed — retry available", retryAvailable: true, auditPageEmbedded: false, signedPdf: false, certificate: false },
    billing: { ...base().billing, eligibility: "BLOCKED_RETENTION_FAILED", blockedReason: "Signed PDF / audit certificate retention failed.", stripeMode: "live" },
    readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Retry signed-document retention" },
  })),
  retained: production(base({
    agreement: { ...base().agreement, status: "signed" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", signedPdfSha256: SHA, auditPage: "embedded" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "2026-08-22T00:00:00Z", overall: "Completed" },
    retention: { status: "retained", failureReason: null, retryAvailable: false, auditPageEmbedded: true, signedPdf: true, certificate: false },
    billing: { ...base().billing, eligibility: "BLOCKED_LIVE_AUTH_MISSING", blockedReason: "Explicit owner live-payment authorization is required.", stripeMode: "live" },
    readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Authorize exact payment" },
  })),
  eligible_live: production(base({
    agreement: { ...base().agreement, status: "signed" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", signedPdfSha256: SHA, auditPage: "separate" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "2026-08-22T00:00:00Z", overall: "Completed" },
    retention: { status: "retained", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: true, certificate: true },
    billing: { ...base().billing, eligibility: "ELIGIBLE_LIVE_PAYMENT", blockedReason: "Production agreement — all live-payment gates satisfied.", stripeMode: "live", paymentAuthorized: true },
    readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Authorize exact payment" },
  })),
  paid: production(base({
    agreement: { ...base().agreement, status: "signed" },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", signedPdfSha256: SHA, auditPage: "separate" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "2026-08-22T00:00:00Z", overall: "Completed" },
    retention: { status: "retained", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: true, certificate: true },
    billing: { ...base().billing, eligibility: "PAID", blockedReason: "Deposit already collected.", stripeMode: "live", paymentAuthorized: true, paid: true },
    readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "No action required" },
  })),
  // Explicit BLOCKED state: a production agreement whose client is NOT verified. Billing
  // is a recipient/verification block (NOT a live-auth-missing state), so the workspace
  // invariants still hold (unverified never reaches a payment-eligible state). The UI must
  // render this as an error/blocked state with approval/send/pay disabled.
  unverified: base({
    agreement: { ...base().agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false },
    client: { ...base().client, verified: false },
    document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "none" },
    signing: { ...base().signing, overall: "Draft" },
    billing: { ...base().billing, eligibility: "BLOCKED_RECIPIENT_MISMATCH", blockedReason: "Client identity is not verified — recipients cannot be confirmed.", stripeMode: "live" },
    readiness: { ...base().readiness, approvalCurrent: false, productionFlagsEnabled: true, clientVerified: false, nextAction: "Verify client identity", blockedReason: "Client identity is not verified." },
  }),
};

export default function ClosingWorkspacePreview({ searchParams }: { searchParams: { state?: string } }) {
  if (process.env.NODE_ENV === "production") notFound();
  const key = searchParams.state && STATES[searchParams.state] ? searchParams.state : "draft";
  return (
    <div className="p-4 sm:p-6">
      <p className="mx-auto mb-2 max-w-3xl text-xs text-neutral-500">DEV PREVIEW · ClosingWorkspace · state=<b>{key}</b></p>
      <ClosingWorkspace view={STATES[key]} agreementId="agr_preview" />
    </div>
  );
}
