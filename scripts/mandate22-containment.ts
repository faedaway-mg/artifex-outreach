// MANDATE 22 — PHASE 0 CONTAINMENT. Engage the reversible DB safe-hold ONCE so neither the first-touch
// outreach runner nor the follow-up send runner can dispatch while the Scheduled queue is audited/repaired.
// Reversible via setOutreachPaused(false). Sends nothing, invokes no runner, mutates only the pause flag.
// Also reports the current scheduled-binding fingerprint so we can prove production data is preserved.
import { createHash } from "node:crypto";
import { setOutreachPaused, outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { listLeads, allEmailSends } from "../src/lib/repo";

async function main() {
  const before = await outreachPausedNow();
  await setOutreachPaused(true, { actor: "mandate22-containment", reason: "Scheduled-queue truth audit: 14-vs-12 count, package-type-blind detail, broken nav — hold all dispatch" });
  const after = await outreachPausedNow();
  const bindings = await listScheduledBindings();
  const [leads, sends] = await Promise.all([listLeads(), allEmailSends()]);
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  console.log(JSON.stringify({
    pausedBefore: before, pausedNow: after,
    scheduledBindings: bindings.length, bindHash,
    leads: leads.length, sends: sends.length,
    at: new Date().toISOString(),
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
