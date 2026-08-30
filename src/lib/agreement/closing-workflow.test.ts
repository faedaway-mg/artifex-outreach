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

import { sendApprovedAgreementForSignature, type SendInput } from "./closing-workflow";
import { authorizeAgreementSend } from "./send-authorization";
import { getAgreement } from "../repo";

function sendBase(agreementId: string, sender: any, over: Partial<SendInput> = {}): SendInput {
  return {
    agreementId, actor: "jordan", actorRole: "founder", esignMode: "test", stripeMode: "test",
    client: { name: "Jordan", email: "jordant.jackson@gmail.com", verified: false, recordEmail: null },
    pdfBase64: "BASE64", unsignedPdfSha256: PDF_SHA, subject: "s", message: "m",
    productionGateOn: false, sendingGateOn: false, env: PROD_ENV, operatorEmails: [], knownTestRecipients: [], sender,
    ...over,
  };
}
// Authorize sending for a test-mode agreement (mirrors the sendBase client/mode).
async function authTest(agreementId: string) {
  return authorizeAgreementSend({ agreementId, actor: "jordan", actorRole: "founder", esignMode: "test", stripeMode: "test", client: { name: "Jordan", email: "jordant.jackson@gmail.com", verified: false, recordEmail: null }, unsignedPdfSha256: PDF_SHA, productionGateOn: false, sendingGateOn: false, env: PROD_ENV });
}

describe("sendApprovedAgreementForSignature (Gate 5 wiring)", () => {
  beforeEach(() => __resetStoreForTests());

  it("blocks without a send authorization (approval alone cannot send)", async () => {
    const a = await mkAgreement();
    let calls = 0;
    const r = await sendApprovedAgreementForSignature(sendBase(a.id, async () => { calls++; return { ok: true, requestId: "x", signingUrl: null }; }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/send authorization/);
    expect(calls).toBe(0);
  });

  it("test-mode: passes preflight, calls the injected provider, persists sent state", async () => {
    const a = await mkAgreement();
    await authTest(a.id);
    let calls = 0; let captured: any = null;
    const sender = async (inp: any) => { calls++; captured = inp; return { ok: true, requestId: "doc_x", signingUrl: null }; };
    const r = await sendApprovedAgreementForSignature(sendBase(a.id, sender));
    expect(r.ok, r.reason).toBe(true);
    expect(calls).toBe(1);
    expect(captured.recipients.map((x: any) => x.order)).toEqual([1, 2]); // two-signer via the shared builder
    expect(captured.testMode).toBe(true);
    const after = await getAgreement(a.id);
    expect(after?.status).toBe("sent");
    expect(after?.esignRequestId).toBe("doc_x");
  });

  it("does NOT call the provider when preflight fails (production, no approval)", async () => {
    const a = await mkAgreement();
    let calls = 0;
    const sender = async () => { calls++; return { ok: true, requestId: "doc_y", signingUrl: null }; };
    const r = await sendApprovedAgreementForSignature(sendBase(a.id, sender, { esignMode: "production", stripeMode: "live", productionGateOn: true, sendingGateOn: true, client: { name: "Dana", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" } }));
    expect(r.ok).toBe(false);
    expect(calls).toBe(0); // provider never invoked on preflight failure
    expect((await getAgreement(a.id))?.esignRequestId).toBeFalsy(); // no false sent state
  });

  it("is idempotent — a second send does not create a second document", async () => {
    const a = await mkAgreement();
    await authTest(a.id);
    let calls = 0;
    const sender = async () => { calls++; return { ok: true, requestId: "doc_once", signingUrl: null }; };
    await sendApprovedAgreementForSignature(sendBase(a.id, sender));
    const second = await sendApprovedAgreementForSignature(sendBase(a.id, sender));
    expect(second.idempotent).toBe(true);
    expect(calls).toBe(1);
  });

  it("provider failure leaves no sent state", async () => {
    const a = await mkAgreement();
    await authTest(a.id);
    const sender = async () => ({ ok: false, requestId: null, signingUrl: null, error: "boom" });
    const r = await sendApprovedAgreementForSignature(sendBase(a.id, sender));
    expect(r.ok).toBe(false);
    expect((await getAgreement(a.id))?.esignRequestId).toBeFalsy();
  });
});
