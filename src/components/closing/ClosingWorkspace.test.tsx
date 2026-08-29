// Component tests for the Client-Closing workspace. The repo does NOT ship
// @testing-library/react or a DOM environment (vitest runs environment:"node"), and
// node_modules is a shared symlinked pnpm store across worktrees — adding those deps
// would perturb every sibling worktree. So we render to static markup with
// react-dom/server (already installed) and assert against the produced HTML. This
// exercises the exact same view-model → UI mapping @testing-library would, without a
// DOM env or new dependencies. The server actions are mocked (they are "use server").
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClosingWorkspaceView } from "@/lib/billing/closing-workspace-view";
import type { EligibilityState } from "@/lib/billing/eligibility";

// The workspace imports "use server" action wrappers; stub them so the client component
// renders in isolation (they are never invoked during a static render).
vi.mock("@/lib/agreement/closing-ui-actions", () => ({
  approveAction: vi.fn(), authorizeSendAction: vi.fn(), sendAction: vi.fn(),
  authorizePaymentAction: vi.fn(), retryRetentionAction: vi.fn(),
}));

import { ClosingWorkspace } from "./ClosingWorkspace";

const SHA = "a".repeat(64);
const DIGEST = "b".repeat(64);

function base(over: Partial<ClosingWorkspaceView> = {}): ClosingWorkspaceView {
  return {
    agreement: { id: "agr1", number: "AL-A-2026-001", version: 1, status: "approved", esignMode: "test", legallyBinding: false, signwellTestMode: true, createdAt: "t", updatedAt: "t" },
    provider: { legalEntity: "Artifex Labs Systems LLC", signerName: "Jordan", signerEmail: "contracts@artifexlabs.tech" },
    client: { legalName: "Copper Oak LLC", businessName: "Copper Oak", signerName: "Dana", signerEmail: "dana@copperoak.com", verified: false },
    terms: { scope: ["Brand"], deliverables: ["Logo"], totalCents: 1_450_000, depositCents: 725_000, remainingCents: 725_000, currency: "usd", monthlyCents: null },
    document: { unsignedPdfSha256: SHA, approvalId: null, approvalDigest: null, sendAuthorizationState: "none", esignRequestId: null, signedPdfSha256: null, auditPage: "none" },
    signing: { provider: "not_sent", client: "not_sent", completedSigners: 0, requiredSigners: 2, lastEventAt: null, overall: "Draft" },
    retention: { status: "not-required", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: false, certificate: false },
    billing: { eligibility: "BLOCKED_UNSIGNED", blockedReason: "not signed", stripeMode: "test", amountCents: 725_000, currency: "usd", paymentAuthorized: false, paid: false },
    readiness: { providerConfigReady: true, clientVerified: false, approvalCurrent: false, sendAuthorizationCurrent: false, productionFlagsEnabled: false, nextAction: "Review & approve the agreement", blockedReason: null },
    audit: [],
    ...over,
  };
}
const html = (v: ClosingWorkspaceView) => renderToStaticMarkup(<ClosingWorkspace view={v} agreementId="agr1" />);

function withBilling(eligibility: EligibilityState, over: Partial<ClosingWorkspaceView> = {}): ClosingWorkspaceView {
  return base({ billing: { ...base().billing, eligibility }, ...over });
}

describe("ClosingWorkspace", () => {
  it("shows TEST badge + Not legally binding for a test agreement", () => {
    const out = html(base());
    expect(out).toContain("TEST");
    expect(out).toContain("Not legally binding");
    expect(out).not.toContain("Legally binding<"); // the binding label is exactly "Not legally binding"
  });

  it("shows PRODUCTION badge + Legally binding for a production agreement", () => {
    const out = html(base({ agreement: { ...base().agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false } }));
    expect(out).toContain("PRODUCTION");
    expect(out).toContain("Legally binding");
  });

  it("1 of 2 signers renders as 'Partially signed', never 'Completed'", () => {
    const out = html(base({
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Partially signed" },
    }));
    expect(out).toContain("Partially signed");
    expect(out).toContain("1 of 2 signers");
    expect(out).not.toContain(">Completed<");
  });

  it("maps each billing eligibility to distinct operator language (spot-check)", () => {
    expect(html(withBilling("BLOCKED_UNSIGNED"))).toContain("Blocked — agreement not signed yet");
    expect(html(withBilling("BLOCKED_PARTIAL_SIGNATURE"))).toContain("Blocked — not all signers complete");
    expect(html(withBilling("BLOCKED_RETENTION_FAILED"))).toContain("Blocked — signed-PDF retention failed");
    expect(html(withBilling("ELIGIBLE_LIVE_PAYMENT"))).toContain("Eligible for a LIVE payment");
    // Distinct BLOCKED_* are not collapsed into one label.
    expect(html(withBilling("BLOCKED_UNSIGNED"))).not.toContain("Blocked — not all signers complete");
  });

  it("hides the live-payment authorization action for a test agreement", () => {
    const out = html(withBilling("ELIGIBLE_TEST_PAYMENT"));
    expect(out).not.toContain("Authorize live payment");
  });

  it("hides the live-payment authorization action for BLOCKED states other than LIVE_AUTH_MISSING", () => {
    expect(html(withBilling("BLOCKED_UNSIGNED"))).not.toContain("Authorize live payment");
    expect(html(withBilling("BLOCKED_RETENTION_PENDING"))).not.toContain("Authorize live payment");
  });

  it("shows the live-payment authorization action ONLY for BLOCKED_LIVE_AUTH_MISSING", () => {
    const out = html(withBilling("BLOCKED_LIVE_AUTH_MISSING", { agreement: { ...base().agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false } }));
    expect(out).toContain("Authorize live payment");
  });

  it("includes the exact approval confirmation text", () => {
    expect(html(base())).toContain("I approve this exact agreement, pricing, scope, recipients, and PDF for signing.");
  });

  it("shows Retry retention only when retryAvailable", () => {
    expect(html(base({ retention: { ...base().retention, status: "failed", failureReason: "x", retryAvailable: true } }))).toContain("Retry retention");
    expect(html(base({ retention: { ...base().retention, status: "pending", retryAvailable: false } }))).not.toContain("Retry retention");
  });

  it("embedded audit shows 'Includes audit page' and NO separate certificate link", () => {
    const out = html(base({
      retention: { ...base().retention, status: "retained", signedPdf: true, certificate: false, auditPageEmbedded: true },
      document: { ...base().document, signedPdfSha256: SHA, auditPage: "embedded", approvalDigest: DIGEST },
    }));
    expect(out).toContain("Includes audit page");
    expect(out).not.toContain("artifacts/certificate");
    expect(out).toContain("artifacts/signed"); // signed PDF link present
  });

  it("separate certificate shows the certificate download link", () => {
    const out = html(base({
      retention: { ...base().retention, status: "retained", signedPdf: true, certificate: true, auditPageEmbedded: false },
      document: { ...base().document, signedPdfSha256: SHA, auditPage: "separate" },
    }));
    expect(out).toContain("artifacts/certificate");
  });

  it("shows a clear 'Production sending is OFF' state when production flags are disabled", () => {
    const out = html(base({
      agreement: { ...base().agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false },
      readiness: { ...base().readiness, productionFlagsEnabled: false },
    }));
    expect(out).toContain("Production sending is OFF");
  });
});
