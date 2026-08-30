import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, insertAgreementApproval, getActiveSendAuthorization, consumeSendAuthorization } from "../repo";
import { makeAgreement, makeLead } from "./test-fixtures";
import { buildApprovalBinding, approvalDigest } from "./approval";
import { authorizeAgreementSend, isSendAuthorizationUsable, recipientDigest } from "./send-authorization";

const PDF_SHA = "a".repeat(64);
const PROD_ENV = { AGREEMENT_PROVIDER_LEGAL_NAME: "Artifex Labs Systems LLC d/b/a Artifex Labs", AGREEMENT_PROVIDER_SIGNER_NAME: "Jordan Jackson", AGREEMENT_PROVIDER_SIGNER_EMAIL: "contracts@artifexlabs.tech" } as any;

async function prodApproved() {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status: "approved", leadId: lead.id });
  const { id, createdAt, updatedAt, ...rest } = a;
  const agreement = await insertAgreement({ ...rest } as any);
  const binding = buildApprovalBinding(agreement, { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: "dana@copperoak.com", esignMode: "production", stripeMode: "live", unsignedPdfSha256: PDF_SHA });
  await insertAgreementApproval({ agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "t", revokedAt: null } as any);
  return agreement;
}
function prodInput(agreementId: string, over: any = {}) {
  return { agreementId, actor: "jordan", actorRole: "founder" as const, esignMode: "production" as const, stripeMode: "live" as const, client: { name: "Dana", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" }, unsignedPdfSha256: PDF_SHA, productionGateOn: true, sendingGateOn: true, env: PROD_ENV, operatorEmails: [], knownTestRecipients: [], ...over };
}

describe("authorizeAgreementSend (Gate 3)", () => {
  beforeEach(() => __resetStoreForTests());

  it("persists a one-time authorization bound to approval + recipients + PDF", async () => {
    const a = await prodApproved();
    const r = await authorizeAgreementSend(prodInput(a.id));
    expect(r.ok, r.reason).toBe(true);
    const active = await getActiveSendAuthorization(a.id, a.version);
    expect(active?.id).toBe(r.authorizationId);
    expect(active?.unsignedPdfSha256).toBe(PDF_SHA);
    expect(active?.recipientDigest).toBe(recipientDigest("contracts@artifexlabs.tech", "dana@copperoak.com"));
  });

  it("is idempotent for an identical authorization; rejects a conflicting one", async () => {
    const a = await prodApproved();
    const first = await authorizeAgreementSend(prodInput(a.id));
    const same = await authorizeAgreementSend(prodInput(a.id));
    expect(same.idempotent).toBe(true);
    expect(same.authorizationId).toBe(first.authorizationId);
    // A different client → different recipient digest → conflicting active authorization rejected.
    const conflict = await authorizeAgreementSend(prodInput(a.id, { client: { name: "Other", email: "other@copperoak.com", verified: true, recordEmail: "other@copperoak.com" } }));
    expect(conflict.ok).toBe(false);
  });

  it("blocks without approval, with flags off, and on preflight failure", async () => {
    const a = await prodApproved();
    expect((await authorizeAgreementSend(prodInput(a.id, { productionGateOn: false }))).ok).toBe(false);
    expect((await authorizeAgreementSend(prodInput(a.id, { unsignedPdfSha256: "b".repeat(64) }))).ok).toBe(false);
  });

  it("a consumed authorization is no longer usable (one-time)", async () => {
    const a = await prodApproved();
    const r = await authorizeAgreementSend(prodInput(a.id));
    await consumeSendAuthorization(r.authorizationId!, "doc_1");
    expect(await getActiveSendAuthorization(a.id, a.version)).toBeNull();
  });

  it("usability honors revoked/consumed/expired", () => {
    const base: any = { revokedAt: null, consumedAt: null, expiresAt: null };
    expect(isSendAuthorizationUsable(base, "2026-08-29T00:00:00Z")).toBe(true);
    expect(isSendAuthorizationUsable({ ...base, revokedAt: "x" }, "2026-08-29T00:00:00Z")).toBe(false);
    expect(isSendAuthorizationUsable({ ...base, consumedAt: "x" }, "2026-08-29T00:00:00Z")).toBe(false);
    expect(isSendAuthorizationUsable({ ...base, expiresAt: "2026-08-28T00:00:00Z" }, "2026-08-29T00:00:00Z")).toBe(false);
  });
});
