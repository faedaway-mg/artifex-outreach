// Gate 15 — complete intercepted production-path simulation. NO real network, NO real
// SignWell document, NO live Stripe object. Exercises preflight → shared request builder →
// authenticated completion → Gate 10 retention orchestration (mock fetch + real Postgres
// blob adapter over the in-memory store) → live-payment authorization → intercepted
// firewall decision, plus the critical negative cases.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, getAgreement, insertAgreementApproval, updateAgreement } from "../repo";
import { makeAgreement, makeLead } from "../agreement/test-fixtures";
import { handleSignwellWebhook } from "../esign/webhook";
import { resolveProviderSignerConfig } from "../esign/provider-config";
import { sendPreflight } from "../agreement/send-preflight";
import { buildSignwellRequestBody } from "../esign/request-builder";
import { buildApprovalBinding, approvalDigest } from "../agreement/approval";
import { PostgresBlobStorage } from "./postgres-storage";
import { processCompletionRetention } from "./completion-retention";
import { authorizeLivePayment } from "./live-payment-auth";
import { assertAgreementBillingAllowed } from "./firewall-gate";
import { BillingFirewallError } from "./eligibility";
import type { CompletedDocumentFetcher } from "./retention";

const PROD_ENV = { AGREEMENT_PROVIDER_LEGAL_NAME: "Artifex Labs Systems LLC d/b/a Artifex Labs", AGREEMENT_PROVIDER_SIGNER_NAME: "Jordan Jackson", AGREEMENT_PROVIDER_SIGNER_EMAIL: "contracts@artifexlabs.tech" } as any;
const PDF_SHA = "a".repeat(64);
const WEBHOOK_ID = "whk_sim"; const TIME = 1787990119;
const hashFor = (type: string) => createHmac("sha256", WEBHOOK_ID).update(`${type}@${TIME}`).digest("hex");
const completion = (docId: string, testMode: boolean) => JSON.stringify({ event: { id: `evt_${docId}`, type: "document_completed", time: TIME, hash: hashFor("document_completed") }, data: { object: { id: docId, status: "completed", test_mode: testMode, recipients: [{ id: "provider", status: "completed" }, { id: "client", status: "completed" }] } } });
const signerEvent = (docId: string) => JSON.stringify({ event: { id: `evts_${docId}`, type: "document_signed", time: TIME, hash: hashFor("document_signed") }, data: { object: { id: docId, status: "in progress", test_mode: false, recipients: [{ id: "provider", status: "completed" }, { id: "client", status: "viewed" }] } } });
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const okFetcher: CompletedDocumentFetcher = { async fetch(_id, kind) { return { bytes: PDF, kind }; } };
const failFetcher: CompletedDocumentFetcher = { async fetch() { throw new Error("retrieval down"); } };

async function makeProdSigned(docId: string, opts: { client?: string; markSent?: boolean } = {}) {
  const lead = await insertLead(makeLead() as any);
  // esignRequestId is set only AFTER the (intercepted) send — preflight requires it null.
  const a = makeAgreement({ status: "approved", leadId: lead.id, esignRequestId: opts.markSent === false ? null : docId });
  const { id, createdAt, updatedAt, ...rest } = a;
  const agreement = await insertAgreement({ ...rest, esignMode: "production", esignRequestId: opts.markSent === false ? null : docId } as any);
  void id; void createdAt; void updatedAt;
  const binding = buildApprovalBinding(agreement, { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: opts.client ?? "dana@copperoak.com", esignMode: "production", stripeMode: "live", unsignedPdfSha256: PDF_SHA });
  await insertAgreementApproval({ agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null } as any);
  return { agreement, binding };
}

describe("Gate 15 — complete intercepted production-path simulation", () => {
  beforeEach(() => __resetStoreForTests());
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; });

  it("happy path: preflight → request(test_mode:false, 2 recipients) → complete → retain → authorize → firewall permits LIVE (no network)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_simulated";
    const docId = "doc_live_ok";
    let { agreement, binding } = await makeProdSigned(docId, { markSent: false });

    // Preflight (real) with production config + verified client — runs BEFORE the send
    // (esignRequestId still null).
    // Preflight (real) with production config + verified client.
    const pf = sendPreflight({ agreement, esignMode: "production", approval: { id: "a", agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null }, unsignedPdfSha256: PDF_SHA, providerConfig: resolveProviderSignerConfig(PROD_ENV, true), client: { name: "Dana", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" }, operatorEmails: [], knownTestRecipients: [], productionGateOn: true, sendingGateOn: true, stripeMode: "live", alreadySent: false, nowIso: "2026-08-29T01:00:00Z" });
    expect(pf.ok, pf.blockedReasons.join(" | ")).toBe(true);
    expect(pf.recipients).toHaveLength(2);

    // Build the SignWell request via the shared builder — INTERCEPTED (never sent).
    const body = buildSignwellRequestBody({ agreementNumber: agreement.agreementNumber, pdfBase64: "BASE64", subject: "s", message: "m", recipients: pf.recipients!, testMode: pf.signwellTestMode });
    expect(body.test_mode).toBe(false);
    expect(body.recipients.map((r) => [r.id, r.order])).toEqual([["provider", 1], ["client", 2]]);
    expect(body.reminders).toBe(false);

    // Intercepted send persists the SignWell document id (no real network call).
    await updateAgreement(agreement.id, { esignRequestId: docId, status: "sent" });
    agreement = (await getAgreement(agreement.id))!;

    // Partial signature does NOT complete.
    await handleSignwellWebhook({ rawBody: signerEvent(docId), secret: WEBHOOK_ID });
    expect((await getAgreement(agreement.id))!.status).not.toBe("signed");

    // Authenticated document_completed (test_mode:false matches production) → signed.
    expect((await handleSignwellWebhook({ rawBody: completion(docId, false), secret: WEBHOOK_ID })).result).toBe("applied");
    agreement = (await getAgreement(agreement.id))!;
    expect(agreement.status).toBe("signed");

    // Gate 10 retention over the real Postgres blob adapter (in-memory store).
    const storage = new PostgresBlobStorage();
    const r1 = await processCompletionRetention(agreement.id, { fetcher: okFetcher, storage });
    expect(r1.status).toBe("retained");
    // Idempotent re-run.
    expect((await processCompletionRetention(agreement.id, { fetcher: okFetcher, storage })).status).toBe("retained");

    // Live-payment authorization (separate, explicit).
    const auth = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", amountCents: binding.depositAmountCents, currency: binding.currency });
    expect(auth.ok, auth.reason).toBe(true);

    // Firewall permits a LIVE key now — pure decision, NO network request made.
    const decision = assertAgreementBillingAllowed(agreement, "artifex-systems", "simulation", {
      approval: { id: "a", agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null },
      currentBinding: binding, retention: "retained", recipientsPolicyOk: true, ownerLivePaymentAuthorized: true, amountMatchesApproval: true, modeConsistent: true, nowIso: "2026-08-29T02:00:00Z",
    });
    expect(decision.allowedMode).toBe("live");
  });

  it("retention FAILURE keeps billing blocked (no live authorization possible)", async () => {
    const docId = "doc_ret_fail";
    let { agreement } = await makeProdSigned(docId);
    await handleSignwellWebhook({ rawBody: completion(docId, false), secret: WEBHOOK_ID });
    agreement = (await getAgreement(agreement.id))!;
    const res = await processCompletionRetention(agreement.id, { fetcher: failFetcher, storage: new PostgresBlobStorage() });
    expect(res.status).toBe("failed");
    const auth = await authorizeLivePayment({ agreementId: agreement.id, actor: "jordan", actorRole: "founder", amountCents: agreement.contentSnapshot.depositAmountCents, currency: agreement.contentSnapshot.currency });
    expect(auth.ok).toBe(false);
  });

  it("mode mismatch: a test_mode:true completion for a production doc is refused (409)", async () => {
    const docId = "doc_modemismatch";
    await makeProdSigned(docId);
    const res = await handleSignwellWebhook({ rawBody: completion(docId, true), secret: WEBHOOK_ID });
    expect(res.status).toBe(409);
  });

  it("plus-alias client + missing provider config both block the preflight", async () => {
    const { agreement, binding } = await makeProdSigned("doc_alias", { client: "jordant.jackson+c@gmail.com" });
    const approval = { id: "a", agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null };
    const alias = sendPreflight({ agreement, esignMode: "production", approval, unsignedPdfSha256: PDF_SHA, providerConfig: resolveProviderSignerConfig(PROD_ENV, true), client: { name: "X", email: "jordant.jackson+c@gmail.com", verified: true, recordEmail: "jordant.jackson+c@gmail.com" }, operatorEmails: [], knownTestRecipients: [], productionGateOn: true, sendingGateOn: true, stripeMode: "live", alreadySent: false, nowIso: "t" });
    expect(alias.ok).toBe(false);
    const noConfig = sendPreflight({ agreement, esignMode: "production", approval, unsignedPdfSha256: PDF_SHA, providerConfig: resolveProviderSignerConfig({} as any, true), client: { name: "Dana", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" }, operatorEmails: [], knownTestRecipients: [], productionGateOn: true, sendingGateOn: true, stripeMode: "live", alreadySent: false, nowIso: "t" });
    expect(noConfig.ok).toBe(false);
  });

  it("duplicate completion webhook does not double-apply", async () => {
    const docId = "doc_dup";
    await makeProdSigned(docId);
    expect((await handleSignwellWebhook({ rawBody: completion(docId, false), secret: WEBHOOK_ID })).result).toBe("applied");
    expect((await handleSignwellWebhook({ rawBody: completion(docId, false), secret: WEBHOOK_ID })).result).toBe("duplicate");
  });
});
