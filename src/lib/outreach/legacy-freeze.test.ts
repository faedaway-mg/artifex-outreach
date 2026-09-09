// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COLD-OUTREACH FREEZE — default-frozen gate + send-boundary enforcement.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { legacyColdOutreachFrozen, LEGACY_ENABLE_ENV } from "./legacy-freeze";
import { submitCompliantDispatch, type OutreachDispatchRequest } from "../comms/outreach-transport";

const req = (over: Partial<OutreachDispatchRequest> = {}): OutreachDispatchRequest => ({
  leadId: "lead_1", recipient: "prospect@example.com", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>",
  idempotencyKey: "idem-1", classification: "COLD_OUTREACH", ...over,
});

describe("legacy cold outreach is frozen by default", () => {
  it("frozen unless explicitly re-enabled with =1", () => {
    expect(legacyColdOutreachFrozen({} as NodeJS.ProcessEnv)).toBe(true);
    expect(legacyColdOutreachFrozen({ [LEGACY_ENABLE_ENV]: "0" } as any)).toBe(true);
    expect(legacyColdOutreachFrozen({ [LEGACY_ENABLE_ENV]: "true" } as any)).toBe(true);
    expect(legacyColdOutreachFrozen({ [LEGACY_ENABLE_ENV]: "1" } as any)).toBe(false);
  });
});

describe("the send boundary refuses cold prospect email while frozen", () => {
  it("COLD_OUTREACH is fail-closed with a legacy-frozen reason (before any transport work)", async () => {
    const prev = process.env[LEGACY_ENABLE_ENV];
    delete process.env[LEGACY_ENABLE_ENV]; // frozen (default)
    const res = await submitCompliantDispatch(req(), "https://x/unsub");
    expect(res.sent).toBe(false);
    expect(res.errorCode).toBe("legacy-frozen");
    if (prev !== undefined) process.env[LEGACY_ENABLE_ENV] = prev;
  });
  it("a non-cold classification is never refused for the legacy-frozen reason", async () => {
    // TRANSACTIONAL is not a compliant cold route at all → route-refused, NOT legacy-frozen.
    const res = await submitCompliantDispatch(req({ classification: "TRANSACTIONAL" }), "https://x/unsub");
    expect(res.errorCode).not.toBe("legacy-frozen");
  });
  it("INTERNAL_TEST (pinned to the test recipient) is NOT frozen — controlled proofs still work", async () => {
    const prev = process.env[LEGACY_ENABLE_ENV];
    delete process.env[LEGACY_ENABLE_ENV];
    const res = await submitCompliantDispatch(req({ classification: "INTERNAL_TEST" }), "https://x/unsub");
    // It fails later (no provider / recipient gate) but NEVER for legacy-frozen.
    expect(res.errorCode).not.toBe("legacy-frozen");
    if (prev !== undefined) process.env[LEGACY_ENABLE_ENV] = prev;
  });
});
