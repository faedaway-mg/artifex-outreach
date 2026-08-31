// Minimum storage-guard invariants: per-artifact hard cap + total-usage reservation, both fail-closed.
import { describe, it, expect } from "vitest";
import { evaluateQuota, quotaLimits, DEFAULT_MAX_ARTIFACT_BYTES, DEFAULT_TOTAL_QUOTA_BYTES } from "./cs-quota";

const L = { maxArtifactBytes: 1000, totalQuotaBytes: 5000 };

describe("evaluateQuota", () => {
  it("allows a normal artifact within both limits", () => {
    expect(evaluateQuota(0, 500, L)).toEqual({ ok: true });
    expect(evaluateQuota(4000, 500, L)).toEqual({ ok: true });
  });

  it("rejects a single artifact over the per-artifact cap (HARD)", () => {
    const v = evaluateQuota(0, 1001, L);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/per-artifact cap/);
  });

  it("rejects when used + incoming would breach the total reservation", () => {
    const v = evaluateQuota(4600, 500, L); // 5100 > 5000
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/storage quota exceeded/);
  });

  it("allows exactly at each boundary (inclusive)", () => {
    expect(evaluateQuota(0, 1000, L)).toEqual({ ok: true }); // == per-artifact cap
    expect(evaluateQuota(4000, 1000, L)).toEqual({ ok: true }); // == total
  });

  it("rejects negative sizes defensively", () => {
    expect(evaluateQuota(0, -1, L).ok).toBe(false);
  });
});

describe("quotaLimits env parsing", () => {
  it("uses safe defaults when unset", () => {
    const l = quotaLimits({} as NodeJS.ProcessEnv);
    expect(l.maxArtifactBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
    expect(l.totalQuotaBytes).toBe(DEFAULT_TOTAL_QUOTA_BYTES);
  });

  it("honors explicit overrides", () => {
    const l = quotaLimits({ CS_MAX_ARTIFACT_BYTES: "123", CS_STORAGE_QUOTA_BYTES: "456" } as unknown as NodeJS.ProcessEnv);
    expect(l).toEqual({ maxArtifactBytes: 123, totalQuotaBytes: 456 });
  });

  it("ignores garbage/zero/negative overrides (falls back to defaults)", () => {
    const l = quotaLimits({ CS_MAX_ARTIFACT_BYTES: "0", CS_STORAGE_QUOTA_BYTES: "-9" } as unknown as NodeJS.ProcessEnv);
    expect(l.maxArtifactBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
    expect(l.totalQuotaBytes).toBe(DEFAULT_TOTAL_QUOTA_BYTES);
  });
});
