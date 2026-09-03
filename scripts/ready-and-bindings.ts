// READ-ONLY: (2) identify the one "ready to schedule" company + validate it; (5) verify the 11 Sep-4
// scheduled bindings remain intact with no duplicates. No writes, no sends.
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { getLead, getBusinessIntelligence } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { resolveFrozenReviewForSend } from "../src/lib/outreach/quick-review-freeze";
import { latestReadyJob } from "../src/lib/content-studio/job";
import { listJobs } from "../src/lib/content-studio/store";

async function main() {
  const snap = await buildCompanySnapshot(new Date());
  console.log("=== (2) READY TO SCHEDULE:", snap.ready.length, "===");
  const jobs = await listJobs();
  for (const r of snap.ready) {
    const lead = await getLead(r.leadId);
    const bi = await getBusinessIntelligence(r.leadId);
    const rev = lead ? buildQuickReview(lead, bi?.profile?.businessProfile ?? null, null, { approved: await quickReviewApproved(r.leadId) }) : null;
    const frozen = await resolveFrozenReviewForSend(r.leadId).catch(() => ({ ok: false } as any));
    const video = !!latestReadyJob(jobs, `client-${r.leadId}`)?.outputKey;
    console.log(`  ${r.business} (${r.leadId}) | recipient:${lead?.publicEmail} | canary:${lead?.source === "internal-test" || /canary/i.test(lead?.businessName ?? "")} | reviewStatus:${rev?.status} | frozenPDF:${frozen.ok} | hasVideo:${video} | type:${video ? "prospect-video" : "email-only"}`);
  }

  const bindings = await listScheduledBindings();
  const now = new Date().toISOString();
  const future = bindings.filter((b) => b.binding.scheduledAt > now);
  const past = bindings.filter((b) => b.binding.scheduledAt <= now);
  const byLead = new Map<string, number>();
  for (const b of bindings) byLead.set(b.leadId, (byLead.get(b.leadId) ?? 0) + 1);
  const dupes = [...byLead.entries()].filter(([, n]) => n > 1);
  console.log(`\n=== (5) SCHEDULED BINDINGS: total ${bindings.length} | future ${future.length} | past ${past.length} | duplicate leads ${dupes.length} ===`);
  for (const b of future.sort((a, z) => (a.binding.scheduledAt < z.binding.scheduledAt ? -1 : 1))) {
    const lead = await getLead(b.leadId);
    console.log(`  ${b.binding.scheduledAt} | ${lead?.businessName ?? b.leadId}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
