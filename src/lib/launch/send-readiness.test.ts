// ─────────────────────────────────────────────────────────────────────────────
// SEND-INFRASTRUCTURE AUDIT — boolean/enum facts ONLY, never a secret or address.
// The audit reads env presence via injection so it is deterministic and never
// touches a real provider.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { auditSendInfrastructure, type EnvLike } from "./send-readiness";
import { GLOBAL_DAILY_CAP } from "@/lib/acquisition/daily-cap";

// A fully-configured send environment (fake secret VALUES — never asserted back out).
const FULL_ENV: EnvLike = {
  RESEND_API_KEY: "re_secret_should_never_leak",
  RESEND_FROM: "Artifex Labs <hello@artifexlabs.tech>",
  RESEND_WEBHOOK_SECRET: "whsec_secret_should_never_leak",
  COMMS_UNSUBSCRIBE_SECRET: "unsub_secret_should_never_leak",
  COMMS_POSTAL_ADDRESS: "123 Real Street, Los Angeles, CA",
  COMMS_TEST_RECIPIENT: "qa+internal@artifexlabs.tech",
  COMMS_PROSPECT_DELIVERY_ENABLED: "1",
  COMMS_AUTOSEND_ENABLED: "1",
  OUTREACH_SENDING_ENABLED: "1",
};

describe("auditSendInfrastructure — facts only, no secrets", () => {
  it("reports every configuration as a boolean when the full env is set", async () => {
    const a = await auditSendInfrastructure(FULL_ENV);
    expect(a.provider).toBe("resend");
    expect(a.sendConfigured).toBe(true);
    expect(a.fromIdentityConfigured).toBe(true);
    expect(a.replyToBehavior).toBe("mirrors-from");
    expect(a.unsubscribeConfigured).toBe(true);
    expect(a.postalAddressConfigured).toBe(true);
    expect(a.webhookConfigured).toBe(true);
    expect(a.prospectDeliveryEnabled).toBe(true);
    expect(a.testRecipientConfigured).toBe(true);
    expect(a.autosendEnabled).toBe(true);
    expect(a.sendingEnabled).toBe(true);
    expect(a.suppressionActive).toBe(true);
    expect(a.dailyCap).toBe(GLOBAL_DAILY_CAP);
  });

  it("reports absence as false when the env is empty", async () => {
    const a = await auditSendInfrastructure({});
    expect(a.sendConfigured).toBe(false);
    expect(a.fromIdentityConfigured).toBe(false);
    expect(a.unsubscribeConfigured).toBe(false);
    expect(a.postalAddressConfigured).toBe(false);
    expect(a.webhookConfigured).toBe(false);
    expect(a.prospectDeliveryEnabled).toBe(false);
    expect(a.testRecipientConfigured).toBe(false);
    expect(a.autosendEnabled).toBe(false);
    expect(a.sendingEnabled).toBe(false);
  });

  it("NEVER leaks a secret, the From address, or the test-recipient address into the report", async () => {
    const a = await auditSendInfrastructure(FULL_ENV, { contactEmail: "fallback@artifexlabs.tech", businessAddress: "999 Fallback Ave" });
    const serialized = JSON.stringify(a);
    // No secret value.
    expect(serialized).not.toContain("re_secret_should_never_leak");
    expect(serialized).not.toContain("whsec_secret_should_never_leak");
    expect(serialized).not.toContain("unsub_secret_should_never_leak");
    // No From / recipient / postal string.
    expect(serialized).not.toContain("hello@artifexlabs.tech");
    expect(serialized).not.toContain("qa+internal@artifexlabs.tech");
    expect(serialized).not.toContain("fallback@artifexlabs.tech");
    expect(serialized).not.toContain("999 Fallback Ave");
    expect(serialized).not.toContain("123 Real Street");
    // Every value in the object is a boolean, a number, or a known enum string.
    for (const [k, v] of Object.entries(a)) {
      const isSafe =
        typeof v === "boolean" ||
        typeof v === "number" ||
        (k === "provider" && v === "resend") ||
        (k === "transactionalProvider" && v === "resend") ||
        (k === "prospectTransport" && v === "google-workspace") ||
        (k === "replyToBehavior" && v === "mirrors-from");
      expect(isSafe, `field ${k}=${String(v)} must be a boolean/number/known-enum`).toBe(true);
    }
  });

  it("resolves the From identity from Settings contact email when RESEND_FROM is absent", async () => {
    const a = await auditSendInfrastructure({ RESEND_API_KEY: "x" }, { contactEmail: "ops@artifexlabs.tech" });
    expect(a.fromIdentityConfigured).toBe(true);
    // env-only with no Settings ⇒ not configured.
    const b = await auditSendInfrastructure({ RESEND_API_KEY: "x" });
    expect(b.fromIdentityConfigured).toBe(false);
  });

  it("resolves postal from Settings mailing address when COMMS_POSTAL_ADDRESS is absent", async () => {
    const a = await auditSendInfrastructure({}, { businessAddress: "500 Ops Blvd" });
    expect(a.postalAddressConfigured).toBe(true);
  });

  it("treats a whitespace-only env value as not set", async () => {
    const a = await auditSendInfrastructure({ RESEND_API_KEY: "   ", COMMS_UNSUBSCRIBE_SECRET: "" });
    expect(a.sendConfigured).toBe(false);
    expect(a.unsubscribeConfigured).toBe(false);
  });

  it("gates flags on exactly '1' (not 'true'/'yes')", async () => {
    const a = await auditSendInfrastructure({ COMMS_PROSPECT_DELIVERY_ENABLED: "true", OUTREACH_SENDING_ENABLED: "yes" });
    expect(a.prospectDeliveryEnabled).toBe(false);
    expect(a.sendingEnabled).toBe(false);
  });
});
