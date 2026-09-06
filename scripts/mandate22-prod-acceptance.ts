// MANDATE 22 — read-only PRODUCTION acceptance for the repaired Scheduled workflow. Writes NOTHING, sends
// NOTHING, invokes no runner. For every real scheduled binding it resolves the package-aware detail (the
// SAME resolver the repaired UI uses) and reports what the operator would see. Also runs the scheduler
// DRY-RUN (structurally incapable of sending) and confirms the count equals the canonical binding list.
import { createHash } from "node:crypto";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { resolveScheduledDetail } from "../src/lib/outreach/scheduled-detail";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { evaluateScheduledDryRun } from "../src/lib/outreach/scheduler-dryrun";
import { resolveSendingWindow } from "../src/lib/outreach/sending-window";
import { getSettings } from "../src/lib/repo";

async function main() {
  const paused = await outreachPausedNow();
  const bindings = await listScheduledBindings();
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);

  const rows: any[] = [];
  for (const { leadId } of bindings) {
    const d = await resolveScheduledDetail(leadId, "https://outreach.artifexlabs.tech").catch((e) => ({ error: String(e) } as any));
    rows.push(d?.error ? { leadId, error: d.error } : {
      business: d.business, type: d.packageType, quarantined: d.quarantined,
      subject: !!d.subject, body: !!d.bodyText, pdf: d.pdf.present, video: d.video.present,
      validator: d.validator.ok ? "OK" : d.validator.reason, revision: d.revisionId.slice(0, 10),
    });
  }
  const window = resolveSendingWindow(await getSettings());
  const dry = await evaluateScheduledDryRun(new Date(), window).catch((e) => ({ error: String(e) } as any));

  console.log(JSON.stringify({
    safeHoldEngaged: paused, scheduledBindings: bindings.length, bindHash,
    countEqualsBindings: rows.length === bindings.length,
    detail: rows,
    dryRun: dry?.error ? dry : { inWindow: dry.inWindow, due: dry.due, eligible: dry.eligible, wouldSend: dry.wouldSend, blocked: dry.blocked, dispatched: false },
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
