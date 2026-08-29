import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, insertAgreementApproval, insertSignedArtifact, hasLivePaymentAuthorization } from "../repo";
import { makeAgreement, makeLead } from "../agreement/test-fixtures";
import { buildApprovalBinding, approvalDigest } from "../agreement/approval";
import { authorizeLivePayment } from "./live-payment-auth";
import type { SignedArtifact } from "./retention";

const PDF_SHA = "a".repeat(64);

async function setup(over: { esignMode?: "test" | "production"; retained?: boolean } = {}) {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status: "signed", leadId: lead.id, esignRequestId: "doc_lp" });
  const { id, createdAt, updatedAt, ...rest } = a;
  const agreement = await insertAgreement({ ...rest, esignMode: over.esignMode ?? "production" } as any);
  void id; void createdAt; void updatedAt;
  const binding = buildApprovalBinding(agreement, { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: "dana@copperoak.com", esignMode: over.esignMode ?? "production", stripeMode: over.esignMode === "test" ? "test" : "live", unsignedPdfSha256: PDF_SHA });
  await insertAgreementApproval({ agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null } as any);
  if (over.retained !== false) {
    for (const kind of ["signed_pdf", "audit_certificate"] as const) {
      const art: SignedArtifact = { id: `art_${kind}`, agreementId: agreement.id, esignRequestId: "doc_lp", kind, sha256: "h".repeat(64), byteSize: 10, storageKey: `k/${kind}`, approvalDigest: approvalDigest(binding), esignMode: "production", status: "retained", retryCount: 0, retrievedAt: "t", createdAt: "t" };
      await insertSignedArtifact(art);
    }
  }
  return { agreement, binding };
}
const dep = (b: any) => ({ amountCents: b.depositAmountCents, currency: b.currency });

describe("authorizeLivePayment (Gate 11)", () => {
  beforeEach(() => __resetStoreForTests());

  it("authorizes a fully-eligible production agreement (all-but-auth passing)", async () => {
    const { agreement, binding } = await setup();
    const r = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", ...dep(binding) });
    expect(r.ok, r.reason).toBe(true);
    expect(r.authorizationId).toBeTruthy();
    expect(await hasLivePaymentAuthorization(agreement.id)).toBe(true);
  });

  it("refuses a TEST agreement", async () => {
    const { agreement, binding } = await setup({ esignMode: "test" });
    const r = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", ...dep(binding) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/TEST agreement/);
  });

  it("refuses when retention is not complete", async () => {
    const { agreement, binding } = await setup({ retained: false });
    const r = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", ...dep(binding) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Not ready|RETENTION/i);
  });

  it("refuses an amount/currency mismatch", async () => {
    const { agreement, binding } = await setup();
    expect((await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", amountCents: binding.depositAmountCents + 1, currency: binding.currency })).reason).toMatch(/Amount differs/);
    expect((await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", amountCents: binding.depositAmountCents, currency: "eur" })).reason).toMatch(/Currency differs/);
  });

  it("refuses an unauthorized role and is idempotent", async () => {
    const { agreement, binding } = await setup();
    expect((await authorizeLivePayment({ agreementId: agreement.id, actor: "e", actorRole: "engineering", ...dep(binding) })).ok).toBe(false);
    const first = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", ...dep(binding) });
    const second = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", ...dep(binding) });
    expect(first.ok && second.ok).toBe(true);
  });
});
