// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE WORKSPACE TRANSPORT — secret-safety + transport + dual-sender + gate tests.
// Uses FAKE credential values (never real secrets) and a mocked fetch. No network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { googleConfigPresence, googleTransportConfigured, primaryTransport, senderDailyCap } from "./config";
import { configuredSenderIds, listSenderPublic, resolveSenderCredential, isApprovedSenderFrom, type SenderCredential } from "./sender-registry";
import { buildMimeMessage, buildRawMessage, encodeHeaderValue } from "./mime";
import { createGmailProvider, _clearGoogleTokenCache } from "./gmail-transport";
import { selectSender, recordSenderSuccess, recordSenderError, senderHealthSnapshot } from "./sender-health";
import { submitCompliantDispatch, type OutreachDispatchRequest } from "../outreach-transport";
import type { EmailProvider } from "../provider";

// ── Fake, non-secret credential values (obviously not real) ──────────────────
const FAKE = {
  GOOGLE_OAUTH_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "FAKE_CLIENT_SECRET_zzz",
  GOOGLE_WORKSPACE_SENDER_1: "jordan@artifexlabssystems.com",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_1: "FAKE_REFRESH_1_aaa",
  GOOGLE_WORKSPACE_SENDER_2: "jordan@artifexlabsco.com",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_2: "FAKE_REFRESH_2_bbb",
};

const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = [...Object.keys(FAKE), "OUTREACH_PRIMARY_TRANSPORT", "GOOGLE_SENDER_DAILY_CAP", "COMMS_PROSPECT_DELIVERY_ENABLED", "COMMS_TEST_RECIPIENT", "DATABASE_URL", "RESEND_API_KEY", "RESEND_FROM"];

beforeEach(() => {
  for (const k of ENV_KEYS) SAVED[k] = process.env[k];
  delete process.env.DATABASE_URL; // in-memory Settings store
  for (const [k, v] of Object.entries(FAKE)) process.env[k] = v;
  _clearGoogleTokenCache();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  vi.unstubAllGlobals();
});

function mockFetch(responses: Array<{ status: number; body?: any }>) {
  let i = 0;
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)]; i++;
    const bodyStr = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return { ok: r.status >= 200 && r.status < 300, status: r.status, async json() { return r.body ?? {}; }, async text() { return bodyStr; } } as any;
  });
  return { fn, calls };
}

const cred = (): SenderCredential => resolveSenderCredential("sender-1")!;
const dispatchReq = (over: Partial<OutreachDispatchRequest> = {}): OutreachDispatchRequest => ({
  leadId: "lead_g1", recipient: "hello@artifexlabs.tech", subject: "Acquisition OS Transport Test — hello",
  bodyText: "plain body", bodyHtml: "<p>html body</p>", idempotencyKey: "idem-1", classification: "COLD_OUTREACH", ...over,
});

// ── Config presence (booleans only) ──────────────────────────────────────────
describe("config presence", () => {
  it("reports booleans + non-secret addresses; never a secret value", () => {
    const p = googleConfigPresence();
    expect(p.clientIdConfigured).toBe(true);
    expect(p.clientSecretConfigured).toBe(true);
    expect(p.configuredSenderCount).toBe(2);
    expect(p.senders.map((s) => s.address)).toEqual(["jordan@artifexlabssystems.com", "jordan@artifexlabsco.com"]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("FAKE_CLIENT_SECRET");
    expect(json).not.toContain("FAKE_REFRESH_1");
    expect(json).not.toContain("FAKE_REFRESH_2");
  });
  it("transportConfigured requires client id+secret AND a full sender", () => {
    expect(googleTransportConfigured()).toBe(true);
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(googleTransportConfigured()).toBe(false);
  });
  it("primary defaults to resend until explicitly switched", () => {
    expect(primaryTransport()).toBe("resend");
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    expect(primaryTransport()).toBe("google");
  });
});

// ── Sender registry ──────────────────────────────────────────────────────────
describe("sender registry", () => {
  it("resolves sender-1 and sender-2; missing token → not configured", () => {
    expect(configuredSenderIds()).toEqual(["sender-1", "sender-2"]);
    expect(resolveSenderCredential("sender-1")!.address).toBe("jordan@artifexlabssystems.com");
    expect(resolveSenderCredential("sender-2")!.fromHeader).toContain("jordan@artifexlabsco.com");
    delete process.env.GOOGLE_WORKSPACE_REFRESH_TOKEN_2;
    expect(configuredSenderIds()).toEqual(["sender-1"]);
    expect(resolveSenderCredential("sender-2")).toBeNull();
  });
  it("rejects an unapproved/spoofed From, accepts a configured one", () => {
    expect(isApprovedSenderFrom("Artifex Labs <jordan@artifexlabssystems.com>")).toBe(true);
    expect(isApprovedSenderFrom("attacker@evil.com")).toBe(false);
  });
  it("public view never carries a token", () => {
    expect(JSON.stringify(listSenderPublic())).not.toMatch(/FAKE_REFRESH/);
  });
});

// ── MIME ──────────────────────────────────────────────────────────────────────
describe("MIME builder", () => {
  it("encodes a non-ASCII subject as an RFC 2047 word", () => {
    expect(encodeHeaderValue("Quick Review — Acme")).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeaderValue("plain ascii")).toBe("plain ascii");
  });
  it("builds a multipart message with html + plain + attachment; raw is base64url", () => {
    const raw = buildRawMessage({ from: "Artifex Labs <a@b.com>", to: "x@y.com", replyTo: "a@b.com", subject: "Hi — there", text: "t", html: "<p>h</p>", headers: { "List-Unsubscribe": "<https://u>" }, attachments: [{ filename: "r.pdf", content: Buffer.from("PDF").toString("base64"), contentType: "application/pdf" }], boundarySeed: "seed" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: Artifex Labs <a@b.com>");
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Reply-To: a@b.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain('Content-Disposition: attachment; filename="r.pdf"');
    expect(decoded).toContain("List-Unsubscribe: <https://u>");
  });
  it("a passthrough header cannot override the structural Content-Type", () => {
    const m = buildMimeMessage({ from: "a@b.com", to: "x@y.com", subject: "s", text: "t", headers: { "Content-Type": "text/evil" } });
    expect(m).not.toContain("text/evil");
  });
});

// ── Gmail transport: OAuth + send + sanitized errors ─────────────────────────
describe("gmail transport", () => {
  it("refreshes a token then sends; returns the Gmail message id", async () => {
    const { fn, calls } = mockFetch([{ status: 200, body: { access_token: "AT_secret", expires_in: 3600 } }, { status: 200, body: { id: "gmail_msg_1", threadId: "thr_1" } }]);
    const p = createGmailProvider(cred(), { fetchImpl: fn as any });
    const res = await p.send({ to: "hello@artifexlabs.tech", from: cred().fromHeader, replyTo: cred().address, subject: "s", text: "t", idempotencyKey: "k" });
    expect(res.sent).toBe(true);
    expect(res.providerMessageId).toBe("gmail_msg_1");
    expect(calls[0].url).toContain("oauth2");
    expect(calls[1].url).toContain("gmail/v1/users/me/messages/send");
    // The gmail call is authorized with the access token (in the header, not our output).
    expect(calls[1].init.headers.Authorization).toBe("Bearer AT_secret");
  });

  it("sanitizes a token-endpoint error (no secret in the reason)", async () => {
    const { fn } = mockFetch([{ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
    const p = createGmailProvider(cred(), { fetchImpl: fn as any });
    const res = await p.send({ to: "hello@artifexlabs.tech", from: cred().fromHeader, subject: "s", text: "t", idempotencyKey: "k" });
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("validation");
    expect(res.reason).toBe("google_error status=400 code=invalid_grant");
    const blob = JSON.stringify(res);
    expect(blob).not.toContain("FAKE_REFRESH_1");
    expect(blob).not.toContain("FAKE_CLIENT_SECRET");
  });

  it("sanitizes a Gmail send error", async () => {
    const { fn } = mockFetch([{ status: 200, body: { access_token: "AT", expires_in: 3600 } }, { status: 403, body: { error: { status: "PERMISSION_DENIED", message: "insufficient" } } }]);
    const p = createGmailProvider(cred(), { fetchImpl: fn as any });
    const res = await p.send({ to: "hello@artifexlabs.tech", from: cred().fromHeader, subject: "s", text: "t", idempotencyKey: "k" });
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("auth");
    expect(res.reason).toBe("google_error status=403 code=PERMISSION_DENIED");
  });

  it("never writes a credential to the console on failure", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fn } = mockFetch([{ status: 401, body: { error: "unauthorized_client" } }]);
    const p = createGmailProvider(cred(), { fetchImpl: fn as any });
    await p.send({ to: "hello@artifexlabs.tech", from: cred().fromHeader, subject: "s", text: "t", idempotencyKey: "k" });
    const allLogs = [...errSpy.mock.calls, ...logSpy.mock.calls].flat().map(String).join(" ");
    expect(allLogs).not.toMatch(/FAKE_REFRESH|FAKE_CLIENT_SECRET/);
    errSpy.mockRestore(); logSpy.mockRestore();
  });
});

// ── Dual-sender selection + caps + cooldown ──────────────────────────────────
describe("dual-sender rotation + health", () => {
  it("is deterministic per lead and covers both senders across leads", async () => {
    const a = await selectSender({ leadId: "lead_alpha" });
    const a2 = await selectSender({ leadId: "lead_alpha" });
    expect(a.ok && a2.ok && a.senderId === a2.senderId).toBe(true);
    const picks = new Set<string>();
    for (const id of ["l1", "l2", "l3", "l4", "l5", "l6"]) { const s = await selectSender({ leadId: id }); if (s.ok) picks.add(s.senderId); }
    expect(picks.size).toBe(2); // both mailboxes are reachable
  });

  it("excludes a sender at its daily cap (stacks under global cap)", async () => {
    process.env.GOOGLE_SENDER_DAILY_CAP = "1";
    expect(senderDailyCap()).toBe(1);
    await recordSenderSuccess("sender-1", new Date().toISOString());
    await recordSenderSuccess("sender-2", new Date().toISOString());
    const s = await selectSender({ leadId: "lead_x" });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/cap|cooling/);
  });

  it("puts a repeatedly-failing sender into cooldown (no unlimited spillover)", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) await recordSenderError("sender-1", now, "server");
    const snap = await senderHealthSnapshot();
    const s1 = snap.find((r) => r.id === "sender-1")!;
    expect(s1.cooldownUntil).toBeTruthy();
    expect(s1.healthy).toBe(false);
    // sender-2 remains healthy and bounded by ITS own cap — never unlimited.
    expect(snap.find((r) => r.id === "sender-2")!.healthy).toBe(true);
  });
});

// ── Canonical boundary integration ───────────────────────────────────────────
describe("canonical boundary with Google primary", () => {
  it("sends via a dual-sender mailbox; From is server-controlled", async () => {
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const { fn, calls } = mockFetch([{ status: 200, body: { access_token: "AT", expires_in: 3600 } }, { status: 200, body: { id: "gmail_send_1" } }]);
    vi.stubGlobal("fetch", fn);
    const res = await submitCompliantDispatch(dispatchReq(), "https://u/unsub");
    expect(res.sent).toBe(true);
    expect(res.transport).toBe("google-workspace");
    expect([FAKE.GOOGLE_WORKSPACE_SENDER_1, FAKE.GOOGLE_WORKSPACE_SENDER_2]).toContain(res.senderAddress);
    const rawSent = JSON.parse(calls[1].init.body).raw as string;
    expect(Buffer.from(rawSent, "base64url").toString("utf8")).toContain(`<${res.senderAddress}>`);
  });

  it("suppression still blocks — Gmail is never called", async () => {
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const { fn, calls } = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const res = await submitCompliantDispatch(dispatchReq(), "https://u", { isSuppressed: async () => true });
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("suppressed");
    expect(calls.length).toBe(0);
  });

  it("recipient gate still blocks prospect delivery until enabled", async () => {
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED;
    process.env.COMMS_TEST_RECIPIENT = "hello@artifexlabs.tech";
    const { fn, calls } = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const res = await submitCompliantDispatch(dispatchReq({ recipient: "prospect@somewhere.com" }), "https://u");
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("recipient-gate");
    expect(calls.length).toBe(0);
  });

  it("no silent failover: Google-primary with no eligible sender fails visibly (never Resend)", async () => {
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    process.env.GOOGLE_SENDER_DAILY_CAP = "1";
    await recordSenderSuccess("sender-1", new Date().toISOString());
    await recordSenderSuccess("sender-2", new Date().toISOString());
    const { fn, calls } = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const res = await submitCompliantDispatch(dispatchReq(), "https://u");
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("no-eligible-sender");
    expect(res.transport).toBe("google-workspace");
    expect(calls.length).toBe(0); // did NOT fall through to another provider
  });

  it("rollback: with primary=resend, Google is NOT selected even when configured", async () => {
    delete process.env.OUTREACH_PRIMARY_TRANSPORT; // default resend
    delete process.env.RESEND_API_KEY; // resend disabled → unconfigured
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const { fn, calls } = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const res = await submitCompliantDispatch(dispatchReq(), "https://u");
    expect(res.transport).not.toBe("google-workspace");
    expect(res.errorCode).toBe("unconfigured");
    expect(calls.length).toBe(0);
  });

  it("an injected provider (rehearsal/test) wins and Google is not used", async () => {
    process.env.OUTREACH_PRIMARY_TRANSPORT = "google";
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    const { fn, calls } = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const fake: EmailProvider = {
      name: "fake", canSend: true, meta: { name: "fake", mode: "live", fromDomain: null, batchLimit: 1, configured: true },
      async send() { return { sent: true, providerMessageId: "fake_1" }; },
      async sendEmail() { return { sent: true, providerMessageId: "fake_1" }; },
      async sendBatch() { return [{ sent: true, providerMessageId: "fake_1" }]; },
      async verifyConfiguration() { return { ok: true, issues: [] }; },
      async healthCheck() { return { ok: true, issues: [] }; },
    };
    const res = await submitCompliantDispatch(dispatchReq(), "https://u", { provider: fake });
    expect(res.sent).toBe(true);
    expect(res.transport).toBe("fake");
    expect(calls.length).toBe(0); // no Google fetch
  });
});
