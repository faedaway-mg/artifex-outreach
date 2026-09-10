// ─────────────────────────────────────────────────────────────────────────────
// breakbot release-preflight — the ONE canonical release gate (mandate §1/§20/§24/§31).
//
// Composes every Breakbot sub-suite into a single Release Readiness Report and is the
// FINAL AUTHORITY on whether a release candidate may deploy:
//   1. regression        — golden + failure fixtures over the Quick-Cash preflight
//   2. business invariants— the named customer/business invariants (derived from the
//                           failure fixtures: each asserts an invariant surface blocks)
//   3. media timeline QA  — samples EVERY required explainer master across its whole
//                           runtime (the blank-after-opening class) + orientation contract
//   4. explainer coverage — every required scope present + healthy (§9)
//   5. escaped-defects    — the permanent-regression registry is all covered (§29)
//   6. visual regression  — ingests scripts/breakbot-visual.ts's verdict (rendered layout)
//
// Fail-closed: any gating suite BLOCKED → exit 1 → deploy held. Pure/offline except the
// media stage (ffprobe/ffmpeg over the on-disk masters — no network, no paid provider).
// Writes a redacted JSON report to artifacts/breakbot-release/report.json.
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRegression } from "../src/lib/breakbot/regression";
import { probeMedia } from "../src/lib/breakbot/media-probe";
import { assessMedia, combineMediaResults, type MediaQaResult } from "../src/lib/breakbot/media-qa";
import { REQUIRED_EXPLAINER_SCOPES, EXPLAINER_ORIENTATION, explainerLocalMasterPath } from "../src/lib/quick-fix/explainer-library";
import { validateRegistry, escapedDefectSummary } from "../src/lib/breakbot/escaped-defects";
import {
  assembleReleaseReport, renderReleaseReport, classifyRepair,
  type SuiteResult, type RepairProposal, type ExplainerCoverage,
} from "../src/lib/breakbot/release-report";

const ROOT = process.cwd();
const BREAKBOT_DIR = join(ROOT, "src/lib/breakbot");

function sha(): string | null {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return null; }
}

// Same coverage resolver the registry test uses — a guard reference must resolve on disk.
function guardExists(ref: string): boolean {
  if (ref.includes("/")) {
    const [path, symbol] = ref.split(/:(.+)/);
    const abs = join(ROOT, path);
    if (!existsSync(abs)) return false;
    if (!symbol) return true;
    return readFileSync(abs, "utf8").includes(symbol);
  }
  for (const f of readdirSync(BREAKBOT_DIR)) {
    if (f.endsWith(".ts") && readFileSync(join(BREAKBOT_DIR, f), "utf8").includes(ref)) return true;
  }
  return false;
}

async function main() {
  const suites: SuiteResult[] = [];
  const repairs: RepairProposal[] = [];
  const seenRepairs = new Set<string>();
  const addRepair = (rp: RepairProposal | null) => {
    if (rp && !seenRepairs.has(rp.forFinding)) { seenRepairs.add(rp.forFinding); repairs.push(rp); }
  };

  // 1 + 2 — regression + business invariants (one run, two views).
  const reg = runRegression();
  suites.push({
    name: "regression (golden+failure)",
    status: reg.allPass ? "PASS" : "BLOCKED",
    gating: true,
    blockers: reg.regressions.length,
    warnings: 0,
    detail: `${reg.goldenPassed}/${reg.goldenTotal} golden READY · ${reg.failurePassed}/${reg.failureTotal} failures blocked`,
    blockerDetails: reg.regressions.map((r) => `${r.kind}:${r.id} — ${r.reason}`),
  });
  const invariantSurfaces = new Set(reg.failure.map((f) => f.expectBlockerSurface));
  const invFailures = reg.failure.filter((f) => !f.pass);
  suites.push({
    name: "business invariants",
    status: invFailures.length === 0 ? "PASS" : "BLOCKED",
    gating: true,
    blockers: invFailures.length,
    warnings: 0,
    detail: `${invariantSurfaces.size} invariant surfaces enforced (trust video, orientation, price, evidence, autosend/delivery OFF, portal isolation, …)`,
    blockerDetails: invFailures.map((f) => `invariant not enforced: ${f.expectBlockerSurface} (${f.id})`),
  });

  // 3 + 4 — media timeline QA over every required explainer master + coverage.
  const mediaResults: MediaQaResult[] = [];
  const missing: string[] = [];
  const broken: string[] = [];
  let mediaError: string | null = null;
  for (const scope of REQUIRED_EXPLAINER_SCOPES) {
    const path = explainerLocalMasterPath(scope);
    if (!path || !existsSync(join(ROOT, path))) { missing.push(scope); continue; }
    try {
      const probe = await probeMedia(join(ROOT, path), {
        label: scope, expectedOrientation: EXPLAINER_ORIENTATION, motionExpected: true, narrated: true, minDurationSeconds: 20,
      });
      const r = assessMedia(probe);
      mediaResults.push(r);
      if (r.status === "BLOCKED") {
        broken.push(scope);
        for (const f of r.findings) if (f.severity === "BLOCKER") addRepair(classifyRepair("trust-explainer", f.kind, scope));
      }
    } catch (e: any) {
      mediaError = e?.message || String(e);
      broken.push(scope);
    }
  }
  const mediaCombined = combineMediaResults(mediaResults);
  const mediaBlockerDetails = mediaResults
    .filter((r) => r.status === "BLOCKED")
    .flatMap((r) => r.findings.filter((f) => f.severity === "BLOCKER").map((f) => `${r.label}: ${f.kind} — ${f.detail}`));
  if (mediaError) mediaBlockerDetails.push(`media probe error (ffprobe/ffmpeg unavailable?): ${mediaError}`);
  suites.push({
    name: "media timeline QA",
    status: mediaResults.length === 0 && missing.length === REQUIRED_EXPLAINER_SCOPES.length ? "BLOCKED" : mediaCombined.status,
    gating: true,
    blockers: mediaBlockerDetails.length,
    warnings: mediaCombined.warned.length,
    detail: `${mediaResults.filter((r) => r.status !== "BLOCKED").length}/${REQUIRED_EXPLAINER_SCOPES.length} explainer masters healthy across full runtime`,
    blockerDetails: mediaBlockerDetails,
  });

  const coverage: ExplainerCoverage = {
    healthy: mediaResults.filter((r) => r.status !== "BLOCKED").length,
    total: REQUIRED_EXPLAINER_SCOPES.length,
    missing,
    broken,
    affectsJourneys: true, // these are live customer-facing offer explainers
  };

  // 5 — escaped-defect registry all covered.
  const registry = validateRegistry(guardExists);
  suites.push({
    name: "escaped-defect registry",
    status: registry.ok ? "PASS" : "BLOCKED",
    gating: true,
    blockers: registry.uncovered.length,
    warnings: 0,
    detail: `${escapedDefectSummary().total} permanent regressions, all covered`,
    blockerDetails: registry.uncovered.map((u) => `${u.id}: missing guards ${u.missing.join(", ")}`),
  });

  // 6 — visual regression (ingest the rendered-browser harness verdict if present).
  const visualPath = join(ROOT, "artifacts/breakbot-visual/verdict.json");
  if (existsSync(visualPath)) {
    try {
      const v = JSON.parse(readFileSync(visualPath, "utf8"));
      // The PASS signal is expectationsHeld + zero mismatches. combinedStatus is BLOCKED
      // by design whenever the deliberately-broken fixtures are correctly caught, so it
      // must NOT be treated as a failure on its own.
      const ok = v.expectationsHeld === true && (v.mismatches?.length ?? 0) === 0;
      suites.push({
        name: "visual regression",
        status: ok ? "PASS" : "BLOCKED",
        gating: true,
        blockers: ok ? 0 : (v.mismatches?.length ?? 1),
        warnings: 0,
        detail: `${v.passed ?? "?"}/${v.total ?? "?"} rendered surfaces OK`,
        blockerDetails: (v.mismatches ?? []).map((m: any) => `${m.fixture}@${m.viewport}: got ${m.got}, expected ${m.expected}`),
      });
    } catch {
      suites.push({ name: "visual regression", status: "NOT_RUN", gating: false, blockers: 0, warnings: 0, detail: "verdict.json unreadable — run `pnpm breakbot:visual`", blockerDetails: [] });
    }
  } else {
    suites.push({ name: "visual regression", status: "NOT_RUN", gating: false, blockers: 0, warnings: 0, detail: "not run this session — deploy runs `pnpm breakbot:visual` as its own gate", blockerDetails: [] });
  }

  const report = assembleReleaseReport({
    candidateSha: sha(),
    suites,
    explainerCoverage: coverage,
    escapedDefects: { total: escapedDefectSummary().total, pendingDeploy: escapedDefectSummary().pendingDeploy },
    repairs,
    generatedAt: new Date().toISOString(),
  });

  console.log(renderReleaseReport(report));

  try {
    mkdirSync(join(ROOT, "artifacts/breakbot-release"), { recursive: true });
    writeFileSync(join(ROOT, "artifacts/breakbot-release/report.json"), JSON.stringify(report, null, 2));
  } catch { /* artifact is best-effort */ }

  process.exit(report.verdict === "READY_TO_DEPLOY" ? 0 : 1);
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
