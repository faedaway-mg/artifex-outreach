#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// LUCAS/MATT HISTORICAL JOURNEY CLASSIFICATION AUDIT — launch-readiness ops tool.
//
// DEFAULT = DRY-RUN. It gathers READ-ONLY evidence for every historical lead and
// prints the classifyPortfolio report as pretty JSON (inspected / confirmedLucas /
// confirmedMatt / ambiguous / unchanged + per-lead rows). It writes NOTHING.
//
// With an explicit --apply flag it applies ONLY deterministic classifications (the
// willApply rows) via setLeadVoiceKey(leadId, key, "lucas-classification"), leaving
// every ambiguous ("needs operator confirmation") lead untouched, and prints what it
// changed plus a summary { applied, skippedAmbiguous, unchanged }.
//
// SAFETY: send/charge credentials are stripped at the top (fail-closed) so this can
// NEVER dispatch or charge. It makes NO ElevenLabs calls and regenerates NO media —
// applying a classification only sets a lead's canonical voice key (an explicit,
// audited operator action that never mutates a historical asset).
//
//   Dry-run:  pnpm -s tsx scripts/lucas-classification-audit.ts
//   Apply:    pnpm -s tsx scripts/lucas-classification-audit.ts --apply
// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: strip any send/charge credentials so this can NEVER dispatch/charge.
for (const k of ["RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_QUICKFIX_SECRET_KEY", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY", "ELEVENLABS_API_KEY"]) delete process.env[k];

import { gatherLeadVoiceEvidence } from "../src/lib/voice/lucas-classification-evidence";
import { classifyPortfolio, voiceKeyForClassification } from "../src/lib/voice/lucas-classification";
import { setLeadVoiceKey } from "../src/lib/voice/store";
import { voiceDisplayName } from "../src/lib/voice/registry";

const APPLY = process.argv.includes("--apply");
const ACTOR = "lucas-classification";

async function main(): Promise<void> {
  const evidence = await gatherLeadVoiceEvidence();
  const report = classifyPortfolio(evidence);

  if (!APPLY) {
    // DRY-RUN: print the full report as pretty JSON. Writes nothing.
    console.log(JSON.stringify({ mode: "dry-run", writesPerformed: 0, ...report }, null, 2));
    process.exit(0);
  }

  // APPLY: only the deterministic willApply rows are set; ambiguous leads are untouched.
  const toApply = report.rows.filter((r) => r.willApply);
  const ambiguous = report.rows.filter((r) => !r.deterministic);

  const applied: Array<{ leadId: string; classification: string; voiceKey: string; voice: string; from: string | null }> = [];
  for (const row of toApply) {
    const key = voiceKeyForClassification(row.classification);
    if (!key) continue; // never applies a non-deterministic classification
    await setLeadVoiceKey(row.leadId, key, ACTOR);
    applied.push({ leadId: row.leadId, classification: row.classification, voiceKey: key, voice: voiceDisplayName(key), from: row.currentAssignment });
  }

  const summary = {
    mode: "apply",
    applied: applied.length,
    skippedAmbiguous: ambiguous.length,
    unchanged: report.unchanged,
    inspected: report.inspected,
    changes: applied,
    needsOperatorConfirmation: ambiguous.map((r) => ({ leadId: r.leadId, reason: r.reason })),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("lucas-classification-audit failed:", (e as Error).message);
  process.exit(1);
});
