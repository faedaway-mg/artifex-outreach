// READ-ONLY census for the UI state/hierarchy mandate. (1) For each "Record voiceovers" lead, check
// whether EVERYTHING except the voiceover is truly prepared (client piece + evidence + frozen review/PDF
// + narration + screenshot + draft package). (2) For each scheduled binding, show scheduledAt vs now and
// its ledger disposition. No writes, no sends.
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
import { listJobs } from "../src/lib/content-studio/store";
import { latestReadyJob } from "../src/lib/content-studio/job";
import { resolveFrozenReviewForSend } from "../src/lib/outreach/quick-review-freeze";
import { latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { allEmailSends, getLead, getBusinessIntelligence } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";

async function main() {
  const now = new Date();
  const [snap, jobs, sends] = await Promise.all([buildCompanySnapshot(now), listJobs(), allEmailSends()]);

  console.log("\n===== (1) RECORD-VOICEOVERS RECONCILIATION =====");
  console.log("needsVoiceover count:", snap.needsVoiceover.length);
  let ready = 0, notReady = 0;
  for (const r of snap.needsVoiceover) {
    const pieceId = `client-${r.leadId}`;
    const piece = jobs.some((j) => j.pieceId === pieceId);
    const readyVideo = !!latestReadyJob(jobs, pieceId)?.outputKey;
    const lead = await getLead(r.leadId);
    const bi = await getBusinessIntelligence(r.leadId);
    const profile = bi?.profile?.businessProfile ?? null;
    const rev = lead ? buildQuickReview(lead, profile, null, { approved: await quickReviewApproved(r.leadId) }) : null;
    const finding = (rev?.findings?.[0] as any)?.observation ?? null;
    const frozen = await resolveFrozenReviewForSend(r.leadId).catch(() => ({ ok: false }));
    const pkg = await latestProspectPackage(r.leadId);
    const okAll = !!lead?.website && !!finding && !!lead?.publicEmail && (frozen as any).ok && piece && !readyVideo;
    if (okAll) ready++; else notReady++;
    console.log(`  ${okAll ? "READY " : "NOT   "} ${r.business} | site:${!!lead?.website} finding:${!!finding} email:${!!lead?.publicEmail} pdf:${(frozen as any).ok} piece:${piece} pkg:${pkg?.state ?? "none"}`);
  }
  console.log(`  → genuinely voiceover-ready: ${ready} | incorrectly included: ${notReady}`);

  console.log("\n===== (2) SCHEDULED-RECORD RECONCILIATION =====");
  const bindings = await listScheduledBindings();
  console.log("scheduled bindings:", bindings.length, "| now:", now.toISOString());
  for (const b of bindings) {
    const past = b.binding.scheduledAt < now.toISOString();
    const lead = await getLead(b.leadId);
    // Ledger: any send row for this lead that is provider-accepted?
    const sent = sends.find((s) => s.leadId === b.leadId && (s.status === "sent" || s.status === "delivered" || !!s.sentAt));
    const disp = sent ? `SENT(${sent.status}, ${sent.providerMessageId ?? "no-id"})` : past ? "PAST-DUE, never submitted → reschedule/terminal" : "future";
    console.log(`  ${past ? "PAST " : "FUT  "} ${lead?.businessName ?? b.leadId} | at ${b.binding.scheduledAt} | ${disp}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
