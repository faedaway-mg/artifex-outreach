// Content Studio — MINIMUM hard storage guard for the durable artifact store. Two limits, both
// fail-closed at publish time so a runaway render or an oversized upload can never exhaust the Postgres
// volume:
//   1. per-artifact hard cap  (CS_MAX_ARTIFACT_BYTES)  — a single object may not exceed this. HARD.
//   2. total-usage reservation (CS_STORAGE_QUOTA_BYTES) — used_bytes + incoming may not exceed this.
// The per-artifact cap is an absolute hard limit. The total-usage gate is a pre-write reservation check
// (best-effort under concurrency — two simultaneous puts could each observe the same `used` and both
// pass; the per-artifact cap bounds the worst-case overshoot, and the quota is set well under the volume
// so a small overshoot is safe). This is deliberately the MINIMUM protection, not a transactional ledger.

export interface QuotaLimits {
  maxArtifactBytes: number; // per-object hard cap
  totalQuotaBytes: number; // total durable-store reservation ceiling
}

// Defaults chosen well under the staging volume (4.9 GB): 200 MB/object, 3 GB total.
export const DEFAULT_MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
export const DEFAULT_TOTAL_QUOTA_BYTES = 3 * 1024 * 1024 * 1024;

export function quotaLimits(env: NodeJS.ProcessEnv = process.env): QuotaLimits {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxArtifactBytes: num(env.CS_MAX_ARTIFACT_BYTES, DEFAULT_MAX_ARTIFACT_BYTES),
    totalQuotaBytes: num(env.CS_STORAGE_QUOTA_BYTES, DEFAULT_TOTAL_QUOTA_BYTES),
  };
}

export type QuotaVerdict = { ok: true } | { ok: false; reason: string };

// Pure decision — testable without a database. `usedBytes` is the current live (non-deleted) total.
export function evaluateQuota(usedBytes: number, incomingBytes: number, limits: QuotaLimits): QuotaVerdict {
  if (incomingBytes < 0) return { ok: false, reason: "negative artifact size" };
  if (incomingBytes > limits.maxArtifactBytes) {
    return { ok: false, reason: `artifact ${incomingBytes}B exceeds per-artifact cap ${limits.maxArtifactBytes}B` };
  }
  if (usedBytes + incomingBytes > limits.totalQuotaBytes) {
    return { ok: false, reason: `storage quota exceeded: used ${usedBytes}B + incoming ${incomingBytes}B > ${limits.totalQuotaBytes}B` };
  }
  return { ok: true };
}

export class QuotaError extends Error {
  constructor(reason: string) {
    super(`Content Studio storage quota: ${reason}`);
    this.name = "QuotaError";
  }
}
