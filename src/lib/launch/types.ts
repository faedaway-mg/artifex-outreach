// ─────────────────────────────────────────────────────────────────────────────
// Launch Readiness — shared vocabulary.
//
// One status language used by every launch surface: the dashboard, the readiness
// checklist, the validation CLI, the platform-health view, and the confidence
// report. Keeping it here means the UI and the command line always agree on what
// "PASS / WARN / FAIL" means and how sections roll up.
//
// Honesty rule (matches the rest of this codebase): a metric that is not yet
// instrumented is never invented. It is reported as `tracked: false` so the
// operator can see exactly what is measured versus what will light up once real
// outreach produces data. Nothing here fabricates a number.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** One-line explanation of why this status was assigned. */
  detail: string;
  /** Recommended fix when status is warn/fail. */
  fix?: string;
}

export interface CheckSection {
  name: string;
  checks: Check[];
}

/** A single dashboard number with provenance. `tracked:false` → not yet measured. */
export interface Metric {
  label: string;
  value: number | string | null;
  tracked: boolean;
  /** Optional secondary context (e.g. "12/40" or a data-source note). */
  hint?: string;
}

export const STATUS_RANK: Record<CheckStatus, number> = { pass: 0, warn: 1, fail: 2 };
export const STATUS_LABEL: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };

/** The worst status in a list (fail beats warn beats pass). Empty → pass. */
export function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), "pass");
}

export interface Rollup {
  pass: number;
  warn: number;
  fail: number;
  total: number;
  status: CheckStatus;
}

export function rollupChecks(checks: Check[]): Rollup {
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  return { pass, warn, fail, total: checks.length, status: worst(checks.map((c) => c.status)) };
}

export function rollupSections(sections: CheckSection[]): Rollup {
  return rollupChecks(sections.flatMap((s) => s.checks));
}

/** Convenience constructor so callsites stay terse and consistent. */
export function check(id: string, label: string, status: CheckStatus, detail: string, fix?: string): Check {
  return { id, label, status, detail, ...(fix ? { fix } : {}) };
}

export function metric(label: string, value: number | string | null, tracked = true, hint?: string): Metric {
  return { label, value, tracked, ...(hint ? { hint } : {}) };
}

/** Count → distribution rows, largest first. */
export function distribution<T>(items: T[], keyOf: (t: T) => string | null | undefined): [string, number][] {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 100) : 0;
}
