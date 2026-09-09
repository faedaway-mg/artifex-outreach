// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH READINESS GATE — GO / NO-GO aggregation. Deterministic via env injection;
// never sends, never charges, never contacts a real provider. Storage resolves to
// the local dev store (no CS_STORAGE_PROVIDER, non-production), Breakbot runs the
// self-contained golden fixture, ElevenLabs is gated purely on injected env presence.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  computeLaunchReadiness,
  REQUIRED_TO_SEND_A_PROSPECT,
  REQUIRED_FOR_MATT_JOURNEY,
  type LaunchReadiness,
} from "./launch-readiness";
import type { EnvLike } from "./send-readiness";

// A fully-configured, no-send-by-default environment that should reach GO. Prospect
// delivery + autosend are OFF (the safe default), which is exactly what the gate wants.
const GO_ENV: EnvLike = {
  RESEND_API_KEY: "re_x",
  RESEND_FROM: "Artifex Labs <hello@artifexlabs.tech>",
  RESEND_WEBHOOK_SECRET: "whsec_x",
  COMMS_UNSUBSCRIBE_SECRET: "unsub_x",
  COMMS_POSTAL_ADDRESS: "123 Real Street, Los Angeles, CA",
  COMMS_TEST_RECIPIENT: "qa+internal@artifexlabs.tech",
  ELEVENLABS_API_KEY: "el_x",
  ELEVENLABS_VOICE_ID: "voice_x",
  // No prospect-delivery / autosend / CS_STORAGE_PROVIDER / NODE_ENV=production.
};

const check = (r: LaunchReadiness, id: string) => r.checks.find((c) => c.id === id)!;

describe("computeLaunchReadiness — required-set contract", () => {
  it("the prospect-send required set is a subset of the Matt-journey required set", () => {
    for (const id of REQUIRED_TO_SEND_A_PROSPECT) {
      expect(REQUIRED_FOR_MATT_JOURNEY).toContain(id);
    }
    // Matt journey adds the personalization/asset stack.
    expect(REQUIRED_FOR_MATT_JOURNEY).toContain("elevenlabs");
    expect(REQUIRED_FOR_MATT_JOURNEY).toContain("breakbot");
    expect(REQUIRED_TO_SEND_A_PROSPECT).not.toContain("elevenlabs");
  });
});

describe("computeLaunchReadiness — GO / NO-GO", () => {
  it("GO when all required checks pass (mock env)", async () => {
    const r = await computeLaunchReadiness(GO_ENV, { contactEmail: null, businessAddress: null });
    expect(r.state).toBe("GO");
    expect(r.blockers).toHaveLength(0);
    expect(r.performsSend).toBe(false);
    // Every required check is ok.
    for (const c of r.checks.filter((c) => c.required)) expect(c.ok, `${c.id} should pass`).toBe(true);
  });

  it("NO-GO when the outbound provider is unconfigured", async () => {
    const { RESEND_API_KEY, ...noProvider } = GO_ENV;
    void RESEND_API_KEY;
    const r = await computeLaunchReadiness(noProvider);
    expect(r.state).toBe("NO-GO");
    expect(check(r, "provider").ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/provider/i);
  });

  it("NO-GO when the opt-out path is missing (no unsubscribe secret / no postal)", async () => {
    const { COMMS_UNSUBSCRIBE_SECRET, COMMS_POSTAL_ADDRESS, ...noOptOut } = GO_ENV;
    void COMMS_UNSUBSCRIBE_SECRET; void COMMS_POSTAL_ADDRESS;
    const r = await computeLaunchReadiness(noOptOut, { contactEmail: null, businessAddress: null });
    expect(r.state).toBe("NO-GO");
    expect(check(r, "opt-out").ok).toBe(false);
    expect(check(r, "opt-out").detail).toMatch(/COMMS_UNSUBSCRIBE_SECRET|postal/);
  });

  it("NO-GO when the sender identity is missing (also collapses the reply path)", async () => {
    const { RESEND_FROM, ...noFrom } = GO_ENV;
    void RESEND_FROM;
    const r = await computeLaunchReadiness(noFrom, { contactEmail: null, businessAddress: null });
    expect(r.state).toBe("NO-GO");
    expect(check(r, "sender").ok).toBe(false);
    expect(check(r, "reply-path").ok).toBe(false);
  });
});

describe("computeLaunchReadiness — no-send-by-default detection", () => {
  it("prospect delivery ON with no deliberate go-live is flagged (no-send-default fails)", async () => {
    const r = await computeLaunchReadiness({ ...GO_ENV, COMMS_PROSPECT_DELIVERY_ENABLED: "1" });
    expect(check(r, "no-send-default").ok).toBe(false);
    expect(check(r, "no-send-default").detail).toMatch(/prospects can receive/i);
    expect(r.state).toBe("NO-GO");
  });

  it("prospect delivery OFF (default) keeps no-send-by-default intact", async () => {
    const r = await computeLaunchReadiness(GO_ENV);
    expect(check(r, "no-send-default").ok).toBe(true);
    expect(check(r, "no-send-default").detail).toMatch(/OFF/);
  });

  it("autosend ON breaks no-send-by-default even when prospect delivery is off", async () => {
    const r = await computeLaunchReadiness({ ...GO_ENV, COMMS_AUTOSEND_ENABLED: "1" });
    expect(check(r, "no-send-default").ok).toBe(false);
    expect(check(r, "no-send-default").detail).toMatch(/autosend/i);
  });
});

describe("computeLaunchReadiness — ElevenLabs (required for Matt journeys)", () => {
  it("NO-GO for a Matt journey when ElevenLabs is unconfigured", async () => {
    const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ...noEleven } = GO_ENV;
    void ELEVENLABS_API_KEY; void ELEVENLABS_VOICE_ID;
    const r = await computeLaunchReadiness(noEleven);
    expect(check(r, "elevenlabs").ok).toBe(false);
    expect(check(r, "elevenlabs").required).toBe(true);
    expect(r.state).toBe("NO-GO");
  });
});

describe("computeLaunchReadiness — live dependency checks", () => {
  it("Breakbot golden fixture yields a healthy PASS", async () => {
    const r = await computeLaunchReadiness(GO_ENV);
    expect(check(r, "breakbot").ok).toBe(true);
    expect(check(r, "breakbot").detail).toMatch(/READY/);
  });

  it("the canonical asset resolver resolves without throwing (local dev store)", async () => {
    const r = await computeLaunchReadiness(GO_ENV);
    expect(check(r, "asset-resolver").ok).toBe(true);
    expect(check(r, "asset-resolver").detail).toMatch(/mode=/);
  });

  it("a storage FAIL-CLOSED throw (prod, unconfigured) fails that check without crashing the gate", async () => {
    // Production + CS_STORAGE_PROVIDER=postgres with no DB URL → resolveStorageMode throws.
    const r = await computeLaunchReadiness({ ...GO_ENV, NODE_ENV: "production", CS_STORAGE_PROVIDER: "postgres" });
    // The gate still returns a verdict.
    expect(r.state === "GO" || r.state === "NO-GO").toBe(true);
    expect(check(r, "asset-resolver").ok).toBe(false);
    expect(check(r, "asset-resolver").detail).toMatch(/threw|FAIL-CLOSED/i);
    // And it does not throw out of computeLaunchReadiness (we got here).
  });

  it("the trust-video resolver is coherent for BOTH a Matt and a Lucas journey (no cross-generation fallback)", async () => {
    const r = await computeLaunchReadiness(GO_ENV);
    const tv = check(r, "trust-video");
    expect(tv.ok).toBe(true);
    expect(tv.detail).toMatch(/Matt/);
    expect(tv.detail).toMatch(/Lucas/);
    expect(tv.detail).toMatch(/no cross-generation fallback/);
  });

  it("the approval gate is present (no auto-approve)", async () => {
    const r = await computeLaunchReadiness(GO_ENV);
    expect(check(r, "approval-gate").ok).toBe(true);
  });
});

describe("computeLaunchReadiness — audit + safety", () => {
  it("embeds the send-infra audit (booleans only) and never exposes a secret", async () => {
    const r = await computeLaunchReadiness(GO_ENV, { contactEmail: "ops@artifexlabs.tech", businessAddress: "1 A St" });
    expect(r.audit.provider).toBe("resend");
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("re_x");
    expect(serialized).not.toContain("el_x");
    expect(serialized).not.toContain("hello@artifexlabs.tech");
    expect(serialized).not.toContain("qa+internal@artifexlabs.tech");
    expect(serialized).not.toContain("ops@artifexlabs.tech");
  });

  it("is resilient — always returns a verdict object with checks even on an empty env", async () => {
    const r = await computeLaunchReadiness({});
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.length).toBeGreaterThan(0);
    expect(r.performsSend).toBe(false);
    expect(r.state).toBe("NO-GO");
  });
});
