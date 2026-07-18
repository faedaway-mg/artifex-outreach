// ─────────────────────────────────────────────────────────────────────────────
// Final Launch Confidence report (Phase 7).
//
// Scores each launch dimension 0–100 with a plain-language rationale and gives ONE
// overall recommendation: READY TO LAUNCH or NOT READY. Scores are derived from the
// same validation checks the rest of the system uses (a pass is worth full credit,
// a warning half, a failure none) so the score can never disagree with the
// checklist. A single failing check in any dimension makes the platform NOT READY —
// confidence is not an average that can hide a blocker.
// ─────────────────────────────────────────────────────────────────────────────
import { runValidation, type ValidationReport } from "./validation";
import type { ReadinessOptions } from "./readiness";
import { worst, type Check, type CheckStatus } from "./types";

export interface ConfidenceCategory {
  name: string;
  score: number | null; // null = not evaluated in this context (e.g. tests not run)
  status: CheckStatus;
  rationale: string;
}

export interface LaunchConfidence {
  generatedAt: string;
  categories: ConfidenceCategory[];
  overallScore: number;
  recommendation: "READY TO LAUNCH" | "NOT READY";
  blockingIssues: Check[];
}

/** A toolchain result injected by the CLI (typecheck/lint/test/build). */
export interface ToolchainResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ConfidenceOptions {
  validation?: ValidationReport;
  readiness?: ReadinessOptions;
  /** Real toolchain outcomes from the CLI; when absent, Testing is left unevaluated. */
  toolchain?: ToolchainResult[];
}

function scoreChecks(checks: Check[]): { score: number | null; status: CheckStatus; rationale: string } {
  if (!checks.length) return { score: null, status: "warn", rationale: "Not evaluated in this context." };
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const score = Math.round(((pass * 100 + warn * 50) / checks.length));
  const status = worst(checks.map((c) => c.status));
  const firstIssue = checks.find((c) => c.status === "fail") ?? checks.find((c) => c.status === "warn");
  const rationale = fail || warn
    ? `${pass} pass · ${warn} warn · ${fail} fail. ${firstIssue ? `First issue: ${firstIssue.label} — ${firstIssue.detail}` : ""}`.trim()
    : `All ${pass} check(s) passing.`;
  return { score, status, rationale };
}

export async function launchConfidence(opts: ConfidenceOptions = {}): Promise<LaunchConfidence> {
  const now = new Date();
  const validation = opts.validation ?? (await runValidation(opts.readiness));
  const byCat = (name: string): Check[] => validation.categories.find((c) => c.name === name)?.checks ?? [];

  // Map validation categories → confidence dimensions.
  const dims: Record<string, Check[]> = {
    Website: byCat("Website"),
    "Business Intelligence": byCat("Business Intelligence"),
    "Provider Health": byCat("Provider Health"),
    Communication: byCat("Communication"),
    Discovery: byCat("Discovery"),
    Commercial: byCat("Commercial"),
    Analytics: [...byCat("Analytics"), ...byCat("Dashboard")],
    Deployment: byCat("Deployment"),
    "Operational Readiness": [...byCat("Infrastructure"), ...byCat("Performance"), ...byCat("Security"), ...byCat("Manual Review")],
  };

  const categories: ConfidenceCategory[] = Object.entries(dims).map(([name, checks]) => {
    const s = scoreChecks(checks);
    return { name, ...s };
  });

  // Testing — only meaningful with injected toolchain results.
  const toolchain = opts.toolchain ?? [];
  const testing = toolchain.length
    ? (() => {
        const asChecks: Check[] = toolchain.map((t) => ({ id: `tool.${t.label}`, label: t.label, status: t.status, detail: t.detail }));
        const s = scoreChecks(asChecks);
        return { name: "Testing", ...s };
      })()
    : { name: "Testing", score: null as number | null, status: "warn" as CheckStatus, rationale: "Not run in this context — run `pnpm test` / launch-validate for a Testing score." };
  // Insert Testing before Deployment for a natural reading order.
  categories.splice(categories.findIndex((c) => c.name === "Deployment"), 0, testing);

  const scored = categories.filter((c) => c.score != null) as (ConfidenceCategory & { score: number })[];
  const overallScore = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : 0;

  const blockingIssues = [...validation.blocking, ...toolchain.filter((t) => t.status === "fail").map((t) => ({ id: `tool.${t.label}`, label: t.label, status: "fail" as const, detail: t.detail }))];
  const recommendation: LaunchConfidence["recommendation"] = blockingIssues.length === 0 ? "READY TO LAUNCH" : "NOT READY";

  return { generatedAt: now.toISOString(), categories, overallScore, recommendation, blockingIssues };
}
