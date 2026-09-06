// MANDATE 22 — lift the reversible safe-hold (operator-authorized). Re-enables normal authorized scheduling.
// Verifies no scheduled binding is OVERDUE before resuming (never release an overdue burst); reports the
// binding fingerprint so we can prove nothing else changed. Sends nothing; invokes no runner.
import { createHash } from "node:crypto";
import { setOutreachPaused, outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";

async function main() {
  const before = await outreachPausedNow();
  const bindings = await listScheduledBindings();
  const nowIso = new Date().toISOString();
  const overdue = bindings.filter((b) => b.binding.scheduledAt <= nowIso);
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  if (overdue.length > 0) {
    console.log(JSON.stringify({ resumed: false, reason: "overdue bindings present — reconcile forward before resuming", overdue: overdue.length, pausedNow: before }, null, 2));
    process.exit(0);
  }
  await setOutreachPaused(false, { actor: "mandate22-resume", reason: "Scheduled workflow repaired + accepted; all 14 bindings valid; operator authorized resume" });
  const after = await outreachPausedNow();
  console.log(JSON.stringify({ resumed: true, pausedBefore: before, pausedNow: after, scheduledBindings: bindings.length, overdue: overdue.length, bindHash, at: nowIso }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
