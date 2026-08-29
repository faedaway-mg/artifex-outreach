import { describe, it, expect } from "vitest";
import { buildClosingWorkspaceView, type BuildWorkspaceInput } from "./closing-workspace-view";
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
  it("draft/approved agreement → needs review / approve next", () => {
    const v = buildClosingWorkspaceView(base());
    expect(v.agreement.legallyBinding).toBe(false); // null mode → test
    expect(v.signing.requiredSigners).toBe(2);
    expect(v.readiness.nextAction).toMatch(/approve/i);
    expect(v.billing.eligibility).toBe("BLOCKED_UNSIGNED");
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
});
