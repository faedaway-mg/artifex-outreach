import { describe, it, expect } from "vitest";
import {
  buildClosingWorkspaceView, assertWorkspaceInvariants, summarizeWorkspaceRow,
  WorkspaceInvariantError, type BuildWorkspaceInput, type ClosingWorkspaceView,
} from "./closing-workspace-view";
import { makeAgreement } from "../agreement/test-fixtures";
import { buildApprovalBinding, approvalDigest } from "../agreement/approval";
import type { SignedArtifact } from "./retention";

const PDF_SHA = "a".repeat(64);
function approvalFor(a: any) {
  const binding = buildApprovalBinding(a, { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: "dana@copperoak.com", esignMode: "production", stripeMode: "live", unsignedPdfSha256: PDF_SHA });
  return { id: "appr", agreementId: a.id, agreementVersion: a.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "t", revokedAt: null };
}
function base(over: Partial<BuildWorkspaceInput> = {}): BuildWorkspaceInput {
  return { agreement: makeAgreement({ status: "approved" }), approval: null, sendAuth: null, signedArtifacts: [], livePaymentAuthorized: false, invoices: [], payments: [], audit: [], providerConfigReady: true, productionFlagsEnabled: false, clientVerified: true, nowIso: "2026-08-29T00:00:00Z", ...over };
}
const retained: SignedArtifact[] = (["signed_pdf", "audit_certificate"] as const).map((kind) => ({ id: kind, agreementId: "x", esignRequestId: "d", kind, sha256: "h", byteSize: 1, storageKey: "k", approvalDigest: null, esignMode: "production", status: "retained", retryCount: 0, retrievedAt: "t", createdAt: "t" }));

describe("buildClosingWorkspaceView (Gate 3 view-model)", () => {
  it("approved-status agreement without an approval record → complete operator review", () => {
    const v = buildClosingWorkspaceView(base());
    expect(v.agreement.legallyBinding).toBe(false); // null mode → test
    expect(v.signing.requiredSigners).toBe(2);
    // status is 'approved' (lifecycle) but no bound approval record exists yet: the one
    // coherent next action is to complete operator review (not to send/pay).
    expect(v.readiness.nextAction).toBe("Complete operator review");
    expect(v.billing.eligibility).toBe("BLOCKED_UNSIGNED");
  });

  it("a true draft (no approval) → review agreement", () => {
    const v = buildClosingWorkspaceView(base({ agreement: makeAgreement({ status: "draft" }) }));
    expect(v.readiness.nextAction).toBe("Review agreement");
  });

  it("never shows 1/2 as complete; production is legally binding", () => {
    const a = makeAgreement({ status: "sent", esignRequestId: "doc" }); (a as any).esignMode = "production";
    const v = buildClosingWorkspaceView(base({ agreement: a, approval: approvalFor(a), audit: [{ id: "e", action: "signwell.recipients", actor: "sys", targetType: "agreement", targetId: a.id, meta: { recipients: [{ id: "provider", status: "completed" }, { id: "client", status: "viewed" }] }, ip: null, createdAt: "t" }] }));
    expect(v.agreement.legallyBinding).toBe(true);
    expect(v.signing.completedSigners).toBe(1);
    expect(v.signing.overall).toBe("Partially signed");
    expect(v.billing.eligibility).not.toBe("ELIGIBLE_LIVE_PAYMENT");
  });

  it("signed + retained + authorized production → eligible for live payment", () => {
    const a = makeAgreement({ status: "signed", esignRequestId: "doc" }); (a as any).esignMode = "production";
    const v = buildClosingWorkspaceView(base({ agreement: a, approval: approvalFor(a), signedArtifacts: retained.map((r) => ({ ...r, agreementId: a.id })), livePaymentAuthorized: true }));
    expect(v.signing.overall).toBe("Completed");
    expect(v.retention.status).toBe("retained");
    expect(v.billing.eligibility).toBe("ELIGIBLE_LIVE_PAYMENT");
    expect(v.document.auditPage).toBe("separate");
  });

  it("test agreement can never be ELIGIBLE_LIVE_PAYMENT and is not legally binding", () => {
    const a = makeAgreement({ status: "signed", esignRequestId: "doc" }); (a as any).esignMode = "test";
    const v = buildClosingWorkspaceView(base({ agreement: a, approval: approvalFor(a), signedArtifacts: retained.map((r) => ({ ...r, agreementId: a.id })), livePaymentAuthorized: true }));
    expect(v.agreement.legallyBinding).toBe(false);
    expect(v.billing.eligibility).toBe("ELIGIBLE_TEST_PAYMENT");
  });

  it("fails closed: production signed+authorized but UNVERIFIED client throws (invariant catches persisted inconsistency)", () => {
    const a = makeAgreement({ status: "signed", esignRequestId: "doc" }); (a as any).esignMode = "production";
    expect(() =>
      buildClosingWorkspaceView(base({
        agreement: a, approval: approvalFor(a),
        signedArtifacts: retained.map((r) => ({ ...r, agreementId: a.id })),
        livePaymentAuthorized: true, clientVerified: false,
      })),
    ).toThrow(WorkspaceInvariantError);
  });
});

// ── Gate 1 — view-model invariants throw on each impossible combination ───────────
const SHA = "a".repeat(64);
const DIGEST = "b".repeat(64);
function validView(over: Partial<ClosingWorkspaceView> = {}): ClosingWorkspaceView {
  return {
    agreement: { id: "agr1", number: "AL-A-2026-001", version: 1, status: "signed", esignMode: "production", legallyBinding: true, signwellTestMode: false, createdAt: "t", updatedAt: "t" },
    provider: { legalEntity: "Artifex Labs Systems LLC", signerName: "Jordan", signerEmail: "contracts@artifexlabs.tech" },
    client: { legalName: "Copper Oak LLC", businessName: "Copper Oak", signerName: "Dana", signerEmail: "dana@copperoak.com", verified: true },
    terms: { scope: ["Brand"], deliverables: ["Logo"], totalCents: 1_450_000, depositCents: 725_000, remainingCents: 725_000, currency: "usd", monthlyCents: null },
    document: { unsignedPdfSha256: SHA, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1", signedPdfSha256: SHA, auditPage: "separate" },
    signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "t", overall: "Completed" },
    retention: { status: "retained", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: true, certificate: true },
    billing: { eligibility: "ELIGIBLE_LIVE_PAYMENT", blockedReason: "ok", stripeMode: "live", amountCents: 725_000, currency: "usd", paymentAuthorized: true, paid: false },
    readiness: { providerConfigReady: true, clientVerified: true, approvalCurrent: true, sendAuthorizationCurrent: false, productionFlagsEnabled: true, nextAction: "Authorize exact payment", blockedReason: null },
    audit: [],
    ...over,
  };
}
function expectThrows(code: string, view: ClosingWorkspaceView) {
  let err: unknown;
  try { assertWorkspaceInvariants(view); } catch (e) { err = e; }
  expect(err, `expected invariant '${code}' to throw`).toBeInstanceOf(WorkspaceInvariantError);
  expect((err as WorkspaceInvariantError).code).toBe(code);
}

describe("assertWorkspaceInvariants (Gate 1)", () => {
  it("accepts a fully coherent production view", () => {
    expect(() => assertWorkspaceInvariants(validView())).not.toThrow();
  });
  it("throws: production + payment-eligible + client.verified=false", () => {
    expectThrows("PROD_PAYMENT_ELIGIBLE_UNVERIFIED_CLIENT", validView({
      client: { ...validView().client, verified: false },
      billing: { ...validView().billing, eligibility: "BLOCKED_LIVE_AUTH_MISSING" },
    }));
  });
  it("throws: completed/2-of-2 while completedSigners < 2", () => {
    expectThrows("COMPLETED_WITH_INSUFFICIENT_SIGNERS", validView({
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Completed" },
    }));
  });
  it("throws: retained while signing not completed", () => {
    expectThrows("RETAINED_BEFORE_SIGNING_COMPLETE", validView({
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Partially signed" },
    }));
  });
  it("throws: ELIGIBLE_LIVE_PAYMENT for a test agreement", () => {
    expectThrows("LIVE_PAYMENT_FOR_TEST_AGREEMENT", validView({
      agreement: { ...validView().agreement, esignMode: "test", legallyBinding: false, signwellTestMode: true },
    }));
  });
  it("throws: paid without paymentAuthorized", () => {
    expectThrows("PAID_WITHOUT_AUTHORIZATION", validView({
      billing: { ...validView().billing, eligibility: "PAID", paid: true, paymentAuthorized: false },
    }));
  });
  it("throws: legallyBinding while signwellTestMode true", () => {
    expectThrows("LEGALLY_BINDING_IN_TEST_MODE", validView({
      agreement: { ...validView().agreement, legallyBinding: true, signwellTestMode: true },
    }));
  });
  it("throws: retention 'retained' while signed artifact missing", () => {
    expectThrows("RETAINED_MISSING_ARTIFACT", validView({
      retention: { ...validView().retention, status: "retained", signedPdf: false },
    }));
  });
  it("summarizeWorkspaceRow projects the compact row from the same view", () => {
    const row = summarizeWorkspaceRow(validView());
    expect(row.client).toBe("Copper Oak");
    expect(row.mode).toBe("production");
    expect(row.completedSigners).toBe(2);
    expect(row.eligibility).toBe("ELIGIBLE_LIVE_PAYMENT");
    expect(row.eligibilityBlocked).toBe(false);
    expect(row.nextAction).toBe("Authorize exact payment");
  });
});
