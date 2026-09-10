// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED PER-LANE SEND PROOF — exercises a controlled outbound send through EACH
// Google Workspace lane (A and B) independently and verifies the §12 checklist without
// contacting a real prospect: provider accepts, From identity is the lane, Reply-To
// mirrors the lane, thread/message id is captured, NO Resend request occurs, and no
// second message is triggered. Mocked Gmail API; in-memory Settings; no network, no secrets.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { submitCompliantDispatch, type OutreachDispatchRequest } from "../outreach-transport";
import { _clearGoogleTokenCache } from "./gmail-transport";
import { __resetStoreForTests } from "../../store";

const FAKE = {
  GOOGLE_OAUTH_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "FAKE_SECRET",
  GOOGLE_WORKSPACE_SENDER_1: "outreach-a@lane-a.test",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_1: "FAKE_RT_1",
  GOOGLE_WORKSPACE_SENDER_2: "outreach-b@lane-b.test",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_2: "FAKE_RT_2",
  COMMS_PROSPECT_DELIVERY_ENABLED: "1",
};
const SAVED: Record<string, string | undefined> = {};
const KEYS = [...Object.keys(FAKE), "DATABASE_URL", "GOOGLE_SENDER_1_ENABLED", "GOOGLE_SENDER_2_ENABLED", "COMMS_CANONICAL_REPLY_TO"];

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  delete process.env.DATABASE_URL;
  delete process.env.COMMS_CANONICAL_REPLY_TO;
  for (const [k, v] of Object.entries(FAKE)) process.env[k] = v;
  __resetStoreForTests();
  _clearGoogleTokenCache();
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  vi.unstubAllGlobals();
});

// A fetch double that speaks the Google OAuth token endpoint + Gmail send, and records every URL so we
// can assert NO Resend call occurred. Returns a Gmail message id (thread lineage).
function gmailFetch() {
  const urls: string[] = [];
  const sendBodies: string[] = [];
  const fn = vi.fn(async (url: any, init: any) => {
    const u = String(url);
    urls.push(u);
    if (/oauth2|\/token/.test(u)) return { ok: true, status: 200, json: async () => ({ access_token: "AT", expires_in: 3600 }), text: async () => "{}" } as any;
    sendBodies.push(typeof init?.body === "string" ? init.body : "");
    return { ok: true, status: 200, json: async () => ({ id: "gmail_msg_x", threadId: "thr_x" }), text: async () => "{}" } as any;
  });
  return { fn, urls, sendBodies };
}
const decodeMime = (bodies: string[], n = 1): string => { try { const raw = JSON.parse(bodies[n - 1]).raw; return Buffer.from(raw, "base64url").toString("utf8"); } catch { return ""; } };

const req = (over: Partial<OutreachDispatchRequest> = {}): OutreachDispatchRequest => ({
  leadId: "lead_ctl", recipient: "qa@artifexlabs.tech", subject: "Controlled lane test",
  bodyText: "plain", bodyHtml: "<p>html</p>", idempotencyKey: "ctl-1", classification: "COLD_OUTREACH",
  messageId: "<ctl-1@artifexlabs.tech>", ...over,
});

describe("controlled send — Lane A (Lane B disabled to force A)", () => {
  it("provider accepts; From + Reply-To are Lane A; gmail id captured; NO Resend; one message only", async () => {
    process.env.GOOGLE_SENDER_2_ENABLED = "0"; // force Lane A
    const g = gmailFetch();
    vi.stubGlobal("fetch", g.fn);
    const res = await submitCompliantDispatch(req({ leadId: "lead_A" }), "https://u/unsub");
    expect(res.sent).toBe(true);
    expect(res.transport).toBe("google-workspace");
    expect(res.senderAddress).toBe("outreach-a@lane-a.test");
    expect(res.providerMessageId).toBe("gmail_msg_x"); // thread/message lineage captured
    const mime = decodeMime(g.sendBodies);
    expect(mime).toContain("From: Jordan Jackson <outreach-a@lane-a.test>");
    expect(mime).toContain("Reply-To: outreach-a@lane-a.test"); // replies land in Lane A's mailbox
    expect(mime).toContain("List-Unsubscribe: <https://u/unsub>");
    // NO Resend request occurred; exactly one Gmail send (no accidental second/follow-up message).
    expect(g.urls.some((u) => /resend/.test(u))).toBe(false);
    expect(g.sendBodies.length).toBe(1);
  });
});

describe("controlled send — Lane B (Lane A disabled to force B)", () => {
  it("provider accepts; From + Reply-To are Lane B; NO Resend; one message only", async () => {
    process.env.GOOGLE_SENDER_1_ENABLED = "0"; // force Lane B
    const g = gmailFetch();
    vi.stubGlobal("fetch", g.fn);
    const res = await submitCompliantDispatch(req({ leadId: "lead_B" }), "https://u/unsub");
    expect(res.sent).toBe(true);
    expect(res.senderAddress).toBe("outreach-b@lane-b.test");
    const mime = decodeMime(g.sendBodies);
    expect(mime).toContain("From: Jordan Jackson <outreach-b@lane-b.test>");
    expect(mime).toContain("Reply-To: outreach-b@lane-b.test");
    expect(g.urls.some((u) => /resend/.test(u))).toBe(false);
    expect(g.sendBodies.length).toBe(1);
  });
});

describe("controlled send — suppression + a canonical Reply-To override", () => {
  it("suppression blocks the send — Gmail is never called (no message leaves)", async () => {
    const g = gmailFetch();
    vi.stubGlobal("fetch", g.fn);
    const res = await submitCompliantDispatch(req(), "https://u", { isSuppressed: async () => true });
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("suppressed");
    expect(g.urls.length).toBe(0);
  });

  it("a configured canonical Reply-To overrides the per-lane mailbox", async () => {
    process.env.GOOGLE_SENDER_2_ENABLED = "0"; // force Lane A
    process.env.COMMS_CANONICAL_REPLY_TO = "replies@artifexoutreach.test";
    const g = gmailFetch();
    vi.stubGlobal("fetch", g.fn);
    const res = await submitCompliantDispatch(req({ leadId: "lead_A" }), "https://u");
    expect(res.sent).toBe(true);
    const mime = decodeMime(g.sendBodies);
    expect(mime).toContain("From: Jordan Jackson <outreach-a@lane-a.test>"); // From is still the lane
    expect(mime).toContain("Reply-To: replies@artifexoutreach.test");       // Reply-To is the canonical inbox
  });
});
