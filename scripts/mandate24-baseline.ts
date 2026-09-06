// MANDATE 24 — read-only production fingerprint (Needs Attention + Morris scope). Writes NOTHING.
import { createHash } from "node:crypto";
import { listLeads, allEmailSends, listAudit } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { PROSPECT_PACKAGE_ACTION } from "../src/lib/outreach/prospect-package-store";
import { REVIEW_APPROVED_ACTION } from "../src/lib/outreach/review-approval";
import { MANUAL_FOLLOWUP_FLAG_ACTION } from "../src/lib/outreach/attention-status";

async function main() {
  const [leads, sends, bindings, audit, snap, paused] = await Promise.all([
    listLeads(), allEmailSends(), listScheduledBindings(), listAudit(20000), buildCompanySnapshot(), outreachPausedNow(),
  ]);
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  const flags = audit.filter((a) => a.action === MANUAL_FOLLOWUP_FLAG_ACTION);
  const fp = {
    leads: leads.length, sends: sends.length, receipts: sends.filter((e) => !!e.sentAt).length,
    bindings: bindings.length, bindHash,
    packages: audit.filter((a) => a.action === PROSPECT_PACKAGE_ACTION).length,
    approvals: audit.filter((a) => a.action === REVIEW_APPROVED_ACTION).length,
    rejects: audit.filter((a) => a.action === "lead.rejected").length,
    followUpFlags: flags.length,
    followUpFlaggedLeads: flags.map((f) => ({ leadId: f.targetId, business: (f.meta as any)?.business ?? null })),
    needsAttentionCount: snap.counts.needsAttention,
    needsAttention: snap.needsAttention.map((r) => ({ leadId: r.leadId, business: r.business, reason: r.failReason ?? null })),
    readyCount: snap.counts.readyToSchedule,
    paused,
  };
  console.log(JSON.stringify(fp, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
