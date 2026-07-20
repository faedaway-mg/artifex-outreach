// ─────────────────────────────────────────────────────────────────────────────
// Quality Control types.
//
// Self-contained (no import from ../types) so the domain Deliverable can reference
// QcReport without creating an import cycle. The pipeline in ./pipeline.ts is the
// single entry point; individual checks live in ./checks.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Every automated check the pipeline runs, in a stable order. */
export const QC_CHECK_IDS = [
  "alignment",
  "overflow",
  "missing-screenshots",
  "empty-sections",
  "repeated-content",
  "grammar",
  "spelling",
  "pricing-consistency",
  "broken-layout",
  "image-quality",
  "inconsistent-recommendations",
] as const;
export type QcCheckId = (typeof QC_CHECK_IDS)[number];

/** A blocker fails the report; a warning is surfaced but does not block approval. */
export type QcSeverity = "blocker" | "warning";

export interface QcIssue {
  /** Which section/field the issue was found in (for the operator + repair). */
  location: string;
  message: string;
  /** Optional offending snippet (trimmed) for quick operator scanning. */
  detail?: string;
}

export interface QcCheckResult {
  id: QcCheckId;
  label: string;
  severity: QcSeverity;
  passed: boolean;
  issues: QcIssue[];
}

export interface QcReport {
  /** True when there are zero blocker-severity issues. */
  passed: boolean;
  /** 0..100 — 100 = clean, drops with weighted blockers/warnings. */
  score: number;
  /** How many generate→QC→repair attempts produced this report (1-based). */
  attempts: number;
  checks: QcCheckResult[];
  blockerCount: number;
  warningCount: number;
  /** One-line operator summary. */
  summary: string;
  /** ISO timestamp; caller stamps (kept null-safe for deterministic tests). */
  ranAt: string | null;
}

export function emptyIssues(): QcIssue[] {
  return [];
}
