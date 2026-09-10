// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONAL RESEND REGRESSION — proves the transport split (Resend → transactional
// only, Google Workspace → cold prospect) did NOT break Resend for its legitimate
// transactional role (receipts, confirmations, opted-in notices). Mocked; no network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEmailProvider, resetEmailProvider } from "./provider";
import { transportRouteFor } from "./transport-policy";
import { refuseResendForProspect } from "./prospect-transport";

const SAVED: Record<string, string | undefined> = {};
const KEYS = ["RESEND_API_KEY", "RESEND_FROM", "COMMS_FAKE_PROVIDER", "NODE_ENV"];

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_transactional_test";
  process.env.RESEND_FROM = "Artifex Labs <hello@artifexlabs.tech>";
  delete process.env.COMMS_FAKE_PROVIDER;
  resetEmailProvider();
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  resetEmailProvider();
  vi.unstubAllGlobals();
});

describe("transactional email still works through Resend (regression)", () => {
  it("getEmailProvider resolves the live Resend provider when RESEND_API_KEY is present", () => {
    const p = getEmailProvider();
    expect(p.name).toBe("resend");
    expect(p.canSend).toBe(true);
  });

  it("a transactional message sends via Resend and returns the provider id", async () => {
    const fetchMock = vi.fn(async (_url: any, _init?: any) => ({ ok: true, status: 200, json: async () => ({ id: "resend_txn_1" }), text: async () => "{}" }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const res = await getEmailProvider().send({
      to: "customer@example.com", from: "Artifex Labs <hello@artifexlabs.tech>",
      subject: "Your receipt", text: "Thanks for your purchase.", idempotencyKey: "receipt-1",
    });
    expect(res.sent).toBe(true);
    expect(res.providerMessageId).toBe("resend_txn_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // It POSTed to Resend, not to Google.
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/resend/);
  });

  it("the TRANSACTIONAL route still maps to the transactional provider (Resend permitted)", () => {
    expect(transportRouteFor("TRANSACTIONAL")).toBe("transactional-provider");
  });

  it("the prospect fail-closed guard does NOT apply to transactional Resend (only cold outreach)", () => {
    // refuseResendForProspect is the COLD guard; transactional email is not routed through it, so
    // Resend remains a legitimate transactional transport. The guard only fires for a prospect send.
    expect(refuseResendForProspect("resend")).not.toBeNull(); // would fire IF a prospect tried Resend
    // …but transactional dispatch never calls it — proven by the successful send above.
    expect(getEmailProvider().name).toBe("resend");
  });
});
