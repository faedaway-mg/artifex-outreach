// MANDATE 23 — read-only production fingerprint (media/studio scope). Records binding hash, package count,
// render-job count, verified-video count, sends, receipts BEFORE and AFTER so we can prove production was
// never mutated. Writes NOTHING; invokes no runner.
import { createHash } from "node:crypto";
import { listLeads, allEmailSends, listAudit } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { listJobs } from "../src/lib/content-studio/store";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { PROSPECT_PACKAGE_ACTION } from "../src/lib/outreach/prospect-package-store";
import { REVIEW_APPROVED_ACTION } from "../src/lib/outreach/review-approval";
import { SEND_RECEIPT_ACTION } from "../src/lib/comms/receipt";

async function main() {
  const [leads, sends, bindings, audit, jobs, paused] = await Promise.all([
    listLeads(), allEmailSends(), listScheduledBindings(), listAudit(20000), listJobs(), outreachPausedNow(),
  ]);
  const bindHash = createHash("sha256").update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  const fp = {
    leads: leads.length,
    sends: sends.length,
    receipts: sends.filter((e) => !!e.sentAt).length,
    sendReceiptAudits: audit.filter((a) => a.action === SEND_RECEIPT_ACTION).length,
    bindings: bindings.length,
    bindHash,
    packages: audit.filter((a) => a.action === PROSPECT_PACKAGE_ACTION).length,
    approvals: audit.filter((a) => a.action === REVIEW_APPROVED_ACTION).length,
    rejects: audit.filter((a) => a.action === "lead.rejected").length,
    renderJobs: jobs.length,
    renderJobsReady: jobs.filter((j) => !!(j as any).outputKey).length,
    renderJobsFailed: jobs.filter((j) => (j as any).status === "failed").length,
    breakbotInProd: leads.filter((l) => /breakbot/i.test(l.source ?? "") || /@example\.invalid$/i.test(l.publicEmail ?? "")).length,
    paused,
  };
  console.log(JSON.stringify(fp, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
