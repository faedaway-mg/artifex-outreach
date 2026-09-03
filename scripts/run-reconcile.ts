// Apply the past-due scheduled reconciler against prod (reschedules forward / terminates; never sends).
import { reconcileScheduledBindings } from "../src/lib/outreach/scheduled-batch";
async function main() {
  const dry = process.argv.includes("--dry");
  const r = await reconcileScheduledBindings({ now: new Date(), apply: !dry });
  console.log(JSON.stringify({ mode: dry ? "DRY" : "APPLY", pastDue: r.pastDue, rescheduled: r.rescheduled.length, terminated: r.terminated.length, alreadySent: r.alreadySent.length }, null, 0));
  for (const x of r.rescheduled) console.log("  RESCHEDULED", x.leadId, x.from, "→", x.to);
  for (const x of r.terminated) console.log("  TERMINATED ", x.leadId, "|", x.reason);
  for (const x of r.alreadySent) console.log("  ALREADY-SENT", x.leadId, "|", x.providerId);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
