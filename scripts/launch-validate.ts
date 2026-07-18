/**
 * Launch Validation command (Phase 3).
 *
 *   pnpm launch:validate                 in-process validation of every subsystem
 *   pnpm launch:validate --toolchain     also run typecheck + lint + test
 *   pnpm launch:validate --build         also run the production build
 *   pnpm launch:validate --confirm       treat the manual-review sign-off as given
 *
 * Prints PASS / WARNING / FAIL for every subsystem, the blocking issues, the
 * warnings with recommended fixes, and one overall launch recommendation. Exits
 * non-zero when the recommendation is NOT READY so it can gate a deploy.
 */
import "./loadEnv";
import { execSync } from "node:child_process";
import { runValidation } from "../src/lib/launch/validation";
import { launchConfidence, type ToolchainResult } from "../src/lib/launch/confidence";
import { STATUS_LABEL, type CheckStatus } from "../src/lib/launch/types";

const args = new Set(process.argv.slice(2));
const mark = (s: CheckStatus) => (s === "pass" ? "✓ PASS" : s === "warn" ? "! WARN" : "✗ FAIL");
const hr = () => console.log("─".repeat(72));

function runTool(label: string, cmd: string): ToolchainResult {
  process.stdout.write(`  running ${label}… `);
  try {
    execSync(cmd, { cwd: process.cwd(), stdio: "pipe" });
    console.log("PASS");
    return { label, status: "pass", detail: `${cmd} succeeded.` };
  } catch (err: any) {
    console.log("FAIL");
    const out = `${err?.stdout ?? ""}${err?.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | ");
    return { label, status: "fail", detail: `${cmd} failed: ${out.slice(0, 240)}` };
  }
}

async function main() {
  const confirm = args.has("--confirm") || process.env.LAUNCH_MANUAL_REVIEW_CONFIRMED === "1";
  console.log("\nArtifex Outreach — Launch Validation");
  console.log(new Date().toISOString());
  hr();

  const validation = await runValidation({ manualReviewConfirmed: confirm });

  for (const c of validation.categories) {
    console.log(`\n${mark(c.status)}  ${c.name}`);
    for (const chk of c.checks) {
      console.log(`    ${mark(chk.status)}  ${chk.label} — ${chk.detail}`);
      if (chk.fix && chk.status !== "pass") console.log(`           ↳ fix: ${chk.fix}`);
    }
  }

  // Optional toolchain.
  const toolchain: ToolchainResult[] = [];
  if (args.has("--toolchain") || args.has("--build")) {
    console.log("\nToolchain:");
    toolchain.push(runTool("typecheck", "pnpm -s typecheck"));
    toolchain.push(runTool("lint", "pnpm -s lint"));
    toolchain.push(runTool("test", "pnpm -s test"));
    if (args.has("--build")) toolchain.push(runTool("build", "pnpm -s build"));
  }

  const confidence = await launchConfidence({ validation, toolchain });

  hr();
  console.log("\nConfidence by dimension:");
  for (const c of confidence.categories) {
    console.log(`   ${c.score == null ? " n/a" : String(c.score).padStart(3)}  ${mark(c.status)}  ${c.name} — ${c.rationale}`);
  }

  hr();
  console.log(`\nSummary: ${validation.rollup.pass} pass · ${validation.rollup.warn} warn · ${validation.rollup.fail} fail`);
  console.log(`Overall confidence score: ${confidence.overallScore}/100`);
  if (confidence.blockingIssues.length) {
    console.log(`\nBlocking issues (${confidence.blockingIssues.length}):`);
    for (const b of confidence.blockingIssues) console.log(`   ${STATUS_LABEL[b.status]}  ${b.label} — ${b.detail}`);
  }
  if (validation.warnings.length) {
    console.log(`\nWarnings (${validation.warnings.length}):`);
    for (const w of validation.warnings.slice(0, 20)) console.log(`   WARN  ${w.label} — ${w.detail}`);
  }

  hr();
  const rec = confidence.recommendation;
  console.log(`\n  ${rec === "READY TO LAUNCH" ? "🟢" : "🔴"}  ${rec}\n`);
  process.exit(rec === "NOT READY" ? 1 : 0);
}

main().catch((e) => {
  console.error("launch-validate failed:", e);
  process.exit(2);
});
