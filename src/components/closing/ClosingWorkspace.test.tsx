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
    client: { legalName: "Copper Oak LLC", businessName: "Copper Oak", signerName: "Dana", signerEmail: "dana@copperoak.com", verified: true },
    terms: { scope: ["Brand"], deliverables: ["Logo"], totalCents: 1_450_000, depositCents: 725_000, remainingCents: 725_000, currency: "usd", monthlyCents: null },
    document: { unsignedPdfSha256: SHA, approvalId: null, approvalDigest: null, sendAuthorizationState: "none", esignRequestId: null, signedPdfSha256: null, auditPage: "none" },
    signing: { provider: "not_sent", client: "not_sent", completedSigners: 0, requiredSigners: 2, lastEventAt: null, overall: "Draft" },
    retention: { status: "not-required", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: false, certificate: false },
    billing: { eligibility: "BLOCKED_UNSIGNED", blockedReason: "not signed", stripeMode: "test", amountCents: 725_000, currency: "usd", paymentAuthorized: false, paid: false },
    readiness: { providerConfigReady: true, clientVerified: true, approvalCurrent: false, sendAuthorizationCurrent: false, productionFlagsEnabled: false, nextAction: "Review agreement", blockedReason: null },
    audit: [],
    ...over,
  };
}
const production = (over: Partial<ClosingWorkspaceView> = {}): ClosingWorkspaceView =>
  base({ agreement: { ...base().agreement, esignMode: "production", legallyBinding: true, signwellTestMode: false }, ...over });
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
    const out = html(withBilling("BLOCKED_LIVE_AUTH_MISSING", {
      agreement: { ...base().agreement, status: "signed", esignMode: "production", legallyBinding: true, signwellTestMode: false },
      signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "t", overall: "Completed" },
    }));
    expect(out).toContain("Authorize live payment");
  });

  it("includes the exact approval confirmation text (pre-approval)", () => {
    expect(html(base())).toContain("I approve this exact agreement, pricing, scope, recipients, and PDF for signing.");
  });

  // ── Contradiction #2 — approval action after approval ──────────────────────────
  it("once approved, shows 'Approved' + receipt and NO active approve button", () => {
    const out = html(base({
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "active" },
      signing: { ...base().signing, overall: "Approved" },
      readiness: { ...base().readiness, approvalCurrent: true, sendAuthorizationCurrent: true, nextAction: "Send agreement" },
    }));
    expect(out).toContain("Approved · receipt digest");
    expect(out).not.toContain("Approve for signing");
    expect(out).not.toContain("Re-review");
  });

  it("shows a pre-approval Approve action only when not yet approved", () => {
    expect(html(base())).toContain("Approve for signing");
  });

  // ── Contradiction #3 — consumed send-auth copy ─────────────────────────────────
  it("consumed send-auth shows 'already been sent', never 'Authorize sending first'", () => {
    const out = html(production({
      agreement: { ...production().agreement, status: "sent" },
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1" },
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Partially signed" },
      readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Await remaining signature" },
    }));
    expect(out).toContain("Agreement has already been sent");
    expect(out).not.toContain("Authorize sending first");
  });

  // ── Contradiction #4 — partial-signature state ─────────────────────────────────
  it("partial signature: no approval/authorize/send actions, shows awaiting remaining signer", () => {
    const out = html(production({
      agreement: { ...production().agreement, status: "sent" },
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1" },
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Partially signed" },
      billing: { ...base().billing, eligibility: "BLOCKED_PARTIAL_SIGNATURE", blockedReason: "not all signers", stripeMode: "live" },
      readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Await remaining signature" },
    }));
    expect(out).toContain("Awaiting the remaining signer");
    expect(out).toContain("1 of 2 signers complete");
    expect(out).not.toContain("Approve for signing");
    expect(out).not.toContain("Authorize send");
    expect(out).not.toContain("Send agreement");
    expect(out).not.toContain("Authorize sending first");
    expect(out).toContain("Blocked — not all signers complete");
  });

  // ── Contradiction #5 — retention failed ────────────────────────────────────────
  it("retention failed: Failed badge + reason + ENABLED retry with the exact label", () => {
    const out = html(production({
      agreement: { ...production().agreement, status: "signed" },
      signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "t", overall: "Completed" },
      retention: { status: "failed", failureReason: "retrieval failed — retry available", retryAvailable: true, auditPageEmbedded: false, signedPdf: false, certificate: false },
      billing: { ...base().billing, eligibility: "BLOCKED_RETENTION_FAILED", blockedReason: "retention failed", stripeMode: "live" },
      readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Retry signed-document retention" },
    }));
    expect(out).toContain("Retry signed-document retention");
    expect(out).toContain("retrieval failed");
    // retention badge label is 'Failed' (capitalized), not the raw status.
    expect(out).toContain(">Failed<");
  });

  it("retention pending: shows in-progress and NO retry", () => {
    const out = html(production({
      agreement: { ...production().agreement, status: "signed" },
      signing: { provider: "signed", client: "signed", completedSigners: 2, requiredSigners: 2, lastEventAt: "t", overall: "Completed" },
      retention: { status: "pending", failureReason: null, retryAvailable: false, auditPageEmbedded: false, signedPdf: false, certificate: false },
      billing: { ...base().billing, eligibility: "BLOCKED_RETENTION_PENDING", blockedReason: "pending", stripeMode: "live" },
      readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Retain signed documents" },
    }));
    expect(out).toContain("Retention in progress");
    expect(out).not.toContain("Retry signed-document retention");
  });

  // ── Contradiction #1 — unverified production client is a BLOCKED error state ─────
  // The client became unverified AFTER a prior approval, so the approval must be INVALIDATED
  // (drift) — never a currently-valid "Approved" badge/receipt.
  it("unverified production client: blocked error + 'Verify client identity' + no consequential actions", () => {
    const out = html(production({
      client: { ...base().client, verified: false },
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST },
      billing: { ...base().billing, eligibility: "BLOCKED_RECIPIENT_MISMATCH", blockedReason: "unverified", stripeMode: "live" },
      readiness: { ...base().readiness, approvalCurrent: false, productionFlagsEnabled: true, clientVerified: false, nextAction: "Verify client identity" },
    }));
    expect(out).toContain("Blocked — client identity not verified");
    expect(out).toContain("Verify client identity");
    expect(out).not.toContain("Authorize live payment");
    expect(out).not.toContain("Send agreement");
  });

  it("unverified/drifted approval is INVALIDATED, never a currently-valid Approved receipt", () => {
    const out = html(production({
      client: { ...base().client, verified: false },
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST },
      billing: { ...base().billing, eligibility: "BLOCKED_RECIPIENT_MISMATCH", blockedReason: "unverified", stripeMode: "live" },
      readiness: { ...base().readiness, approvalCurrent: false, productionFlagsEnabled: true, clientVerified: false, nextAction: "Verify client identity" },
    }));
    // Badge reads "Invalidated" — NOT a valid Approved state or receipt.
    expect(out).toContain(">Invalidated<");
    expect(out).toContain("Invalidated — client/recipient drift");
    expect(out).not.toContain("Approved · receipt digest");
    expect(out).not.toContain(">Approved<");
    // The historical receipt is preserved in the audit timeline (referenced in the copy).
    expect(out).toContain("historical approval receipt remains in the audit timeline");
  });

  // ── send authorization badge maps state → label; 'sent' never reads "Not authorized" ──
  it("a sent agreement shows a 'Sent' (consumed) send-authorization badge, never 'Not authorized'", () => {
    const out = html(production({
      agreement: { ...production().agreement, status: "sent" },
      document: { ...base().document, approvalId: "appr_1", approvalDigest: DIGEST, sendAuthorizationState: "consumed", esignRequestId: "doc_1" },
      signing: { provider: "signed", client: "viewed", completedSigners: 1, requiredSigners: 2, lastEventAt: "t", overall: "Partially signed" },
      readiness: { ...base().readiness, approvalCurrent: true, productionFlagsEnabled: true, nextAction: "Await remaining signature" },
    }));
    expect(out).toContain("Agreement has already been sent");
    expect(out).toContain(">Sent<");
    expect(out).not.toContain(">Not authorized<");
  });

  // ── Contradiction #6 — the header next action reflects the exact state ───────────
  it("renders the top-level next action from the view-model", () => {
    expect(html(base({ readiness: { ...base().readiness, nextAction: "Review agreement" } }))).toContain("Review agreement");
    expect(html(base({ readiness: { ...base().readiness, nextAction: "No action required" } }))).toContain("No action required");
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
