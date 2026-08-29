import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, getAgreementApproval } from "../repo";
import { makeAgreement, makeLead } from "./test-fixtures";
import { approveAgreementForSigning, type ApproveInput } from "./closing-workflow";

const PDF_SHA = "a".repeat(64);
const PROD_ENV = { AGREEMENT_PROVIDER_LEGAL_NAME: "Artifex Labs Systems LLC d/b/a Artifex Labs", AGREEMENT_PROVIDER_SIGNER_NAME: "Jordan Jackson", AGREEMENT_PROVIDER_SIGNER_EMAIL: "contracts@artifexlabs.tech" } as any;

async function mkAgreement(status: any = "approved") {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status, leadId: lead.id });
  const { id, createdAt, updatedAt, ...rest } = a;
  return insertAgreement({ ...rest } as any);
}
function baseInput(agreementId: string, over: Partial<ApproveInput> = {}): ApproveInput {
  return {
    agreementId, actor: "jordan", actorRole: "founder", esignMode: "production", stripeMode: "live",
    client: { name: "Dana", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" },
    unsignedPdfSha256: PDF_SHA, confirmed: true, operatorEmails: ["jordant.jackson@gmail.com"], knownTestRecipients: [], env: PROD_ENV,
    ...over,
  };
}

describe("approveAgreementForSigning (Gate 3 wiring)", () => {
  beforeEach(() => __resetStoreForTests());

  it("persists an immutable approval bound to the exact terms + PDF", async () => {
    const a = await mkAgreement();
    const r = await approveAgreementForSigning(baseInput(a.id));
    expect(r.ok, r.reason).toBe(true);
    expect(r.digest).toHaveLength(64);
    const stored = await getAgreementApproval(a.id, a.version);
    expect(stored?.digest).toBe(r.digest);
    expect(stored?.approvedBy).toBe("jordan");
  });

  it("requires explicit confirmation and authorization", async () => {
    const a = await mkAgreement();
    expect((await approveAgreementForSigning(baseInput(a.id, { confirmed: false }))).ok).toBe(false);
    expect((await approveAgreementForSigning(baseInput(a.id, { actorRole: "engineering" }))).ok).toBe(false);
  });

  it("does NOT send (only persists an approval)", async () => {
    const a = await mkAgreement();
    await approveAgreementForSigning(baseInput(a.id));
    // No esignRequestId / sent state is set by approval.
    const { getAgreement } = await import("../repo");
    const after = await getAgreement(a.id);
    expect(after?.esignRequestId).toBeFalsy();
    expect(after?.status).toBe("approved");
  });

  it("is idempotent for an identical approval; rejects a conflicting one", async () => {
    const a = await mkAgreement();
    const first = await approveAgreementForSigning(baseInput(a.id));
    const same = await approveAgreementForSigning(baseInput(a.id));
    expect(same.ok && same.idempotent).toBe(true);
    expect(same.approvalId).toBe(first.approvalId);
    // A different PDF hash → conflicting approval is rejected (needs a new version).
    const conflict = await approveAgreementForSigning(baseInput(a.id, { unsignedPdfSha256: "b".repeat(64) }));
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toMatch(/different approval already exists/);
  });

  it("production blocks on invalid provider config, plus-alias client, and unverified client", async () => {
    const a = await mkAgreement();
    expect((await approveAgreementForSigning(baseInput(a.id, { env: {} as any }))).ok).toBe(false);
    expect((await approveAgreementForSigning(baseInput(a.id, { client: { name: "X", email: "jordant.jackson+c@gmail.com", verified: true, recordEmail: "jordant.jackson+c@gmail.com" } }))).ok).toBe(false);
    expect((await approveAgreementForSigning(baseInput(a.id, { client: { name: "Dana", email: "dana@copperoak.com", verified: false, recordEmail: "dana@copperoak.com" } }))).ok).toBe(false);
  });

  it("cannot approve once past pre-send", async () => {
    const a = await mkAgreement("sent");
    expect((await approveAgreementForSigning(baseInput(a.id))).reason).toMatch(/past pre-send/);
  });

  it("test mode does not require provider config", async () => {
    const a = await mkAgreement();
    const r = await approveAgreementForSigning(baseInput(a.id, { esignMode: "test", stripeMode: "test", env: {} as any, client: { name: "T", email: "jordant.jackson@gmail.com", verified: false, recordEmail: null } }));
    expect(r.ok, r.reason).toBe(true);
  });
});
