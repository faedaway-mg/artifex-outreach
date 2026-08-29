import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGraphProvider, graphMessage, allowedRecipient } from "./graph";
import type { EmailMessage } from "./provider";

const ENV = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_SENDER", "COMMS_TEST_RECIPIENT", "COMMS_PROSPECT_DELIVERY_ENABLED"] as const;
const ORIG: Record<string, string | undefined> = {};

function setConfigured() {
  process.env.GRAPH_TENANT_ID = "tenant"; process.env.GRAPH_CLIENT_ID = "client"; process.env.GRAPH_CLIENT_SECRET = "secret"; process.env.GRAPH_SENDER = "hello@artifexlabs.tech";
  process.env.COMMS_TEST_RECIPIENT = "qa@artifexlabs.tech"; delete process.env.COMMS_PROSPECT_DELIVERY_ENABLED;
}
const msg = (to: string, over: Partial<EmailMessage> = {}): EmailMessage => ({ to, from: "hello@artifexlabs.tech", replyTo: "hello@artifexlabs.tech", subject: "Quick Review", text: "hi", html: "<p>hi</p>", idempotencyKey: "step:1", ...over });

// A mock fetch: token endpoint returns an access token; sendMail returns a configurable status.
function mockFetch(sendStatus: number, opts: { authStatus?: number } = {}) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    if (url.includes("/oauth2/v2.0/token")) return { ok: (opts.authStatus ?? 200) < 400, status: opts.authStatus ?? 200, json: async () => ({ access_token: "tok" }), text: async () => "" };
    return { ok: sendStatus < 400, status: sendStatus, json: async () => ({}), text: async () => `status ${sendStatus}` };
  };
  return { f: f as any, calls };
}

beforeEach(() => { for (const k of ENV) ORIG[k] = process.env[k]; });
afterEach(() => { for (const k of ENV) ORIG[k] === undefined ? delete process.env[k] : (process.env[k] = ORIG[k]!); });

describe("Microsoft Graph transport", () => {
  it("config-fail-closed: with no creds, canSend=false and send refuses (never a bare/unconfigured send)", async () => {
    for (const k of ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_SENDER"]) delete process.env[k];
    const p = createGraphProvider(mockFetch(202).f);
    expect(p.canSend).toBe(false);
    const r = await p.send(msg("qa@artifexlabs.tech"));
    expect(r.sent).toBe(false);
    expect(r.errorCode).toBe("unconfigured");
  });

  it("TEST-MODE allowlist: refuses any recipient except the Artifex test address — WITHOUT calling Graph", async () => {
    setConfigured();
    const m = mockFetch(202);
    const p = createGraphProvider(m.f);
    const r = await p.send(msg("prospect@somebiz.com")); // a real prospect domain
    expect(r.sent).toBe(false);
    expect(r.errorCode).toBe("test-mode");
    expect(m.calls).toHaveLength(0); // never even authenticated — no send attempt
  });

  it("allowed test recipient + 202 → submitted (submission, not delivery), id = idempotency key", async () => {
    setConfigured();
    const p = createGraphProvider(mockFetch(202).f);
    const r = await p.send(msg("qa@artifexlabs.tech"));
    expect(r.sent).toBe(true);
    expect(r.providerMessageId).toBe("step:1");
  });

  it("Graph errors classify correctly: 429 retryable, 401 auth non-retryable, 400 validation", async () => {
    setConfigured();
    expect((await createGraphProvider(mockFetch(429).f).send(msg("qa@artifexlabs.tech"))).retryable).toBe(true);
    const auth = await createGraphProvider(mockFetch(403).f).send(msg("qa@artifexlabs.tech"));
    expect(auth.sent).toBe(false); expect(auth.errorCode).toBe("auth"); expect(auth.retryable).toBe(false);
    expect((await createGraphProvider(mockFetch(400).f).send(msg("qa@artifexlabs.tech"))).errorCode).toBe("validation");
  });

  it("prospect delivery only when explicitly enabled by the owner", async () => {
    setConfigured();
    expect(allowedRecipient("prospect@x.com").ok).toBe(false);
    process.env.COMMS_PROSPECT_DELIVERY_ENABLED = "1";
    expect(allowedRecipient("prospect@x.com").ok).toBe(true);
  });

  it("builds a Graph message: HTML body, recipient, reply-to, x-* headers only, PDF fileAttachment", () => {
    const g = graphMessage(msg("qa@artifexlabs.tech", { headers: { "x-artifex": "1", "List-Unsubscribe": "<https://x>" }, attachments: [{ filename: "R.pdf", content: "YmFzZTY0", contentType: "application/pdf" }] }));
    expect(g.message.body.contentType).toBe("HTML");
    expect(g.message.toRecipients[0].emailAddress.address).toBe("qa@artifexlabs.tech");
    expect(g.message.replyTo![0].emailAddress.address).toBe("hello@artifexlabs.tech");
    expect(g.message.internetMessageHeaders).toEqual([{ name: "x-artifex", value: "1" }]); // List-Unsubscribe dropped (Graph JSON = x-* only)
    expect((g.message as any).attachments[0]).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "R.pdf", contentType: "application/pdf", contentBytes: "YmFzZTY0" });
    expect(g.saveToSentItems).toBe(true);
  });
});
