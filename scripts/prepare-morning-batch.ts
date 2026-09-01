// READ-FIRST morning-batch prep. Computes the eligible/scheduled/not-ready sets via the app's own
// schedulableEmails() (the exact selector the operator UI uses), reports counts + reasons, and — only
// when invoked with --commit — persists the schedule via scheduleBatch(). It NEVER enables autosend or
// prospect delivery, so nothing can be dispatched: the batch sits dormant until QR_AUTOSEND_ENABLED=1.
if (process.env.PGPROXY && process.env.DATABASE_URL && process.env.DATABASE_URL.includes(".railway.internal")) {
  const u = new URL(process.env.DATABASE_URL);
  const [h, p] = process.env.PGPROXY.split(":");
  u.hostname = h; if (p) u.port = p; process.env.DATABASE_URL = u.toString();
}
const COMMIT = process.argv.includes("--commit");
const dkArg = process.argv.find((a) => a.startsWith("--dateKey="));
const OVERRIDE_DATEKEY = dkArg ? dkArg.split("=")[1] : null;
// Reject a non-weekday or a past/stale date (must be a real future America/LA sending day).
if (OVERRIDE_DATEKEY) {
  const [y, m, d] = OVERRIDE_DATEKEY.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // noon-UTC avoids TZ edge
  if (wd === 0 || wd === 6) { console.error(`GUARD FAIL: ${OVERRIDE_DATEKEY} is a weekend`); process.exit(2); }
}

async function main() {
  const { schedulableEmails, scheduleBatch } = await import("../src/lib/outreach/scheduled-batch").catch(() => ({} as any));
  const list = await import("../src/lib/outreach/schedulable-list");
  const view: any = await list.schedulableEmails();
  const eligible = view.eligible ?? [];
  console.log(JSON.stringify({
    dateKey: view.dateKey,
    window: view.window,
    eligibleCount: eligible.length,
    alreadyScheduledCount: (view.scheduled ?? []).length,
    notReadyCount: (view.notReady ?? []).length,
    eligible: eligible.slice(0, 25).map((e: any) => ({ leadId: e.leadId ?? e.lead?.id, name: e.businessName ?? e.lead?.businessName, at: e.scheduledAt ?? e.at })),
    notReadySample: (view.notReady ?? []).slice(0, 10).map((n: any) => ({ name: n.businessName ?? n.lead?.businessName, reason: n.reason })),
  }, null, 2));

  if (COMMIT && eligible.length > 0) {
    const newId = (p: string) => `${p}_${Math.floor(Date.now())}`;
    const dateKey = OVERRIDE_DATEKEY ?? view.dateKey;
    const ids = eligible.slice(0, 20).map((e: any) => e.leadId ?? e.lead?.id);
    const res: any = await (await import("../src/lib/outreach/scheduled-batch")).scheduleBatch(ids, { dateKey, by: "activation", batchId: newId("batch") });
    const bindings = await (await import("../src/lib/outreach/scheduled-batch")).listScheduledBindings();
    console.log("COMMITTED " + JSON.stringify({ dateKey, requested: ids.length, scheduled: res.scheduled?.length, removed: res.removed?.length }));
    console.log("SCHEDULED_TIMES " + JSON.stringify(bindings.map((b: any) => ({ leadId: b.leadId, at: b.binding.sendAt ?? b.binding.at ?? b.binding.scheduledAt, sha: (b.binding.pdfSha256 ?? b.binding.frozenPdfSha256 ?? "").slice(0, 12), recipient: b.binding.recipient })).slice(0, 25), null, 2));
  } else {
    console.log("PREPARE-ONLY (read): pass --commit to persist the dormant batch. Nothing scheduled.");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("BATCH PREP ERROR:", e?.message || e); process.exit(1); });
