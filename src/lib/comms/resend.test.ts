import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { EmailMessage } from "./provider";

// Build a provider with a known env, importing fresh so config() reads our env.
async function makeProvider(env: Record<string, string | undefined> = {}) {
  process.env.RESEND_API_KEY = env.RESEND_API_KEY ?? "re_test_key";
  if ("RESEND_FROM" in env && env.RESEND_FROM === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = env.RESEND_FROM ?? "Jordan Jackson <jordan@artifexlabs.tech>";
  const mod = await import("./resend");
  return mod.createResendProvider();
}

const msg = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  to: "owner@acme.example", from: "Jordan <jordan@artifexlabs.tech>", subject: "Hello", text: "Body {{unsubscribe}}", idempotencyKey: "step:s1", ...over,
});

function jsonResponse(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as unknown as Response;
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

describe("ResendProvider — Phase 1", () => {
  beforeEach(() => { process.env.RESEND_API_KEY = "re_test_key"; });

  it("reports live metadata with derived sending domain", async () => {
    const p = await makeProvider();
    expect(p.name).toBe("resend");
    expect(p.canSend).toBe(true);
    expect(p.meta).toMatchObject({ name: "resend", mode: "live", batchLimit: 100, configured: true, fromDomain: "artifexlabs.tech" });
  });

  it("sends one email and forwards auth + idempotency headers", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) => Promise.resolve(jsonResponse(200, { id: "resend-abc" })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = await makeProvider();
    const r = await p.send(msg());
    expect(r).toEqual({ sent: true, providerMessageId: "resend-abc" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/emails");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("step:s1");
    expect(JSON.parse(init!.body as string)).toMatchObject({ from: msg().from, to: ["owner@acme.example"], subject: "Hello" });
  });

  it("classifies 429 as transient (retryable)", async () => {
    global.fetch = vi.fn(async () => jsonResponse(429, { message: "rate limited" })) as unknown as typeof fetch;
    const p = await makeProvider();
    const r = await p.send(msg());
    expect(r.sent).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.errorCode).toBe("rate_limited");
  });

  it("classifies 401 as permanent (not retryable)", async () => {
    global.fetch = vi.fn(async () => jsonResponse(401, { message: "bad key" })) as unknown as typeof fetch;
    const p = await makeProvider();
    const r = await p.send(msg());
    expect(r.sent).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.errorCode).toBe("auth");
  });

  it("classifies 422 validation as permanent", async () => {
    global.fetch = vi.fn(async () => jsonResponse(422, { message: "invalid to" })) as unknown as typeof fetch;
    const p = await makeProvider();
    expect((await p.send(msg())).errorCode).toBe("validation");
  });

  it("classifies a network throw as transient", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const p = await makeProvider();
    const r = await p.send(msg());
    expect(r).toMatchObject({ sent: false, retryable: true, errorCode: "network" });
  });

  it("classifies an aborted request (timeout) as transient", async () => {
    global.fetch = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) as unknown as typeof fetch;
    const p = await makeProvider();
    expect((await p.send(msg())).errorCode).toBe("timeout");
  });

  it("sends a batch and returns positional provider ids", async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { data: [{ id: "a" }, { id: "b" }] })) as unknown as typeof fetch;
    const p = await makeProvider();
    const results = await p.sendBatch([msg({ idempotencyKey: "s1" }), msg({ idempotencyKey: "s2" })]);
    expect(results).toEqual([
      { sent: true, providerMessageId: "a" },
      { sent: true, providerMessageId: "b" },
    ]);
  });

  it("chunks batches larger than the provider cap into multiple calls", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: Array.from({ length: 100 }, (_, i) => ({ id: `id${i}` })) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = await makeProvider();
    const results = await p.sendBatch(Array.from({ length: 150 }, (_, i) => msg({ idempotencyKey: `s${i}` })));
    expect(fetchMock).toHaveBeenCalledTimes(2); // 100 + 50
    expect(results).toHaveLength(150);
    expect(results.every((r) => r.sent)).toBe(true);
  });

  it("healthCheck pings the provider and reports latency", async () => {
    global.fetch = vi.fn(async () => jsonResponse(200, { data: [] })) as unknown as typeof fetch;
    const p = await makeProvider();
    const h = await p.healthCheck();
    expect(h.ok).toBe(true);
    expect(typeof h.latencyMs).toBe("number");
  });

  it("verifyConfiguration flags a missing verified sender", async () => {
    const p = await makeProvider({ RESEND_FROM: undefined });
    const v = await p.verifyConfiguration();
    expect(v.ok).toBe(false);
    expect(v.issues.join(" ")).toContain("RESEND_FROM");
  });
});
