// READ-ONLY production census (mandate: inventory reconciliation regression). Reproduces BOTH eligibility
// engines against the live DB and reconciles them — the schedule engine (schedulableEmails, iterates ALL
// leads) vs the Today command-center funnel (candidateIds gated on OPEN review_and_send/prepare_video tasks).
// Writes NOTHING, sends NOTHING. Run: railway run npx tsx scripts/funnel-census.ts
import {
  listLeads, allBusinessIntelligence, allEmailSends, allTasks, getSettings, isSuppressed, listOperators,
} from "../src/lib/repo";
import { isInternalLead } from "../src/lib/operators/assignment";
import { emailsSentOn } from "../src/lib/outreach/send-capacity";
import { schedulableEmails } from "../src/lib/outreach/schedulable-list";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { listJobs as csListJobs } from "../src/lib/content-studio/store";
import { latestReadyJob as csLatestReadyJob } from "../src/lib/content-studio/job";
import { emailQueueEligibility } from "../src/lib/outreach/email-queue-eligibility";
import { getEditorialState } from "../src/lib/outreach/review-revisions";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { validEmail } from "../src/lib/acquisition/compliance";
import { computeFunnel } from "../src/lib/outreach/funnel-counts";
import { deriveLeadFacts } from "../src/lib/outreach/today-funnel";
import type { Lead } from "../src/lib/types";

const isSameDay = (iso: string | null | undefined, ref: Date) => {
  if (!iso) return false; const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
};

async function factsFor(lead: Lead, ctx: { csJobs: any[]; allTasks: any[]; scheduledLeadIds: Set<string>; emailSends: any[]; now: Date; profileOf: (id: string) => any }) {
  const openForLead = ctx.allTasks.filter((t) => t.leadId === lead.id);
  const hasOpenVideoTask = openForLead.some((t) => t.type === "prepare_video");
  const pieceId = `client-${lead.id}`;
  const readyJob = csLatestReadyJob(ctx.csJobs, pieceId);
  const activeJob = ctx.csJobs.find((j) => j.pieceId === pieceId && (j.status === "queued" || j.status === "rendering"));
  const jobsForPiece = ctx.csJobs.filter((j) => j.pieceId === pieceId);
  const lastJob = jobsForPiece[jobsForPiece.length - 1];
  const videoReady = !!readyJob?.outputKey;
  const videoRendering = !!activeJob;
  const videoFailed = !videoReady && lastJob?.status === "failed";
  const review = buildQuickReview(lead, ctx.profileOf(lead.id) ?? null, null, { approved: await quickReviewApproved(lead.id) });
  const est = await getEditorialState(lead.id);
  const elig = emailQueueEligibility({ review, recipientValid: validEmail(lead.publicEmail), suppressed: await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone }), held: !!est.held });
  return deriveLeadFacts({
    lead, hasOpenVideoTask, videoReady, videoRendering, videoFailed,
    sendEligible: elig.ready, blockedReason: elig.detail ?? null,
    scheduled: ctx.scheduledLeadIds.has(lead.id),
    sentToday: ctx.emailSends.some((e: any) => e.leadId === lead.id && isSameDay(e.sentAt, ctx.now)),
    finding: null, recipient: lead.publicEmail ?? null,
  });
}

async function main() {
  const now = new Date();
  const [leads, bi, emailSends, everyTask, settings, operators, csJobs, scheduledBindings, schedView] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), allTasks(), getSettings(), listOperators(), csListJobs(), listScheduledBindings(), schedulableEmails(now),
  ]);
  const internal = new Set(leads.filter(isInternalLead).map((l) => l.id));
  const emailsSentToday = emailsSentOn(emailSends, now, { excludeLeadIds: internal });
  const scheduledLeadIds = new Set(scheduledBindings.map((b) => b.leadId));

  console.log("\n===== READ-ONLY PRODUCTION CENSUS =====");
  console.log("operators:", operators.length, "| leads total:", leads.length, "| internal/test:", internal.size);
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.pipelineStage] = (byStage[l.pipelineStage] || 0) + 1;
  console.log("leads by pipelineStage:", JSON.stringify(byStage));

  const tByType: Record<string, number> = {}; const openByType: Record<string, number> = {};
  for (const t of everyTask) { tByType[t.type] = (tByType[t.type] || 0) + 1; if (t.status !== "done" && t.status !== "skipped") openByType[t.type] = (openByType[t.type] || 0) + 1; }
  console.log("tasks by type (all):", JSON.stringify(tByType));
  console.log("tasks by type (open):", JSON.stringify(openByType));
  console.log("email_sends total:", emailSends.length, "| sent today (LA, non-internal):", emailsSentToday);

  // ── Schedule engine ground truth ──────────────────────────────────────────
  console.log("\n----- SCHEDULE ENGINE (schedulableEmails — iterates ALL leads) -----");
  console.log("eligible:", schedView.eligible.length, "| scheduled:", schedView.scheduled.length, "| notReady:", schedView.notReady.length);
  console.log("scheduled bindings (listScheduledBindings):", scheduledBindings.length);
  for (const s of schedView.scheduled) console.log("  SCHEDULED", s.leadId, "|", s.business, "| at", s.scheduledAt);

  // ── Today funnel: candidateIds gate (open review_and_send/prepare_video tasks) ──
  const candidateIds = new Set(everyTask.filter((t) => t.type === "review_and_send" || t.type === "prepare_video").map((t) => t.leadId));
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const biByLead = new Map(bi.map((b) => [b.leadId, b]));
  const profileOf = (id: string) => biByLead.get(id)?.profile?.businessProfile ?? null;
  const ctx = { csJobs, allTasks: everyTask, scheduledLeadIds, emailSends, now, profileOf };

  const gatedFacts = [];
  for (const id of candidateIds) { const l = leadMap.get(id); if (!l || internal.has(id)) continue; gatedFacts.push(await factsFor(l, ctx)); }
  const gatedFunnel = computeFunnel({ leads: gatedFacts, dailyCap: 20, sentToday: emailsSentToday });

  const ungatedFacts = [];
  for (const l of leads) { if (internal.has(l.id)) continue; ungatedFacts.push(await factsFor(l, ctx)); }
  const ungatedFunnel = computeFunnel({ leads: ungatedFacts, dailyCap: 20, sentToday: emailsSentToday });

  console.log("\n----- TODAY FUNNEL: candidate universe -----");
  console.log("candidateIds (leads with a review_and_send/prepare_video task):", candidateIds.size);
  console.log("non-internal leads (ungated universe):", ungatedFacts.length);
  const fmt = (f: any) => `eligible=${f.eligibleNow} awaitingVideo=${f.awaitingVideo} rendering=${f.rendering} failed=${f.failed} blocked=${f.blocked} scheduled=${f.scheduled} sentToday=${f.sentToday} remainingCap=${f.remainingCapacity}`;
  console.log("GATED funnel (what Today deploys today):  ", fmt(gatedFunnel));
  console.log("UNGATED funnel (all valid inventory):     ", fmt(ungatedFunnel));

  // ── The parity gap: valid inventory dropped by the task gate ────────────────
  const schedLeadIds = new Set([...schedView.eligible.map((e) => e.leadId), ...schedView.scheduled.map((s) => s.leadId)]);
  const droppedBySched = [...schedLeadIds].filter((id) => !candidateIds.has(id));
  console.log("\n----- RECONCILIATION GAP -----");
  console.log("schedule-engine actionable leads (eligible+scheduled):", schedLeadIds.size);
  console.log("of those, MISSING from Today candidateIds:", droppedBySched.length);
  for (const id of droppedBySched.slice(0, 20)) {
    const l = leadMap.get(id); const tasks = everyTask.filter((t) => t.leadId === id).map((t) => `${t.type}:${t.status}`);
    console.log("  DROPPED", id, "|", l?.businessName, "| scheduled=" + scheduledLeadIds.has(id), "| tasks=[" + tasks.join(",") + "]");
  }
  // ── Blocked reason buckets (over ALL non-internal leads) ────────────────────
  console.log("\n----- BLOCKED REASON BUCKETS (ungated, non-internal) -----");
  const reasonBuckets = new Map<string, string[]>();
  for (const f of ungatedFacts) {
    if (f.scheduled || f.sentToday) continue;
    if (f.videoRequired && !f.videoReady) continue; // awaiting video, not blocked
    if (f.sendEligible) continue; // eligible, not blocked
    const reason = f.blockedReason || "not ready";
    if (!reasonBuckets.has(reason)) reasonBuckets.set(reason, []);
    reasonBuckets.get(reason)!.push(f.leadId);
  }
  let blockedTotal = 0;
  for (const [reason, ids] of [...reasonBuckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
    blockedTotal += ids.length;
    console.log(`  ${ids.length.toString().padStart(4)}  ${reason}`);
  }
  console.log("  BLOCKED TOTAL:", blockedTotal);

  console.log("\ncensus complete (read-only, no writes).\n");
}
main().then(() => process.exit(0)).catch((e) => { console.error("census error:", e?.stack || e); process.exit(1); });
