// MANDATE 24 A9 — Morris production preparation. Read-only eligibility audit for Morris + Robert Hall, then
// (only when --prepare and Morris is genuinely eligible) prepare EXACTLY ONE VIDEO_FOLLOW_UP → READY_TO_APPROVE.
// Never approves/schedules/sends. Robert Hall is audited read-only only. Reports the 14-binding hash unchanged.
import { createHash } from "node:crypto";
import { getLead, allEmailSends, listAudit, isSuppressed } from "../src/lib/repo";
import { isRejectedLead } from "../src/lib/outreach/rejection-core";
import { resolveCurrentVideo } from "../src/lib/outreach/prospect-package-store";
import { findPriorSendReceipt, wasVideoDelivered, prepareVideoFollowUp } from "../src/lib/outreach/video-follow-up";
import { MANUAL_FOLLOWUP_FLAG_ACTION } from "../src/lib/outreach/attention-status";
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";

const MORRIS = "lead_0AFG2WrbeU";
const ROBERT = "lead_V1lTr7BOZE";

async function audit(leadId: string) {
  const lead = await getLead(leadId);
  if (!lead) return { leadId, exists: false };
  const audit = await listAudit(20000);
  const flagged = audit.some((a) => a.action === MANUAL_FOLLOWUP_FLAG_ACTION && a.targetId === leadId);
  const prior = await findPriorSendReceipt(leadId);
  const cur = await resolveCurrentVideo(leadId);
  const delivered = await wasVideoDelivered(leadId, cur.inputVersion);
  const rejected = isRejectedLead(lead);
  const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
  const eligible = !!prior && cur.available && !delivered && !rejected && !suppressed && flagged;
  return { leadId, business: lead.businessName, genuineFlag: flagged, priorReceiptId: prior?.receiptId ?? null, priorSentAt: prior?.sentAt ?? null, videoAvailable: cur.available, videoInputVersion: cur.inputVersion, alreadyDelivered: delivered, rejected, suppressed, eligible };
}

async function main() {
  const doPrepare = process.argv.includes("--prepare");
  const bindHashOf = async () => createHash("sha256").update((await listScheduledBindings()).map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n")).digest("hex").slice(0, 16);
  const bindHashBefore = await bindHashOf();

  const morris = await audit(MORRIS);
  const robert = await audit(ROBERT);
  const out: any = { mode: doPrepare ? "prepare-morris" : "read-only", bindHashBefore, morris, robertHall: robert };

  if (doPrepare && (morris as any).eligible) {
    const r = await prepareVideoFollowUp({ leadId: MORRIS, actor: "operator" });
    const snap = await buildCompanySnapshot();
    out.prepared = {
      ok: r.ok, alreadyPrepared: r.alreadyPrepared, state: r.state, packageVersion: r.packageVersion,
      priorReceiptId: r.priorReceiptId, videoRevision: r.videoRevision,
      inReady: snap.ready.some((x) => x.leadId === MORRIS),
      inNeedsAttention: snap.needsAttention.some((x) => x.leadId === MORRIS),
      inScheduled: snap.scheduled.some((x) => x.leadId === MORRIS),
    };
  } else if (doPrepare) {
    out.prepared = { skipped: true, reason: "Morris not eligible — left in Needs Attention" };
  }
  out.bindHashAfter = await bindHashOf();
  out.bindHashUnchanged = out.bindHashBefore === out.bindHashAfter;
  const sends = await allEmailSends();
  out.sends = sends.length; out.receipts = sends.filter((e) => e.sentAt).length;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
