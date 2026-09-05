// MANDATE 18 — STAGE 2: controlled resume. Lifts the safe-hold ONCE for the 12 verified-valid Sept-8
// bindings, confirms pausedNow:false, runs DRY-RUN diagnostics only (no runner invoked, no send), verifies
// the bindings are unchanged and nothing is due now, and AUTO-ROLLS-BACK (re-engages the safe-hold) if any
// rollback condition trips. Never calls a provider.
import { setOutreachPaused, outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { listScheduledBindings, dueScheduled, validateScheduled } from "../src/lib/outreach/scheduled-batch";
import { currentAllocation } from "../src/lib/outreach/allocation-state";

const key = (b: { binding: { scheduledAt: string; revisionId: string; batchId: string } }) => `${b.binding.scheduledAt}|${b.binding.revisionId}|${b.binding.batchId}`;

async function main() {
  const nowIso = new Date().toISOString();
  // 1) PRE-RESUME snapshot.
  const before = await listScheduledBindings();
  const beforeSet = new Set(before.map(key));
  console.log(`PRE-RESUME: ${before.length} bindings; pausedNow=${await outreachPausedNow()}`);

  // Pre-flight rollback guard — refuse to lift if anything is already overdue/invalid.
  for (const b of before) {
    if (b.binding.scheduledAt <= nowIso) { console.log(`ABORT (no resume): overdue binding ${b.leadId}`); process.exit(1); }
    const v = await validateScheduled(b.leadId, b.binding);
    if (!v.ok) { console.log(`ABORT (no resume): invalid binding ${b.leadId}: ${v.reason}`); process.exit(1); }
  }

  // 2) LIFT the safe-hold exactly once. 3) Confirm.
  await setOutreachPaused(false, { actor: "mandate18-controlled-resume", reason: "Stage-1 audit green; 12 valid Sept-8 bindings; resume for staggered windows only" });
  const pausedNow = await outreachPausedNow();
  console.log(`RESUMED: pausedNow=${pausedNow} (expect false)`);

  // 6) DRY-RUN diagnostics only — NO runner invoked. 7) Verify unchanged. 8) No acceleration/duplication.
  const due = await dueScheduled(new Date());
  const after = await listScheduledBindings();
  const afterSet = new Set(after.map(key));
  const alloc = await currentAllocation(new Date());
  const total = alloc.firstTarget + alloc.followTarget;
  const unchanged = before.length === after.length && [...beforeSet].every((k) => afterSet.has(k)) && afterSet.size === beforeSet.size;

  console.log(`POST-RESUME DIAGNOSTICS: dueNow=${due.length} (expect 0) | bindings=${after.length} | unchanged=${unchanged} | alloc[first=${alloc.firstTarget} follow=${alloc.followTarget} total=${total}] cap=${alloc.cap}`);

  // Rollback conditions (do not wait for a real send to prove failure).
  const rollback: string[] = [];
  if (pausedNow) rollback.push("safe-hold did not lift");
  if (due.length > 0) rollback.push(`${due.length} overdue/surprise dispatches`);
  if (!unchanged) rollback.push("bindings changed/accelerated/duplicated");
  if (total > 20) rollback.push(`allocation total ${total} > 20`);
  if (after.length !== 12) rollback.push(`binding count ${after.length} != 12`);

  if (rollback.length) {
    await setOutreachPaused(true, { actor: "mandate18-rollback", reason: rollback.join("; ") });
    console.log(`\n⚠️  ROLLED BACK — safe-hold RE-ENGAGED. Reasons: ${rollback.join("; ")}. pausedNow=${await outreachPausedNow()}`);
    process.exit(1);
  }

  console.log(`\n✅ CONTROLLED RESUME SUCCESSFUL — safe-hold lifted (pausedNow=false), 12 bindings intact, nothing due now, allocation ≤20. The scheduler will process the Sept-8 bindings at their staggered windows. No runner invoked; nothing sent.`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(2); });
