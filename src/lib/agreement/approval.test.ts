import { describe, it, expect } from "vitest";
import { buildApprovalBinding, approvalDigest, bindingDriftReasons, approvalValidReasons, canonicalize, APPROVAL_RECORD_VERSION, type AgreementApproval } from "./approval";
import { makeAgreement } from "./test-fixtures";

const opts = {
  providerSignerEmail: "contracts@artifexlabs.tech",
  clientEmail: "dana@copperoak.com",
  esignMode: "production" as const,
  stripeMode: "live" as const,
  unsignedPdfSha256: "a".repeat(64),
};

describe("approval binding + digest", () => {
  it("digest is deterministic and order-independent for object keys", () => {
    const b1 = buildApprovalBinding(makeAgreement(), opts);
    const b2 = buildApprovalBinding(makeAgreement(), opts);
    expect(approvalDigest(b1)).toBe(approvalDigest(b2));
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(b1.approvalRecordVersion).toBe(APPROVAL_RECORD_VERSION);
    expect(b1.recipients).toEqual([
      { role: "provider", order: 1, email: "contracts@artifexlabs.tech" },
      { role: "client", order: 2, email: "dana@copperoak.com" },
    ]);
  });

  it("any material drift changes the digest and is itemized", () => {
    const approved = buildApprovalBinding(makeAgreement(), opts);
    const cases: Array<[string, ReturnType<typeof buildApprovalBinding>]> = [
      ["deposit amount", { ...approved, depositAmountCents: approved.depositAmountCents + 1 }],
      ["total price", { ...approved, totalPriceCents: approved.totalPriceCents + 1 }],
      ["client email", { ...approved, clientEmail: "someone@else.com", recipients: approved.recipients.map((r) => (r.role === "client" ? { ...r, email: "someone@else.com" } : r)) }],
      ["scope", { ...approved, scope: [...approved.scope, "extra"] }],
      ["unsigned PDF sha256", { ...approved, unsignedPdfSha256: "b".repeat(64) }],
      ["esign mode", { ...approved, esignMode: "test" }],
      ["stripe mode", { ...approved, stripeMode: "test" }],
      ["agreement version", { ...approved, agreementVersion: approved.agreementVersion + 1 }],
    ];
    for (const [label, drifted] of cases) {
      expect(approvalDigest(drifted), label).not.toBe(approvalDigest(approved));
      const reasons = bindingDriftReasons(approved, drifted);
      expect(reasons.length, label).toBeGreaterThan(0);
    }
  });

  it("no drift → digest equal, zero reasons", () => {
    const a = buildApprovalBinding(makeAgreement(), opts);
    const b = buildApprovalBinding(makeAgreement(), opts);
    expect(bindingDriftReasons(a, b)).toHaveLength(0);
    expect(approvalDigest(a)).toBe(approvalDigest(b));
  });
});

describe("approvalValidReasons", () => {
  const mk = (over: Partial<AgreementApproval> = {}): AgreementApproval => {
    const binding = buildApprovalBinding(makeAgreement(), opts);
    return { id: "appr_1", agreementId: binding.agreementId, agreementVersion: binding.agreementVersion, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00.000Z", revokedAt: null, ...over };
  };
  it("valid when not revoked/expired and digest intact", () => {
    expect(approvalValidReasons(mk(), "2026-08-30T00:00:00.000Z")).toHaveLength(0);
  });
  it("flags revoked, expired, and tampered digest", () => {
    expect(approvalValidReasons(mk({ revokedAt: "2026-08-29T01:00:00.000Z" }), "2026-08-30T00:00:00.000Z").join(" ")).toMatch(/revoked/);
    const exp = mk(); exp.binding = { ...exp.binding, expiresAt: "2026-08-29T00:00:00.000Z" }; exp.digest = approvalDigest(exp.binding);
    expect(approvalValidReasons(exp, "2026-08-30T00:00:00.000Z").join(" ")).toMatch(/expired/);
    expect(approvalValidReasons(mk({ digest: "deadbeef" }), "2026-08-30T00:00:00.000Z").join(" ")).toMatch(/digest/);
  });
});
