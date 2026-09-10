// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — RELEASE READINESS REPORT + BOUNDED REPAIR (Release Orchestrator §16–§24).
//
// PURE assembly. The orchestrator (scripts/breakbot-release-preflight.ts) runs each
// sub-suite (regression, media timeline, visual, business invariants, escaped-defect
// registry, explainer coverage) and hands their verdicts here; this module composes the
// single Release Readiness Report + final verdict and renders the operator-facing text.
// No I/O, no Date (the caller stamps time so the pure function stays deterministic).
//
// FINAL AUTHORITY (§1/§20/§31): a release is READY_TO_DEPLOY only when every gating
// suite passes. Any BLOCKED suite → BLOCKED. WARNINGs never block. This report is what
// the deploy gate consults; "tests compiled" is not a release.
//
// BOUNDED REPAIR (§16–§19): findings are classified into SAFE, deterministic repair
// proposals (e.g. a blank explainer → reuse an approved visual master; a missing poster
// → rebuild the derived poster). We PROPOSE + structure the repair (§17) with bounded
// attempts (§18); we never auto-execute a destructive/paid/prod-mutating action inside
// the gate (§19). Execution is an authorized operator/coding-agent step.
// ─────────────────────────────────────────────────────────────────────────────

export type SuiteStatus = "PASS" | "WARNING" | "BLOCKED" | "NOT_RUN";
export type ReleaseVerdict = "READY_TO_DEPLOY" | "BLOCKED";

export interface SuiteResult {
  name: string;
  status: SuiteStatus;
  blockers: number;
  warnings: number;
  /** One-line human summary. */
  detail: string;
  /** Specific blocker lines (surface/kind + what was expected vs observed). */
  blockerDetails: string[];
  /** True when this suite gates the deploy (a BLOCKED gating suite → release BLOCKED). */
  gating: boolean;
}

export interface ExplainerCoverage {
  healthy: number;
  total: number;
  /** Scopes with no canonical asset (MISSING) — never silently dropped. */
  missing: string[];
  /** Scopes whose asset is BLOCKED by media QA. */
  broken: string[];
  /** Whether a missing/broken explainer can affect a current customer journey (§9). */
  affectsJourneys: boolean;
}

// ── Bounded repair (§16–§18) ──────────────────────────────────────────────────
export interface RepairProposal {
  /** The finding this repairs (surface/kind). */
  forFinding: string;
  /** The subsystem that owns the fix. */
  owningSubsystem: string;
  /** SAFE deterministic action (no destructive/paid/prod-mutating step here). */
  action: string;
  /** Whether this is auto-orchestrable (bounded) or needs a coding-agent/operator. */
  kind: "auto-orchestrable" | "coding-agent" | "operator";
  /** Structured reproduction/fix note for the coding agent (§17). */
  note: string;
}

export interface ReleaseReportInput {
  candidateSha: string | null;
  suites: SuiteResult[];
  explainerCoverage?: ExplainerCoverage | null;
  escapedDefects: { total: number; pendingDeploy: number };
  repairs: RepairProposal[];
  /** Caller-supplied timestamp (pure module never reads the clock). */
  generatedAt: string;
}

export interface ReleaseReadinessReport {
  candidateSha: string | null;
  generatedAt: string;
  suites: SuiteResult[];
  explainerCoverage: ExplainerCoverage | null;
  escapedDefects: { total: number; pendingDeploy: number };
  repairs: RepairProposal[];
  blockers: string[];
  warnings: string[];
  verdict: ReleaseVerdict;
}

/**
 * Classify a blocking finding kind into a SAFE bounded repair proposal (§16/§17).
 * Returns null when there is no known safe automatic remediation → escalate as a
 * SYSTEM BLOCKER for a human (§18). Never proposes a paid/destructive action (§19):
 * e.g. a blank explainer is repaired by REUSING an existing approved visual master +
 * the EXISTING canonical audio (no re-render, no ElevenLabs) — exactly the recovery
 * that was performed by hand.
 */
export function classifyRepair(surface: string, kind: string, subject: string): RepairProposal | null {
  switch (kind) {
    case "media.blankTimeline":
    case "media.static":
      return {
        forFinding: `${surface}:${kind}`,
        owningSubsystem: "quick-fix/trust-explainer",
        action: `Rebind ${subject} to its approved VISUAL MASTER (stream-copy) + the EXISTING canonical audio — no re-render, no ElevenLabs.`,
        kind: "auto-orchestrable",
        note: `The rendered visuals for ${subject} are blank/static after the opening. Reuse the approved visual master and remux the existing bound audio (scripts/matt-trust-remux-persist.ts). Do NOT regenerate TTS. Then re-run media timeline QA.`,
      };
    case "media.orientation":
      return {
        forFinding: `${surface}:${kind}`,
        owningSubsystem: "quick-fix/trust-explainer",
        action: `Re-render/rebind ${subject} to the contract orientation (landscape 16:9 for trust explainers) reusing existing audio.`,
        kind: "coding-agent",
        note: `${subject} is the wrong orientation for its format contract. Rebind the landscape master; reuse existing audio.`,
      };
    case "media.noAudio":
      return {
        forFinding: `${surface}:${kind}`,
        owningSubsystem: "voice/matt-trust-store",
        action: `Rebind ${subject} to the canonical voiceover and remux audio into the render.`,
        kind: "coding-agent",
        note: `${subject} has no audio stream. Reattach the canonical Matt voiceover (reuse — do not regenerate) and remux.`,
      };
    case "presentation.trustResolves":
      return {
        forFinding: `${surface}:${kind}`,
        owningSubsystem: "quick-fix/trust-video-resolve",
        action: `Bind the canonical explainer for the scope (render the missing Matt asset via authorized single generation, or reuse the visual master).`,
        kind: "operator",
        note: `No canonical explainer resolves for ${subject}. Requires an authorized render or a visual-master rebind before the offer can be purchasable.`,
      };
    default:
      return null;
  }
}

/** Assemble the final report + verdict. PURE. */
export function assembleReleaseReport(input: ReleaseReportInput): ReleaseReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const s of input.suites) {
    if (s.status === "BLOCKED" && s.gating) {
      // A gating BLOCKED suite ALWAYS blocks — even if it did not enumerate specific
      // lines (fall back to its summary so the block can never be silently dropped).
      if (s.blockerDetails.length > 0) blockers.push(...s.blockerDetails.map((d) => `[${s.name}] ${d}`));
      else blockers.push(`[${s.name}] ${s.detail}`);
    }
    if (s.status === "WARNING") warnings.push(`[${s.name}] ${s.detail}`);
    if (s.status === "BLOCKED" && !s.gating) warnings.push(`[${s.name}] non-gating: ${s.detail}`);
  }
  const cov = input.explainerCoverage ?? null;
  if (cov && cov.affectsJourneys && (cov.missing.length > 0 || cov.broken.length > 0)) {
    blockers.push(`[explainer-coverage] ${cov.missing.length} missing + ${cov.broken.length} broken explainer(s) can affect current customer journeys (${[...cov.missing, ...cov.broken].join(", ")})`);
  } else if (cov && (cov.missing.length > 0 || cov.broken.length > 0)) {
    warnings.push(`[explainer-coverage] ${cov.missing.length} missing + ${cov.broken.length} broken explainer(s) — ${[...cov.missing, ...cov.broken].join(", ")} (do not affect current journeys)`);
  }

  const verdict: ReleaseVerdict = blockers.length === 0 ? "READY_TO_DEPLOY" : "BLOCKED";
  return {
    candidateSha: input.candidateSha,
    generatedAt: input.generatedAt,
    suites: input.suites,
    explainerCoverage: cov,
    escapedDefects: input.escapedDefects,
    repairs: input.repairs,
    blockers,
    warnings,
    verdict,
  };
}

const ICON: Record<SuiteStatus, string> = { PASS: "✓", WARNING: "⚠", BLOCKED: "✗", NOT_RUN: "·" };

/** Render the §24 operator-facing report (concise; not raw logs). */
export function renderReleaseReport(r: ReleaseReadinessReport): string {
  const L: string[] = [];
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  L.push("  BREAKBOT — RELEASE READINESS REPORT");
  L.push(`  Candidate: ${r.candidateSha ?? "(uncommitted)"}    ${r.generatedAt}`);
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const s of r.suites) {
    const gate = s.gating ? "" : "  (non-gating)";
    L.push(`  ${ICON[s.status]} ${s.name.padEnd(30)} ${s.status.padEnd(8)} ${s.detail}${gate}`);
  }
  if (r.explainerCoverage) {
    const c = r.explainerCoverage;
    L.push(`  ${c.healthy === c.total && c.missing.length === 0 && c.broken.length === 0 ? "✓" : "⚠"} ${"explainer coverage".padEnd(30)} ${`${c.healthy}/${c.total} healthy`}${c.missing.length ? `  MISSING: ${c.missing.join(", ")}` : ""}${c.broken.length ? `  BROKEN: ${c.broken.join(", ")}` : ""}`);
  }
  L.push(`  · escaped-defect regressions: ${r.escapedDefects.total} covered (${r.escapedDefects.pendingDeploy} pending-deploy)`);
  if (r.repairs.length) {
    L.push("");
    L.push("  PROPOSED BOUNDED REPAIRS (§16 — not auto-executed):");
    for (const rp of r.repairs) L.push(`    → [${rp.kind}] ${rp.action}`);
  }
  if (r.warnings.length) {
    L.push("");
    L.push("  WARNINGS:");
    for (const w of r.warnings) L.push(`    ⚠ ${w}`);
  }
  if (r.blockers.length) {
    L.push("");
    L.push("  BLOCKERS:");
    for (const b of r.blockers) L.push(`    ✗ ${b}`);
  }
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  L.push(`  VERDICT: ${r.verdict === "READY_TO_DEPLOY" ? "✓ READY TO DEPLOY" : "✗ BLOCKED — deploy held"}`);
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return L.join("\n");
}
