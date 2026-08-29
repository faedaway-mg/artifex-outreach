// Gate 13 — production-path SIMULATION. Exercises the full chain with mocks and makes NO
// network request, creates NO real SignWell document, and NO live Stripe object. Proves:
//  - a production agreement's SignWell test_mode would be false,
//  - the completion webhook authenticates and matches the exact document + mode,
//  - live payment stays BLOCKED until approval + retention + explicit live authorization,
//  - only then is it ELIGIBLE_LIVE_PAYMENT and the firewall permits a LIVE key,
//  - a TEST agreement can NEVER reach a live key.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import {
  insertLead, insertAgreement, getAgreement,
  insertAgreementApproval, insertSignedArtifact, insertLivePaymentAuthorization, signedArtifactsForAgreement,
} from "../repo";
import { makeAgreement, makeLead } from "../agreement/test-fixtures";
import { handleSignwellWebhook } from "../esign/webhook";
import { signwellTestModeFor } from "../esign/mode";
import { buildApprovalBinding, approvalDigest, type ApprovalBinding } from "../agreement/approval";
import { retainCompletedDocument, retentionStatus, type DurableStorage, type CompletedDocumentFetcher } from "./retention";
import { agreementEligibilityContext, assertAgreementBillingAllowed } from "./firewall-gate";
import { evaluateBillingEligibility, BillingFirewallError } from "./eligibility";

const WEBHOOK_ID = "whk_sim";
const TIME = 1787990119;
const hashFor = (type: string) => createHmac("sha256", WEBHOOK_ID).update(`${type}@${TIME}`).digest("hex");
function completion(docId: string, testMode: boolean) {
  return JSON.stringify({ event: { id: `evt_${docId}`, type: "document_completed", time: TIME, hash: hashFor("document_completed") }, data: { object: { id: docId, status: "completed", test_mode: testMode, recipients: [{ id: "provider", status: "completed" }, { id: "client", status: "completed" }] } } });
}

const PDF_SHA = "a".repeat(64);
const bindOpts = { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: "dana@copperoak.com", esignMode: "production" as const, stripeMode: "live" as const, unsignedPdfSha256: PDF_SHA };
const memStorage = (): DurableStorage => { const m = new Map<string, Uint8Array>(); return { async put(k, b) { m.set(k, b); return { ok: true }; }, async exists(k) { return m.has(k); } }; };
const fetcher: CompletedDocumentFetcher = { async fetch(_id, kind) { return { bytes: new TextEncoder().encode(kind), kind }; } };
let n = 0; const newId = (p: string) => `${p}_sim_${++n}`;

async function makeProductionAgreement(docId: string) {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status: "sent", leadId: lead.id, esignRequestId: docId });
  const { id, createdAt, updatedAt, ...rest } = a;
  return insertAgreement({ ...rest, esignMode: "production" } as any);
}
function bindingFor(agreement: any): ApprovalBinding { return buildApprovalBinding(agreement, bindOpts); }

describe("production-path simulation (no network, no live object)", () => {
  beforeEach(() => __resetStoreForTests());
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; });

  it("production agreement uses SignWell test_mode:false", () => {
    expect(signwellTestModeFor("production")).toBe(false);
  });

  it("full chain: blocked → approve → complete → retain → authorize → ELIGIBLE_LIVE_PAYMENT; firewall permits a LIVE key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_simulated"; // classified only; NO network call is made
    const docId = "doc_sim_prod";
    let agreement = await makeProductionAgreement(docId);

    // 1) Before completion/approval → not live-eligible.
    let elig = evaluateBillingEligibility(agreementEligibilityContext(agreement, { nowIso: "2026-08-29T00:00:00Z" }));
    expect(elig.state).toBe("BLOCKED_UNSIGNED");

    // 2) Bind owner approval to the exact terms + PDF hash + recipients + modes.
    const binding = bindingFor(agreement);
    await insertAgreementApproval({ agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null } as any);

    // 3) Authenticated completion webhook (test_mode:false matches production) → signed.
    const res = await handleSignwellWebhook({ rawBody: completion(docId, false), secret: WEBHOOK_ID });
    expect(res.result).toBe("applied");
    agreement = (await getAgreement(agreement.id))!;
    expect(agreement.status).toBe("signed");

    // A test_mode:true event for this production doc would have been REFUSED (Gate 8) —
    // proven separately in webhook.test.ts.

    // 4) Still blocked: retention pending + no live authorization.
    const approval = { id: "appr", agreementId: agreement.id, agreementVersion: agreement.version, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null };
    const ev = () => ({ approval, currentBinding: bindingFor(agreement), retention: retentionStatus([], agreement), recipientsPolicyOk: true, ownerLivePaymentAuthorized: false, amountMatchesApproval: true, modeConsistent: true, nowIso: "2026-08-29T01:00:00Z" });
    expect(evaluateBillingEligibility(agreementEligibilityContext(agreement, ev())).state).toBe("BLOCKED_RETENTION_PENDING");

    // 5) Retain the signed PDF + audit certificate durably (mock fetch + storage).
    const arts = await retainCompletedDocument({ agreement, approvalDigest: approvalDigest(binding), fetcher, storage: memStorage(), nowIso: "2026-08-29T01:05:00Z", newId });
    for (const art of arts) await insertSignedArtifact(art);
    const retained = await signedArtifactsForAgreement(agreement.id);
    expect(retentionStatus(retained, agreement)).toBe("retained");

    // Still blocked without explicit live authorization.
    const ev2 = () => ({ approval, currentBinding: bindingFor(agreement), retention: retentionStatus(retained, agreement), recipientsPolicyOk: true, ownerLivePaymentAuthorized: false, amountMatchesApproval: true, modeConsistent: true, nowIso: "2026-08-29T01:06:00Z" });
    expect(evaluateBillingEligibility(agreementEligibilityContext(agreement, ev2())).state).toBe("BLOCKED_LIVE_AUTH_MISSING");

    // 6) Explicit owner live-payment authorization → ELIGIBLE_LIVE_PAYMENT.
    await insertLivePaymentAuthorization({ agreementId: agreement.id, agreementVersion: agreement.version, approvalDigest: approvalDigest(binding), authorizedBy: "jordan", authorizedAt: "2026-08-29T01:10:00Z", revokedAt: null } as any);
    const ev3 = { approval, currentBinding: bindingFor(agreement), retention: retentionStatus(retained, agreement), recipientsPolicyOk: true, ownerLivePaymentAuthorized: true, amountMatchesApproval: true, modeConsistent: true, nowIso: "2026-08-29T01:11:00Z" };
    expect(evaluateBillingEligibility(agreementEligibilityContext(agreement, ev3)).state).toBe("ELIGIBLE_LIVE_PAYMENT");

    // 7) Firewall PERMITS a live key for the fully-eligible production agreement — but this
    //    is a pure decision; NO Stripe network request is made in this simulation.
    const decision = assertAgreementBillingAllowed(agreement, "artifex-systems", "simulation", ev3);
    expect(decision.allowedMode).toBe("live");

    // 8) Drift guard: change the intended binding (price) → document mismatch → blocked.
    const drifted = { ...ev3, currentBinding: { ...bindingFor(agreement), depositAmountCents: binding.depositAmountCents + 1 } };
    expect(evaluateBillingEligibility(agreementEligibilityContext(agreement, drifted)).state).toBe("BLOCKED_DOCUMENT_MISMATCH");
  });

  it("a TEST agreement can NEVER reach a live key, even fully signed", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_simulated";
    const lead = await insertLead(makeLead() as any);
    const a = makeAgreement({ status: "sent", leadId: lead.id, esignRequestId: "doc_sim_test" });
    const { id, createdAt, updatedAt, ...rest } = a;
    let agreement = await insertAgreement({ ...rest, esignMode: "test" } as any);
    const res = await handleSignwellWebhook({ rawBody: completion("doc_sim_test", true), secret: WEBHOOK_ID });
    expect(res.result).toBe("applied");
    agreement = (await getAgreement(agreement.id))!;

    // Eligible for TEST payment only.
    const elig = evaluateBillingEligibility(agreementEligibilityContext(agreement, { nowIso: "2026-08-29T02:00:00Z" }));
    expect(elig.state).toBe("ELIGIBLE_TEST_PAYMENT");
    // Firewall refuses this test agreement against the live key.
    expect(() => assertAgreementBillingAllowed(agreement, "artifex-systems", "simulation", { nowIso: "2026-08-29T02:00:00Z" })).toThrow(BillingFirewallError);
  });
});
