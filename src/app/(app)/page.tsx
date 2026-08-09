import Link from "next/link";
import {
  todaysTasks, listLeads, allMeetings, allProposals, getSettings, allPlans, allBusinessIntelligence, allFindings, allTasks, allSteps, listOperators, allEmailSends,
} from "@/lib/repo";
import { emailsSentOn } from "@/lib/outreach/send-capacity";
import { currentOperatorId } from "@/lib/auth";
import { parseScope, leadIdsInScope, tasksInScope, scopeOptions, scopeLabel, scopeMeaning, scopeToParam } from "@/lib/operators/scope";
import { QueueScopeSwitcher } from "@/components/QueueScopeSwitcher";
import { placesMode } from "@/lib/providers/places";
import { nextScheduledRun } from "@/lib/schedule";
import { concentrationAdvisories } from "@/lib/analytics";
import { journeyPhaseOf, opportunityMetrics } from "@/lib/journey";
import { TierBadge, ScorePill, EmptyState } from "@/components/ui";
import { JourneyBadge } from "@/components/JourneyBadge";
import { TaskActions } from "@/components/TaskActions";
import { TodayControls } from "@/components/TodayControls";
import { MorningWarming } from "@/components/MorningWarming";
import { WorkQueue } from "@/components/WorkQueue";
import { DailyMission } from "@/components/DailyMission";
import { buildWorkQueue, buildDailyMission, surfaceTodaysTasks, channelCapacity, channelOf, workKindForTask } from "@/lib/work-queue";
import { accountQueue } from "@/lib/queue-accounting";
import { accountSequences } from "@/lib/comms/task-projection";
import { formatCurrency, relativeDate, timeOfDay, shortDate, joinMeta, formatLocation, deslug } from "@/lib/utils";
import {
  Video, Mail, Phone, CalendarClock, FileText, ArrowRight, AlertTriangle, Clock, Brain,
  Sparkles, Compass, AlertCircle, GitBranch, HeartHandshake, RotateCcw, ClipboardCheck, Lightbulb, ChevronRight,
} from "lucide-react";
import type { TaskType, Lead, StoredBusinessIntelligence } from "@/lib/types";

export const dynamic = "force-dynamic";

const TASK_META: Record<TaskType, { label: string; icon: any; primary: string; tone: string }> = {
  review: { label: "Understand this business", icon: ArrowRight, primary: "Review", tone: "text-azure-300" },
  prepare_video: { label: "Personalized walkthrough recommended", icon: Video, primary: "Prepare video", tone: "text-amber-300" },
  review_and_send: { label: "Outreach ready for your review", icon: Mail, primary: "Review & send", tone: "text-indigo-300" },
  call: { label: "A conversation is warranted", icon: Phone, primary: "Call", tone: "text-azure-300" },
  follow_up: { label: "Continue the conversation", icon: Mail, primary: "Follow up", tone: "text-amber-300" },
  prepare_meeting: { label: "Prepare for discovery", icon: Compass, primary: "Prepare", tone: "text-teal-300" },
  prepare_proposal: { label: "Evolution plan to prepare", icon: FileText, primary: "Prepare plan", tone: "text-indigo-300" },
};

const PARTNER_PHASES = new Set(["Focused Improvement", "Partnership Active", "Expansion Opportunity", "Relationship Mature"]);
const isSameDay = (iso: string | null | undefined, ref: Date) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
};

export default async function TodayPage({ searchParams }: { searchParams?: { view?: string } }) {
  const settings = await getSettings();
  const queueSize = settings.prospecting.dailyQueueSize;
  // The queue is fetched UNCAPPED and scoped to the operator before slicing —
  // capping first would hide an operator's work behind someone else's.
  const [dueTasks, leads, meetings, proposals, plans, bi, findings, everyTask, allAcquisitionSteps, operators, emailSends] = await Promise.all([
    todaysTasks(), listLeads(), allMeetings(), allProposals(), allPlans(), allBusinessIntelligence(), allFindings(), allTasks(), allSteps(), listOperators(), allEmailSends(),
  ]);

  const now = new Date();
  const viewerId = currentOperatorId();
  const scopeCtx = { plans, meetings };
  const scope = parseScope(searchParams?.view, viewerId, operators.map((o) => o.id));
  const scopedLeadIds = leadIdsInScope({ scope, viewerId, leads, operators, ctx: scopeCtx, now });
  const views = scopeOptions({ viewerId, leads, operators, ctx: scopeCtx, now });

  const leadMap = new Map<string, Lead>(leads.filter((l) => scopedLeadIds.has(l.id)).map((l) => [l.id, l]));

  // Calls and emails are PARALLEL streams, each with its own daily capacity, instead
  // of a single combined cap that let calls crowd out email-first leads. Email capacity
  // is the warm-up-safe daily ceiling minus what has already gone out today.
  const emailsSentToday = emailsSentOn(emailSends, now);
  const capacity = channelCapacity({
    callTarget: settings.prospecting.callDailyTarget,
    emailTarget: settings.prospecting.emailDailyTarget,
    otherBudget: queueSize,
    emailsSentToday,
  });
  const scopedDue = tasksInScope(dueTasks, scopedLeadIds);
  const tasks = surfaceTodaysTasks({ tasks: scopedDue, leads: leadMap, capacity, now });
  const biByLead = new Map<string, StoredBusinessIntelligence>(bi.map((b) => [b.leadId, b]));
  const oppScoreOf = (l: Lead) => biByLead.get(l.id)?.improvementScore ?? l.leadScore ?? 0;
  const om = opportunityMetrics(leads, bi);

  const discoveryMode = placesMode();
  const nextRun = nextScheduledRun(settings.prospecting);
  const atCapacity = tasks.length >= capacity.call + capacity.email + capacity.other;
  const advisories = concentrationAdvisories(leads, settings.prospecting);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const meetingsToday = meetings.filter((m) => {
    const d = new Date(m.scheduledAt);
    return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && d <= endOfToday;
  });

  // ── Attention signals (understanding-first, not money-first) ────────────────
  const active = leads.filter((l) => journeyPhaseOf(l) != null);
  const leadsWithApprovedFinding = new Set(findings.filter((f) => f.approved).map((f) => f.leadId));
  const analyzedToday = bi.filter((b) => isSameDay(b.generatedAt, now)).length;
  const pendingApprovals = plans.filter((p) => p.approvalStatus === "pending").length;
  const highOpportunity = active.filter((l) => oppScoreOf(l) >= 70 && ["Business Identified", "Business Understood"].includes(journeyPhaseOf(l)!)).length;
  const discoveryAvailable = meetings.filter((m) => m.outcome === "pending").length;
  const confirmedFriction = active.filter((l) => leadsWithApprovedFinding.has(l.id)).length;
  const partnerships = active.filter((l) => PARTNER_PHASES.has(journeyPhaseOf(l)!)).length;
  const needFollowUp = leads.filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= endOfToday && journeyPhaseOf(l) != null).length;
  const awaitingEvolution = active.filter((l) => {
    const phase = journeyPhaseOf(l)!;
    const hasPlan = (biByLead.get(l.id)?.profile.evolution?.opportunities?.length ?? 0) > 0;
    return ["Business Understood", "Discovery Complete"].includes(phase) && !hasPlan;
  }).length;

  const attention: { label: string; count: number; meaning: string; href: string; icon: any; tone: string }[] = [
    { label: "Awaiting your review", count: pendingApprovals, meaning: "Prepared plans to approve before anything is sent", href: "/approvals", icon: ClipboardCheck, tone: "text-amber-300" },
    { label: "High-opportunity businesses", count: highOpportunity, meaning: "Strong improvement potential, early in the journey", href: "/pipeline", icon: Sparkles, tone: "text-teal-300" },
    { label: "Discovery conversations available", count: discoveryAvailable, meaning: "Booked calls to prepare for and hold", href: "/meetings", icon: Compass, tone: "text-teal-300" },
    { label: "Businesses with confirmed friction", count: confirmedFriction, meaning: "Validated friction ready to build a plan around", href: "/pipeline", icon: AlertCircle, tone: "text-amber-300" },
    { label: "Awaiting evolution plans", count: awaitingEvolution, meaning: "Understood, but no roadmap prepared yet", href: "/pipeline", icon: GitBranch, tone: "text-indigo-300" },
    { label: "Needing follow-up", count: needFollowUp, meaning: "Open conversations to continue", href: "/pipeline", icon: RotateCcw, tone: "text-azure-300" },
    { label: "Partnerships in progress", count: partnerships, meaning: "Active technology partnerships to nurture", href: "/pipeline", icon: HeartHandshake, tone: "text-emerald-300" },
    { label: "Analyzed today", count: analyzedToday, meaning: "New businesses understood since this morning", href: "/discover", icon: Brain, tone: "text-azure-300" },
  ];

  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Today's queue, deduped, with intelligence-readiness for morning warming.
  const seenQueue = new Set<string>();
  const todaysBusinesses: { id: string; name: string; warm: boolean }[] = [];
  for (const t of tasks) {
    const l = leadMap.get(t.leadId);
    if (l && !seenQueue.has(l.id)) { seenQueue.add(l.id); todaysBusinesses.push({ id: l.id, name: l.businessName, warm: biByLead.has(l.id) }); }
  }

  // ── Today's work, grouped into batches, already prioritized ─────────────────
  const workQueue = buildWorkQueue({
    tasks,
    meetingsToday: meetingsToday.map((m) => ({ leadId: m.leadId, scheduledAt: m.scheduledAt })),
    leads: leadMap,
  });

  // Businesses moved today (tasks completed today) → the mission's progress.
  const doneToday = everyTask.filter((t) => t.status === "done" && isSameDay(t.updatedAt, now)).length;
  const mission = buildDailyMission(workQueue, doneToday);
  // The honest ledger of everything NOT on screen (beyond cap, future, snoozed, unqueued).
  // Scoped to the same businesses as the queue above, so the ledger's totals
  // reconcile with what is actually on screen rather than with the whole company.
  const ledger = accountQueue({
    leads: leads.filter((l) => scopedLeadIds.has(l.id)),
    tasks: everyTask.filter((t) => scopedLeadIds.has(t.leadId)),
    // Beyond-capacity is measured against what actually surfaced across all streams,
    // not a single combined number, now that calls and emails are capped separately.
    cap: tasks.length,
    now,
  });
  // Email-first work deferred specifically because today's warm-up-safe send ceiling is
  // spent — surfaced so the operator knows it is capacity, not a bug (it returns tomorrow).
  const emailLeads = (ts: typeof tasks) =>
    new Set(ts.filter((t) => leadMap.has(t.leadId) && channelOf(workKindForTask(t, leadMap.get(t.leadId))) === "email").map((t) => t.leadId)).size;
  const emailDeferred = Math.max(0, emailLeads(scopedDue) - emailLeads(tasks));
  const emailCeilingReached = capacity.email === 0 && emailDeferred > 0;
  // Sequence state that Today cannot show directly: future touches are real work
  // that simply isn't due yet, and a plan stalled before approval is invisible
  // work. Neither is actionable now, so neither is counted as today's work.
  const sequences = accountSequences({ plans, steps: allAcquisitionSteps, tasks: everyTask, now });

  const revenueWon = proposals.filter((p) => p.status === "accepted").reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Today's work — the hero. The eye lands on what to do now, not on a counter
          (ES-010: work outranks metrics). */}
      <div>
        <p className="eyebrow mb-3">{dateLabel} · Today's work</p>
        <WorkQueue categories={workQueue} />
        {/* Queue ledger — where everything else is, so "where did my leads go?" is
            never a mystery. One quiet line; shown only when something is out of view. */}
        {(ledger.beyondCap > 0 || ledger.waitingFuture > 0 || ledger.snoozed > 0 || ledger.noWorkActive > 0 || emailCeilingReached
          || sequences.futureScheduledSteps > 0 || sequences.plansAwaitingApproval > 0 || sequences.dueStepsMissingTask > 0) && (
          <p className="mt-2.5 text-[12px] text-chalk-500">
            {[
              emailCeilingReached ? `${emailDeferred} more email${emailDeferred === 1 ? "" : "s"} ready — today's safe send capacity is used up (resets tomorrow)` : null,
              ledger.beyondCap > 0 ? `${ledger.beyondCap} more due today (beyond today's capacity)` : null,
              ledger.waitingFuture > 0 ? `${ledger.waitingFuture} scheduled for later dates` : null,
              ledger.snoozed > 0 ? `${ledger.snoozed} snoozed` : null,
              ledger.noWorkActive > 0 ? `${ledger.noWorkActive} businesses with nothing queued` : null,
              sequences.futureScheduledSteps > 0 ? `${sequences.futureScheduledSteps} follow-ups scheduled ahead` : null,
              sequences.plansAwaitingApproval > 0 ? `${sequences.plansAwaitingApproval} sequences waiting on approval` : null,
              sequences.dueStepsMissingTask > 0 ? `${sequences.dueStepsMissingTask} due follow-ups not yet queued` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Today's mission — quiet progress context, beneath the work it measures. */}
      <DailyMission mission={mission} />

      {/* Everything else — the detailed queue + context, only if you want it */}
      <details id="everything" className="group">
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] py-2.5 text-[12.5px] text-chalk-400 transition-colors hover:text-chalk-200">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
          Everything else today
          {tasks.length > 0 && <span className="text-chalk-600">· {tasks.length} in the queue</span>}
        </summary>

        <div className="mt-5 space-y-8">
          {/* Background: warm today's intelligence so nothing is a cold start */}
          {todaysBusinesses.length > 0 && <MorningWarming businesses={todaysBusinesses} />}

          {/* Discovery unavailable banner (production, no key) */}
          {discoveryMode === "disabled" && (
            <div className="card border-coral-500/25 bg-coral-500/[0.04] p-4">
              <p className="flex items-center gap-2 text-sm text-coral-200">
                <AlertTriangle size={16} /> Automatic discovery is unavailable — no Google Places key configured. Your existing work is preserved; add businesses manually from Discover.
              </p>
            </div>
          )}

          {/* The rest of today's queue */}
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200"><Compass size={15} className="text-azure-300" /> {scopeLabel(scope, operators)} to work with today</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-chalk-500">
                  <Clock size={11} /> {tasks.length} of {queueSize} · next auto-discovery {nextRun.relative}
                </p>
              </div>
              <TodayControls atCapacity={atCapacity} />
            </div>
            {operators.length > 1 && (
              <div className="mb-4">
                <QueueScopeSwitcher options={views} active={scopeToParam(scope)} meaning={scopeMeaning(scope)} />
              </div>
            )}
            {tasks.length === 0 ? (
              <EmptyState icon={Sparkles} title="You're all caught up." hint="Ask Artifex to research and understand a few new businesses, or open Discover to search manually." />
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => {
                  const lead = leadMap.get(task.leadId);
                  if (!lead) return null;
                  const meta = TASK_META[task.type];
                  const Icon = meta.icon;
                  return (
                    <div key={task.id} className="card p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/leads/${lead.id}`} className="truncate text-sm font-semibold text-chalk-50 ring-focus hover:text-azure-300">{lead.businessName}</Link>
                            <JourneyBadge phase={journeyPhaseOf(lead)} />
                          </div>
                          <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${meta.tone}`}>
                            <Icon size={13} /> {meta.label}
                            {task.type === "follow_up" && <span className="text-chalk-500">· {relativeDate(task.dueAt)}</span>}
                          </p>
                        </div>
                        <div className="shrink-0">
                          <TaskActions task={task} leadId={lead.id} primaryLabel={meta.primary} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Meetings today */}
          {meetingsToday.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-200"><CalendarClock size={15} className="text-teal-300" /> Discovery conversations today</h2>
              <div className="space-y-2">
                {meetingsToday.map((m) => {
                  const lead = leadMap.get(m.leadId);
                  return (
                    <div key={m.id} className="card flex items-center justify-between p-4">
                      <div className="min-w-0">
                        <Link href={`/leads/${m.leadId}`} className="font-medium text-chalk-100 hover:text-azure-300">{lead?.businessName}</Link>
                        <p className="text-xs text-chalk-500">{lead?.industry}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/conversation/${m.leadId}`} className="btn-secondary !px-3 !py-1.5 text-xs">Conversation mode</Link>
                        <span className="flex items-center gap-2 rounded-lg border border-teal-400/20 bg-teal-400/10 px-3 py-1.5 text-sm text-teal-300"><CalendarClock size={15} /> {timeOfDay(m.scheduledAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* What deserves attention — the fuller picture, on request */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-200"><Sparkles size={15} className="text-azure-300" /> The fuller picture</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {attention.filter((a) => a.count > 0).map((a) => {
                const Icon = a.icon;
                return (
                  <Link key={a.label} href={a.href} className="card card-hover p-4">
                    <div className="flex items-start justify-between">
                      <Icon size={15} className={a.tone} />
                      <span className="text-xl font-semibold tabular-nums text-chalk-50">{a.count}</span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-chalk-200">{a.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-chalk-500">{a.meaning}</p>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Learning insight */}
          {advisories[0] && (
            <div className="card flex items-start gap-2.5 border-indigo-400/20 bg-indigo-400/[0.03] p-4">
              <Lightbulb size={15} className="mt-0.5 shrink-0 text-indigo-300" />
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What we're learning</p>
                <p className="mt-0.5 text-sm text-chalk-300">{advisories[0]}</p>
              </div>
            </div>
          )}

          {/* Commercial context — lowest in the hierarchy */}
          <section className="border-t border-white/[0.05] pt-5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-chalk-600">Commercial context</p>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-chalk-500">
              <span>Revenue won · <span className="text-chalk-300">{formatCurrency(revenueWon)}</span></span>
              <span>Partnerships · <span className="text-chalk-300">{partnerships}</span></span>
              <span>Opportunity score · <span className="text-chalk-300">{om.businessOpportunityScore ?? "—"}/100</span></span>
              <span>Ready to talk · <span className="text-chalk-300">{om.readyForConversation}</span></span>
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
