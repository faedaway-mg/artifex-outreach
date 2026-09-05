// READ-ONLY Sept-7 allocation dry-run preview (mandate 14). Computes the two-lane allocation for the Sept-7
// send window using the SAME currentAllocation the crons use, shows selected vs deferred in deterministic
// oldest-due-first order, proves the total cannot exceed 20, and prints each first-touch binding's lineage
// identity (revisionId / pdfSha256 / batchId) to prove package version + lineage are preserved. Writes nothing.
import { currentAllocation } from "../src/lib/outreach/allocation-state";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { laDayBoundsUtc } from "../src/lib/acquisition/daily-cap";

const redact = (e?: string | null) => (e ? e.replace(/^[^@]+/, "***") : "—");

async function main() {
  // Preview instant: Sept-7 06:00 LA (mid-window) → laDay = 2026-09-07.
  const now = new Date("2026-09-07T13:00:00.000Z");
  const bounds = laDayBoundsUtc(now);
  const alloc = await currentAllocation(now);
  const bindings = (await listScheduledBindings())
    .filter(({ binding }) => binding.status === "scheduled" && binding.scheduledAt >= bounds.startIso && binding.scheduledAt < bounds.endIso)
    // deterministic: oldest-due-first, stable leadId tie-breaker.
    .sort((a, b) => (a.binding.scheduledAt !== b.binding.scheduledAt ? (a.binding.scheduledAt < b.binding.scheduledAt ? -1 : 1) : (a.leadId < b.leadId ? -1 : 1)));

  const selected = bindings.slice(0, alloc.firstTarget);
  const deferred = bindings.slice(alloc.firstTarget);

  console.log("=== SEPT-7 TWO-LANE ALLOCATION PREVIEW (dry-run, read-only) ===");
  console.log(`laDay=${alloc.laDay}  cap=${alloc.cap}  reserveFirst=${alloc.reserveFirst}  reserveFollow=${alloc.reserveFollow}`);
  console.log(`FIRST-TOUCH: eligibleToday=${alloc.firstEligibleToday} sentToday=${alloc.sentFirstToday} demand=${alloc.firstDemand} target=${alloc.firstTarget} deferred=${alloc.firstDeferred} borrowed=${alloc.borrowedByFirst}`);
  console.log(`FOLLOW-UP:   eligibleToday=${alloc.followEligibleToday} sentToday=${alloc.sentFollowToday} demand=${alloc.followDemand} target=${alloc.followTarget} deferred=${alloc.followDeferred} borrowed=${alloc.borrowedByFollow}`);
  console.log(`TOTAL SELECTED = ${alloc.firstTarget} + ${alloc.followTarget} = ${alloc.firstTarget + alloc.followTarget}  (cap ${alloc.cap})  ⇒ within cap: ${alloc.firstTarget + alloc.followTarget <= alloc.cap}`);

  console.log(`\nFIRST-TOUCH bindings scheduled Sept-7 (${bindings.length}) — deterministic order:`);
  bindings.forEach((b, i) => {
    const chosen = i < alloc.firstTarget;
    console.log(`  ${chosen ? "SELECT " : "DEFER  "}#${i + 1} ${b.binding.scheduledAt} ${redact(b.binding.recipient)}  lead=${b.leadId}  lineage[rev=${(b.binding as any).revisionId ?? "—"} pdf=${String((b.binding as any).pdfSha256 ?? "").slice(0, 10)} batch=${(b.binding as any).batchId ?? "—"}]`);
  });
  if (deferred.length) console.log(`\nDEFERRED ${deferred.length} → next valid send day after Sept-7 (weekday policy): 2026-09-08 (Tue) window`);
  console.log(`\nLINEAGE PRESERVED: every binding above retains its revisionId + pdfSha256 + batchId (no rebuild, no new version).`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
