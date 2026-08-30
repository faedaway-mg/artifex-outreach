import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendCompliantOutreach, buildOutreachDispatch } from "./outreach-transport";
import { sha256 } from "./receipt";
import { configureResendTestEnv, clearResendTestEnv, resendFetch, sentBody } from "./resend-test-harness";
import type { SendAuthorization } from "../outreach/review-send-policy";
import type { Lead } from "../types";
import type { QuickReview } from "../outreach/quick-review";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PDF = Buffer.from("%PDF-1.4 authorized bytes");
const RECIPIENT = "qa@artifexlabs.tech"; // == COMMS_TEST_RECIPIENT so the gate permits it when prospect delivery off

const lead = { id: "lead-1", businessName: "Blue Bottle Dental", publicEmail: RECIPIENT } as unknown as Lead;
const review = { openingHook: "Your booking page loses mobile visitors.", whyItMatters: "Most searches are on phones.", cta: { bookingUrl: "https://cal.artifexlabs.tech/x" } } as unknown as QuickReview;

const auth: SendAuthorization = {
  type: "operator", policyId: "p", policyVersion: "1", revisionId: "rev-9",
  evidenceDigest: "ev", pdfSha256: sha256(PDF), templateVersion: "t1",
  recipient: RECIPIENT, campaignId: "c1", authorizedBy: "op", at: "2026-09-01T17:00:00Z",
};

const deps = (over: Partial<Parameters<typeof sendCompliantOutreach>[1]> = {}) => ({
  loadLead: async () => lead,
  loadReview: async () => ({ lead, review }),
  isSuppressed: async () => false,
  ...over,
});

const realFetch = global.fetch;
beforeEach(() => { configureResendTestEnv({ COMMS_TEST_RECIPIENT: RECIPIENT }); delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED; });
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); });

describe("canonical compliant cold-outreach transport (Resend, fail-closed)", () => {
  it("HAPPY PATH: accepted → ok, and the submitted message carries the footer, postal, List-Unsubscribe, and the authorized PDF", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1"; // owner-enabled (or use the test address; here allow the send)
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps());
    expect(res.ok).toBe(true);
    expect(res.providerId).toBe("resend-1"); // real provider message id persisted as truthful state
    const b = sentBody(rf.calls, 1);
    expect(b.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/.*\/api\/comms\/unsubscribe\?lead=lead-1&t=/);
    expect(b.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(b.text).toContain("Artifex Labs Systems LLC"); // legal identity
    expect(b.text).toContain("commercial message");
    expect(b.text).toContain("San Francisco, CA 94105"); // runtime postal
    expect(b.attachments[0].content_type).toBe("application/pdf"); // authorized PDF attached
    expect(b.from).toContain("hello@artifexlabs.tech");
  });

  it("FAIL-CLOSED no postal address → refused, transport never called", async () => {
    delete process.env.COMMS_POSTAL_ADDRESS;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("footer:no-postal");
    expect(rf.calls.all).toBe(0);
  });

  it("suppressed recipient → refused BEFORE any assembly or transport call", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps({ isSuppressed: async () => true }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("suppressed");
    expect(rf.calls.all).toBe(0);
  });

  it("recipient-drift (lead email no longer matches the authorized recipient) → refused", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const drifted = { ...lead, publicEmail: "someoneelse@artifexlabs.tech" } as unknown as Lead;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps({ loadLead: async () => drifted }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("recipient-drift");
    expect(rf.calls.all).toBe(0);
  });

  it("pdf-drift (bytes do not hash to the authorized pdfSha256) → refused, never ships a re-render", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: Buffer.from("different bytes") }, deps());
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
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth: prospectAuth, pdf: PDF }, deps({ loadLead: async () => prospectLead }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("recipient-gate");
    expect(rf.calls.all).toBe(0);
  });

  it("AMBIGUOUS: a network fault on submit → ok:false + ambiguous (slot retained, no blind resend)", async () => {
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    global.fetch = resendFetch({ send: () => ({ throw: true }) }).fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps());
    expect(res.ok).toBe(false);
    expect(res.ambiguous).toBe(true);
  });

  it("transport unconfigured → refused (never a bare send)", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const rf = resendFetch();
    global.fetch = rf.fn;
    const res = await sendCompliantOutreach({ leadId: "lead-1", auth, pdf: PDF }, deps());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unconfigured");
    expect(rf.calls.all).toBe(0);
  });

  it("buildOutreachDispatch produces a canonical typed request from persisted state (subject, filename, idempotency)", async () => {
    const built = await buildOutreachDispatch({ leadId: "lead-1", auth, pdf: PDF }, deps());
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
