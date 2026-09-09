// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT RE-CHECK (Mandate Parts N/O/AB) — read-only adversarial re-verdict.
//
// After regenerating stale offer scope copy, re-run the read-only Breakbot pre-flight
// over the affected offers to confirm they now report READY (0 blockers) — in
// particular that the customerLanguage blocker is gone. This performs NO sends, NO
// charges, NO writes: it only READS each stored offer and runs breakbotVerdictView.
//
// FAIL-CLOSED: every outbound/charge credential is DELETED from process.env at the
// very top, BEFORE any project module is imported, so even an accidental send/charge
// code path has no key to use.
//
// USAGE:
//   railway run pnpm tsx scripts/breakbot-recheck.ts <offerId> [<offerId> ...]
//
// `railway run` injects the read-only service env WITHOUT printing secrets. This
// script strips the send/charge keys regardless.
// ─────────────────────────────────────────────────────────────────────────────

// ── FAIL-CLOSED: strip every send/charge credential BEFORE importing anything. ──
for (const key of Object.keys(process.env)) {
  if (
    key === "RESEND_API_KEY" ||
    key.startsWith("STRIPE_") ||
    key.startsWith("TWILIO_")
  ) {
    delete process.env[key];
  }
}

import "./loadEnv";
import { breakbotVerdictView } from "../src/lib/quick-fix/operator-views";

function usage(): void {
  console.log("Usage: railway run pnpm tsx scripts/breakbot-recheck.ts <offerId> [<offerId> ...]");
  console.log("  Read-only. Prints READY/BLOCKED + blocker surfaces for each offer. No sends, no charges.");
}

async function main() {
  const offerIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (offerIds.length === 0) {
    usage();
    return;
  }

  console.log(`\n=== BREAKBOT RE-CHECK (read-only, fail-closed) — ${offerIds.length} offer(s) ===\n`);

  let ready = 0;
  let blocked = 0;
  let missing = 0;

  for (const offerId of offerIds) {
    const verdict = await breakbotVerdictView(offerId);
    if (!verdict) {
      missing += 1;
      console.log(`— ${offerId}: NOT FOUND (no stored offer)\n`);
      continue;
    }

    const blockerSurfaces = verdict.issues
      .filter((i) => i.severity === "BLOCKER")
      .map((i) => i.surface);

    if (verdict.overall === "READY") {
      ready += 1;
      console.log(`— ${offerId}: READY ✅  (blockers=${verdict.counts.blockers}, warnings=${verdict.counts.warnings}, passed=${verdict.counts.passed})\n`);
    } else {
      blocked += 1;
      console.log(`— ${offerId}: BLOCKED ❌  (blockers=${verdict.counts.blockers}, warnings=${verdict.counts.warnings}, passed=${verdict.counts.passed})`);
      console.log(`  blocker surfaces: ${blockerSurfaces.join(", ") || "(none named)"}`);
      for (const i of verdict.issues.filter((x) => x.severity === "BLOCKER")) {
        console.log(`    · [${i.surface}] expected: ${i.expected}`);
        console.log(`      observed: ${i.observed}`);
        console.log(`      fix: ${i.fix}`);
      }
      console.log("");
    }
  }

  console.log("=== SUMMARY ===");
  console.log(`READY: ${ready} · BLOCKED: ${blocked} · NOT FOUND: ${missing}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack || e);
    process.exit(1);
  });
