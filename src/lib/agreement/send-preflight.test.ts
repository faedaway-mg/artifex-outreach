import { describe, it, expect } from "vitest";
import { sendPreflight, type PreflightInput } from "./send-preflight";
import { buildApprovalBinding, approvalDigest, type AgreementApproval } from "./approval";
import { makeAgreement } from "./test-fixtures";
import { resolveProviderSignerConfig } from "../esign/provider-config";
import { buildRecipients, validateRecipients, expectedSignatureFields } from "../esign/request-builder";

const PDF_SHA = "a".repeat(64);
const PROD_ENV = {
  AGREEMENT_PROVIDER_LEGAL_NAME: "Artifex Labs Systems LLC d/b/a Artifex Labs",
  AGREEMENT_PROVIDER_SIGNER_NAME: "Jordan Jackson",
  AGREEMENT_PROVIDER_SIGNER_EMAIL: "contracts@artifexlabs.tech",
} as any;

function prodApproval(agreement: any, over: Partial<ReturnType<typeof buildApprovalBinding>> = {}): AgreementApproval {
  const binding = { ...buildApprovalBinding(agreement, { providerSignerEmail: "contracts@artifexlabs.tech", clientEmail: "dana@copperoak.com", esignMode: "production", stripeMode: "live", unsignedPdfSha256: PDF_SHA }), ...over };
  return { id: "appr", agreementId: binding.agreementId, agreementVersion: binding.agreementVersion, binding, digest: approvalDigest(binding), approvedBy: "jordan", approvedAt: "2026-08-29T00:00:00Z", revokedAt: null };
}

function baseInput(over: Partial<PreflightInput> = {}): PreflightInput {
  const agreement = makeAgreement({ status: "approved" });
  return {
    agreement, esignMode: "production", approval: prodApproval(agreement), unsignedPdfSha256: PDF_SHA,
    providerConfig: resolveProviderSignerConfig(PROD_ENV, true),
    client: { name: "Dana Reyes", email: "dana@copperoak.com", verified: true, recordEmail: "dana@copperoak.com" },
    operatorEmails: ["jordant.jackson@gmail.com"], knownTestRecipients: ["jordant.jackson+artifex@gmail.com"],
    productionGateOn: true, sendingGateOn: true, stripeMode: "live", alreadySent: false, nowIso: "2026-08-29T01:00:00Z",
    ...over,
  };
}

describe("provider config (Gate 2)", () => {
  it("resolves valid production config; fails closed on missing/alias/wrong entity", () => {
    expect(resolveProviderSignerConfig(PROD_ENV, true).ok).toBe(true);
    expect(resolveProviderSignerConfig({} as any, true).ok).toBe(false);
    expect(resolveProviderSignerConfig({ ...PROD_ENV, AGREEMENT_PROVIDER_SIGNER_EMAIL: "j+x@gmail.com" }, true).issues.join(" ")).toMatch(/plus-alias/);
    expect(resolveProviderSignerConfig({ ...PROD_ENV, AGREEMENT_PROVIDER_LEGAL_NAME: "Other LLC" }, true).issues.join(" ")).toMatch(/does not match/);
  });
});

describe("two-signer request builder (Gate 3)", () => {
  it("orders provider=1, client=2 with four required fields", () => {
    const r = buildRecipients({ provider: { name: "JJ", email: "p@artifexlabs.tech" }, client: { name: "Dana", email: "dana@copperoak.com" } });
    expect(r.map((x) => [x.role, x.order])).toEqual([["provider", 1], ["client", 2]]);
    expect(validateRecipients(r).ok).toBe(true);
    expect(expectedSignatureFields().map((f) => f.tag)).toEqual(["{{signature:1:y}}", "{{date:1:y}}", "{{signature:2:y}}", "{{date:2:y}}"]);
  });
  it("rejects duplicate emails and bad order", () => {
    expect(validateRecipients(buildRecipients({ provider: { name: "a", email: "x@y.com" }, client: { name: "b", email: "X@Y.com" } })).ok).toBe(false);
  });
});

describe("send preflight (Gate 4)", () => {
  it("passes when everything matches", () => {
    const r = sendPreflight(baseInput());
    expect(r.ok, r.blockedReasons.join(" | ")).toBe(true);
    expect(r.signwellTestMode).toBe(false);
    expect(r.recipients).toHaveLength(2);
  });

  it("blocks on each drift / missing gate", () => {
    expect(sendPreflight(baseInput({ approval: null })).ok).toBe(false);
    expect(sendPreflight(baseInput({ productionGateOn: false })).blockedReasons.join(" ")).toMatch(/production_flags/);
    expect(sendPreflight(baseInput({ sendingGateOn: false })).blockedReasons.join(" ")).toMatch(/production_flags/);
    expect(sendPreflight(baseInput({ providerConfig: resolveProviderSignerConfig({} as any, true) })).ok).toBe(false);
    expect(sendPreflight(baseInput({ unsignedPdfSha256: "b".repeat(64) })).blockedReasons.join(" ")).toMatch(/pdf_hash_matches|no_binding_drift/);
    expect(sendPreflight(baseInput({ client: { name: "Dana", email: "dana@copperoak.com", verified: false, recordEmail: "dana@copperoak.com" } })).blockedReasons.join(" ")).toMatch(/client_verified|recipient_policy/);
    expect(sendPreflight(baseInput({ client: { name: "X", email: "jordant.jackson+artifex@gmail.com", verified: true, recordEmail: "jordant.jackson+artifex@gmail.com" } })).ok).toBe(false); // plus-alias
    expect(sendPreflight(baseInput({ alreadySent: true })).blockedReasons.join(" ")).toMatch(/not_already_sent/);
    const superseded = makeAgreement({ status: "approved" }); (superseded as any).supersededById = "agr_new";
    expect(sendPreflight(baseInput({ agreement: superseded, approval: prodApproval(superseded) })).blockedReasons.join(" ")).toMatch(/agreement_active/);
  });

  it("price/scope drift is caught via the binding", () => {
    const agreement = makeAgreement({ status: "approved" });
    const approval = prodApproval(agreement);
    // Change the agreement's snapshot price AFTER approval → drift.
    (agreement.contentSnapshot as any).depositAmountCents += 1;
    const r = sendPreflight(baseInput({ agreement, approval }));
    expect(r.blockedReasons.join(" ")).toMatch(/no_binding_drift/);
  });

  it("test mode does not require an approval or production flags", () => {
    const agreement = makeAgreement({ status: "approved" });
    const r = sendPreflight(baseInput({ agreement, esignMode: "test", approval: null, providerConfig: resolveProviderSignerConfig(PROD_ENV, true), productionGateOn: false, sendingGateOn: false, stripeMode: "test", client: { name: "T", email: "jordant.jackson@gmail.com", verified: false, recordEmail: null } }));
    expect(r.ok, r.blockedReasons.join(" | ")).toBe(true);
    expect(r.signwellTestMode).toBe(true);
  });
});
