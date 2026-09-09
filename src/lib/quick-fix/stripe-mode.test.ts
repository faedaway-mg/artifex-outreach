// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX STRIPE MODE — TEST/LIVE key + webhook-secret separation tests.
// Uses FAKE key/secret values (never real). Proves modes cannot silently cross and
// that livemode is only trusted AFTER signature verification.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { stripeKeyMode, quickFixStripeMode, resolveQuickFixStripeKey, stripeModeDiagnostics } from "./stripe-mode";
import { verifyConfiguredWebhook, livemodeAgrees, webhookSecretPresence } from "./webhook-secrets";

const FAKE_TEST_KEY = "sk_test_FAKEtest123";
const FAKE_LIVE_KEY = "sk_live_FAKElive456";
const WH_TEST = "whsec_FAKEtest";
const WH_LIVE = "whsec_FAKElive";
const WH_LEGACY = "whsec_FAKElegacy";
const TS = 1_800_000_000;

function sign(secret: string, payload: string, ts = TS): string {
  const v1 = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

describe("stripe key mode resolution", () => {
  const env = { STRIPE_TEST_KEY: FAKE_TEST_KEY, STRIPE_SECRET_KEY: FAKE_LIVE_KEY } as any;
  it("maps prefixes without exposing the key", () => {
    expect(stripeKeyMode(FAKE_TEST_KEY)).toBe("test");
    expect(stripeKeyMode(FAKE_LIVE_KEY)).toBe("live");
    expect(stripeKeyMode("garbage")).toBe("unknown");
  });
  it("TEST resolves the test key; LIVE resolves the live key", () => {
    expect(resolveQuickFixStripeKey(env, "test")).toMatchObject({ ok: true, key: FAKE_TEST_KEY, mode: "test" });
    expect(resolveQuickFixStripeKey(env, "live")).toMatchObject({ ok: true, key: FAKE_LIVE_KEY, mode: "live" });
  });
  it("defaults to TEST until STRIPE_QUICKFIX_MODE=live", () => {
    expect(quickFixStripeMode({} as any)).toBe("test");
    expect(quickFixStripeMode({ STRIPE_QUICKFIX_MODE: "live" } as any)).toBe("live");
  });
  it("fails closed on a mode/prefix mismatch (a live key under test mode)", () => {
    const bad = resolveQuickFixStripeKey({ STRIPE_TEST_KEY: FAKE_LIVE_KEY } as any, "test");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/does not match/);
  });
  it("fails closed when the mode's key is missing", () => {
    expect(resolveQuickFixStripeKey({ STRIPE_TEST_KEY: FAKE_TEST_KEY } as any, "live").ok).toBe(false);
  });
});

describe("webhook secret mode separation", () => {
  const payloadTest = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", livemode: false });
  const payloadLive = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", livemode: true });
  const bothEnv = { STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST: WH_TEST, STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE: WH_LIVE } as any;

  it("TEST signature verifies as test; LIVE as live", () => {
    expect(verifyConfiguredWebhook({ payload: payloadTest, header: sign(WH_TEST, payloadTest), nowSec: TS, env: bothEnv })).toMatchObject({ ok: true, mode: "test" });
    expect(verifyConfiguredWebhook({ payload: payloadLive, header: sign(WH_LIVE, payloadLive), nowSec: TS, env: bothEnv })).toMatchObject({ ok: true, mode: "live" });
  });
  it("a TEST-secret signature is NOT accepted when only LIVE is configured", () => {
    const liveOnly = { STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE: WH_LIVE } as any;
    expect(verifyConfiguredWebhook({ payload: payloadTest, header: sign(WH_TEST, payloadTest), nowSec: TS, env: liveOnly }).ok).toBe(false);
  });
  it("a LIVE-secret signature is NOT accepted by the TEST secret", () => {
    const testOnly = { STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST: WH_TEST } as any;
    expect(verifyConfiguredWebhook({ payload: payloadLive, header: sign(WH_LIVE, payloadLive), nowSec: TS, env: testOnly }).ok).toBe(false);
  });
  it("legacy secret is a TEST-only fallback; LIVE never uses it", () => {
    const legacyOnly = { STRIPE_QUICKFIX_WEBHOOK_SECRET: WH_LEGACY } as any;
    const r = verifyConfiguredWebhook({ payload: payloadTest, header: sign(WH_LEGACY, payloadTest), nowSec: TS, env: legacyOnly });
    expect(r).toMatchObject({ ok: true, mode: "test", usedLegacy: true });
    // A legacy-signed event that CLAIMS livemode:true is verified as test → livemode disagrees → rejected downstream.
    expect(livemodeAgrees("test", true)).toBe(false);
    // With _TEST present, legacy is not used.
    const withTest = { STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST: WH_TEST, STRIPE_QUICKFIX_WEBHOOK_SECRET: WH_LEGACY } as any;
    expect(verifyConfiguredWebhook({ payload: payloadTest, header: sign(WH_LEGACY, payloadTest), nowSec: TS, env: withTest }).ok).toBe(false);
  });
  it("an invalid/missing signature is rejected (no unverified event proceeds)", () => {
    expect(verifyConfiguredWebhook({ payload: payloadTest, header: "t=1,v1=deadbeef", nowSec: TS, env: bothEnv }).ok).toBe(false);
    expect(verifyConfiguredWebhook({ payload: payloadTest, header: null, nowSec: TS, env: bothEnv }).ok).toBe(false);
  });
});

describe("livemode agreement (only consulted post-verification)", () => {
  it("requires the event livemode to match the verifying secret's mode", () => {
    expect(livemodeAgrees("test", false)).toBe(true);
    expect(livemodeAgrees("test", true)).toBe(false);
    expect(livemodeAgrees("live", true)).toBe(true);
    expect(livemodeAgrees("live", false)).toBe(false);
    expect(livemodeAgrees("live", undefined)).toBe(false);
  });
});

describe("diagnostics never expose secret values", () => {
  it("reports booleans + mode only", () => {
    const env = { STRIPE_TEST_KEY: FAKE_TEST_KEY, STRIPE_SECRET_KEY: FAKE_LIVE_KEY, STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST: WH_TEST, STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE: WH_LIVE } as any;
    const diag = { ...stripeModeDiagnostics(env), ...webhookSecretPresence(env) };
    expect(diag).toMatchObject({ stripeTestKeyConfigured: true, stripeLiveKeyConfigured: true, testWebhookSecretConfigured: true, liveWebhookSecretConfigured: true });
    const json = JSON.stringify(diag);
    for (const secret of [FAKE_TEST_KEY, FAKE_LIVE_KEY, WH_TEST, WH_LIVE]) expect(json).not.toContain(secret);
  });
});
