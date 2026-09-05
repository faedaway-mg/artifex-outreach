// Mandate 16 — move the valid Sept-7 (Labor Day) bindings to the next business day (Sept-8), quarantine any
// invalid ones, and verify Silver's test-content package is fail-closed at dispatch. Dry-run first, then
// apply. Preserves lineage; creates no duplicates; consumes no slots; sends nothing.
import { rescheduleHolidayBindings, listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { resolvePackageForSendById } from "../src/lib/outreach/prospect-package-store";

async function main() {
  const dry = await rescheduleHolidayBindings({ apply: false });
  console.log("DRY-RUN:", JSON.stringify({ examined: dry.examined, wouldMove: dry.moved.length, wouldQuarantine: dry.quarantined.length }));
  const res = await rescheduleHolidayBindings({ apply: true });
  console.log("APPLIED:", JSON.stringify({ examined: res.examined, moved: res.moved.length, quarantined: res.quarantined.length }));
  for (const m of res.moved) console.log(`  moved ${m.leadId}: ${m.from} → ${m.to}`);
  for (const q of res.quarantined) console.log(`  quarantined ${q.leadId}: ${q.reason}`);

  // Confirm no binding remains on a holiday.
  const after = await listScheduledBindings();
  const stillSep7 = after.filter((b) => b.binding.scheduledAt >= "2026-09-07T00:00:00Z" && b.binding.scheduledAt < "2026-09-08T00:00:00Z");
  const nowSep8 = after.filter((b) => b.binding.scheduledAt >= "2026-09-08T00:00:00Z" && b.binding.scheduledAt < "2026-09-09T00:00:00Z");
  console.log(`\nAFTER: bindings still on Sept-7 = ${stillSep7.length}; bindings now on Sept-8 = ${nowSep8.length}; total = ${after.length}`);

  // Silver containment: its FROZEN test-content package must fail-closed at dispatch.
  const silver = await resolvePackageForSendById("lead_nDZRd3_Gcw");
  console.log("\nSILVER (lead_nDZRd3_Gcw) dispatch check:", JSON.stringify({ ok: silver.ok, reason: silver.reason }));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
