import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendCompliantOutreach, buildOutreachDispatch } from "./outreach-transport";
import { sha256 } from "./receipt";
import { configureResendTestEnv, clearResendTestEnv, resendFetch, sentMime, sentMimeBody, GMAIL_TEST_SENDER } from "./resend-test-harness";
import type { SendAuthorization } from "../outreach/review-send-policy";
import type { Lead } from "../types";
import type { QuickReview } from "../outreach/quick-review";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PDF = Buffer.from("%PDF-1.4 authorized bytes");
const PDF_B64 = PDF.toString("base64");
const RECIPIENT = "qa@artifexlabs.tech"; // == COMMS_TEST_RECIPIENT so the gate permits it when prospect delivery off

const lead = { id: "lead-1", businessName: "Blue Bottle Dental", publicEmail: RECIPIENT } as unknown as Lead;
const review = { openingHook: "Your booking page loses mobile visitors.", whyItMatters: "Most searches are on phones.", cta: { bookingUrl: "https://cal.artifexlabs.tech/x" } } as unknown as QuickReview;

const auth: SendAuthorization = {
  type: "operator", policyId: "p", policyVersion: "1", revisionId: "rev-9",
  evidenceDigest: "ev", pdfSha256: sha256(PDF), templateVersion: "t1",
  recipient: RECIPIENT, campaignId: "c1", authorizedBy: "op", at: "2026-09-01T17:00:00Z",
};

// The canonical resolver is injected in tests — it returns the FROZEN artifact (bytes + SHA), exactly
// what the caller CANNOT supply through the public API. Default resolves the authorized bytes.
const frozenOk = async () => ({ ok: true as const, pdfBase64: PDF_B64, sha256: sha256(PDF), byteSize: PDF.byteLength, filename: "Blue Bottle Dental — Artifex Quick Review.pdf", version: 1 });

const deps = (over: Partial<Parameters<typeof sendCompliantOutreach>[1]> = {}) => ({
  loadLead: async () => lead,
  loadReview: async () => ({ lead, review }),
  isSuppressed: async () => false,
  resolveArtifact: frozenOk,
  ...over,
});

const realFetch = global.fetch;
beforeEach(() => { configureResendTestEnv({ COMMS_TEST_RECIPIENT: RECIPIENT }); delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED; });
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); });

describe("canonical compliant cold-outreach transport (Google Workspace lanes, fail-closed)", () => {
  it("HAPPY PATH: accepted → ok, and the submitted message carries the footer, postal, List-Unsubscribe, and the authorized PDF — from the Google lane", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1"; // owner-enabled (or use the test address; here allow the send)
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps());
    expect(res.ok).toBe(true);
    expect(res.providerId).toBe("gmail-1"); // real Google Workspace message id persisted as truthful state
    const mime = sentMime(rf.calls, 1);
    expect(mime).toMatch(/List-Unsubscribe: <https:\/\/[^>\r\n]*\/api\/comms\/unsubscribe\?lead=lead-1&t=/);
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(mime).toContain("Content-Type: application/pdf"); // authorized PDF attached
    // Sent FROM the Google Workspace lane (never hello@ M365, never Resend).
    expect(mime).toContain(`<${GMAIL_TEST_SENDER}>`);
    expect(mime).not.toContain("<hello@artifexlabs.tech>");
    const bodyText = sentMimeBody(rf.calls, 1);
    expect(bodyText).toContain("Artifex Labs Systems LLC"); // legal identity
    expect(bodyText).toContain("commercial message");
    expect(bodyText).toContain("San Francisco, CA 94105"); // runtime postal
  });

  it("FAIL-CLOSED no postal address → refused, transport never called", async () => {
    delete process.env.COMMS_POSTAL_ADDRESS;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("footer:no-postal");
    expect(rf.calls.all).toBe(0);
  });

  it("suppressed recipient → refused BEFORE any assembly or transport call", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps({ isSuppressed: async () => true }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("suppressed");
    expect(rf.calls.all).toBe(0);
  });

  it("recipient-drift (lead email no longer matches the authorized recipient) → refused", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const drifted = { ...lead, publicEmail: "someoneelse@artifexlabs.tech" } as unknown as Lead;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps({ loadLead: async () => drifted }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("recipient-drift");
    expect(rf.calls.all).toBe(0);
  });

  it("pdf-drift (resolved frozen SHA does not match the authorized pdfSha256) → refused, never ships", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const different = Buffer.from("different bytes");
    const driftResolver = async () => ({ ok: true as const, pdfBase64: different.toString("base64"), sha256: sha256(different), byteSize: different.byteLength, filename: "x.pdf", version: 1 });
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps({ resolveArtifact: driftResolver }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("pdf-drift");
    expect(rf.calls.all).toBe(0);
  });

  it("prospect while delivery DISABLED → recipient gate refuses (not the test address)", async () => {
    const prospect = "owner@realprospect.com";
    const prospectLead = { ...lead, publicEmail: prospect } as unknown as Lead;
    const prospectAuth = { ...auth, recipient: prospect };
    const rf = resendFetch();
    global.fetch = rf.fn;
    // COMMS_PROSPECT_DELIVERY_ENABLED is unset (beforeEach) and prospect != COMMS_TEST_RECIPIENT.
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth: prospectAuth }, deps({ loadLead: async () => prospectLead }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("recipient-gate");
    expect(rf.calls.all).toBe(0);
  });

  it("AMBIGUOUS: a network fault on submit → ok:false + ambiguous (slot retained, no blind resend)", async () => {
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    global.fetch = resendFetch({ send: () => ({ throw: true }) }).fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps());
    expect(res.ok).toBe(false);
    expect(res.ambiguous).toBe(true);
  });

  it("prospect transport (Google lanes) unconfigured → refused (never a bare send, never Resend)", async () => {
    // The Google Workspace lanes are the sole cold transport; removing them fails closed. Removing the
    // Resend key would NOT (Resend is transactional-only) — so we remove the lanes here.
    delete process.env.GOOGLE_WORKSPACE_SENDER_1;
    delete process.env.GOOGLE_WORKSPACE_REFRESH_TOKEN_1;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth }, deps());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("prospect-transport-unconfigured");
    expect(rf.calls.all).toBe(0);
  });

  it("buildOutreachDispatch produces a canonical typed request from persisted state (subject, filename, idempotency)", async () => {
    const built = await buildOutreachDispatch({ leadId: "lead-1", auth }, deps());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.req.subject).toBe("Quick Review — Blue Bottle Dental");
      expect(built.req.recipient).toBe(RECIPIENT);
      expect(built.req.idempotencyKey).toBe("outreach:lead-1:rev-9");
      expect(built.req.pdfFilename).toMatch(/\.pdf$/i);
      expect(built.unsubscribeUrl).toContain("/api/comms/unsubscribe?lead=lead-1&t=");
    }
  });
});
