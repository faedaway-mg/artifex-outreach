// PHASE 0 — engage the repository's REVERSIBLE safe-hold (mandate 16). Pauses ALL outbound (both the
// first-touch outreach runner and the follow-up send runner honor outreachPausedNow) so nothing can
// dispatch while packages are audited. Reversible via setOutreachPaused(false). Sends nothing.
import { setOutreachPaused, outreachPausedNow } from "../src/lib/outreach/outreach-pause";

async function main() {
  const before = await outreachPausedNow();
  await setOutreachPaused(true, { actor: "mandate16-preflight", reason: "fail-closed audit of READY/APPROVED/SCHEDULED packages + Sept-7 holiday review" });
  const after = await outreachPausedNow();
  console.log(JSON.stringify({ pausedBefore: before, pausedNow: after, at: new Date().toISOString() }));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
