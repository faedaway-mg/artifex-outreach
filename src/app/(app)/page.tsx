import Link from "next/link";
import { todaysTasks, listLeads, allMeetings, allProposals, getSettings, allPlans } from "@/lib/repo";
import { placesMode } from "@/lib/providers/places";
import { nextScheduledRun } from "@/lib/schedule";
import { todayMix, concentrationAdvisories } from "@/lib/analytics";
import { TierBadge, StageBadge, ScorePill, Stat, EmptyState } from "@/components/ui";
import { TaskActions } from "@/components/TaskActions";
import { TodayControls } from "@/components/TodayControls";
import { formatRange, formatCurrency, relativeDate, timeOfDay, shortDate } from "@/lib/utils";
import { Video, Mail, Phone, CalendarClock, FileText, ArrowRight, Sparkles, Sunrise, AlertTriangle, Clock } from "lucide-react";
import type { TaskType, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const TASK_META: Record<TaskType, { label: string; icon: any; primary: string; tone: string }> = {
  review: { label: "Review lead", icon: ArrowRight, primary: "Review lead", tone: "text-azure-300" },
  prepare_video: { label: "Video recommended", icon: Video, primary: "Prepare video", tone: "text-amber-300" },
  review_and_send: { label: "Draft ready to review", icon: Mail, primary: "Review & send", tone: "text-indigo-300" },
  call: { label: "Call recommended", icon: Phone, primary: "Call", tone: "text-azure-300" },
  follow_up: { label: "Follow-up due", icon: Mail, primary: "Follow up", tone: "text-amber-300" },
  prepare_meeting: { label: "Meeting to prepare", icon: CalendarClock, primary: "Prepare meeting", tone: "text-amber-300" },
  prepare_proposal: { label: "Proposal to prepare", icon: FileText, primary: "Prepare proposal", tone: "text-indigo-300" },
};

const CLOSED = new Set(["Won", "Lost", "Disqualified", "Nurture"]);

export default async function TodayPage() {
  const settings = await getSettings();
  const queueSize = settings.prospecting.dailyQueueSize;
  const [tasks, leads, meetings, proposals, plans] = await Promise.all([
    todaysTasks(queueSize),
    listLeads(),
    allMeetings(),
    allProposals(),
    allPlans(),
  ]);
  const pendingApprovals = plans.filter((p) => p.approvalStatus === "pending").length;
  const activePlans = plans.filter((p) => p.status === "active").length;
  const personalPending = plans.filter((p) => p.approvalStatus === "pending" && p.strategy === "Personal").length;
  const leadMap = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const discoveryMode = placesMode();
  const nextRun = nextScheduledRun(settings.prospecting);
  const atCapacity = tasks.length >= queueSize;

  const todayLeadIds = new Set(tasks.map((t) => t.leadId));
  const activeCount = tasks.filter((t) => t.type !== "review").length;
  const mix = todayMix(leads, todayLeadIds);
  const advisories = concentrationAdvisories(leads, settings.prospecting);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const meetingsToday = meetings.filter((m) => {
    const d = new Date(m.scheduledAt);
    return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && d <= endOfToday;
  });
  const proposalsOpen = proposals.filter((p) => p.status === "sent");

  const workspace: { label: string; count: number; href: string }[] = [
    { label: "Needs approval", count: pendingApprovals, href: "/approvals" },
    { label: "Waiting", count: activePlans, href: "/pipeline" },
    { label: "Ready today", count: plans.filter((p) => p.status === "active" && p.nextScheduledAt && new Date(p.nextScheduledAt) <= endOfToday).length, href: "/approvals" },
    { label: "Paused", count: plans.filter((p) => p.status === "paused").length, href: "/pipeline" },
    { label: "Meetings", count: meetingsToday.length, href: "/meetings" },
    { label: "Proposals", count: proposalsOpen.length, href: "/pipeline" },
    { label: "Won", count: leads.filter((l) => l.pipelineStage === "Won").length, href: "/performance" },
    { label: "Lost", count: leads.filter((l) => l.pipelineStage === "Lost").length, href: "/pipeline" },
  ];

  const potentialValue = leads
    .filter((l) => !CLOSED.has(l.pipelineStage) && l.estimatedValueLow && l.estimatedValueHigh)
    .reduce((sum, l) => sum + ((l.estimatedValueLow! + l.estimatedValueHigh!) / 2), 0);

  const counts = {
    videos: tasks.filter((t) => t.type === "prepare_video").length,
    outreach: tasks.filter((t) => t.type === "review_and_send").length,
    followUps: tasks.filter((t) => t.type === "follow_up").length,
    meetings: meetingsToday.length,
    proposals: proposalsOpen.length,
  };

  return (
    <div className="space-y-8">
      {/* Daily focus header */}
      <section className="card relative overflow-hidden p-6 md:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-azure-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-40 rounded-full bg-indigo-500/[0.07] blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow flex items-center gap-1.5"><Sunrise size={13} /> {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
            <h1 className="mt-2 text-[1.9rem] font-semibold leading-tight tracking-[-0.02em] text-chalk-50">{greeting}, Jordan.</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-chalk-300">
              {tasks.length > 0
                ? <>You have <span className="font-medium text-chalk-100">{tasks.length} {tasks.length === 1 ? "action" : "actions"}</span> that could move active opportunities forward today.</>
                : "Nothing needs your attention right now. A calm moment to discover new businesses."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
            <div>
              <p className="text-[11px] text-chalk-500">Potential pipeline</p>
              <p className="mt-0.5 text-metric-lg font-semibold tracking-tight text-teal-300">{formatCurrency(Math.round(potentialValue))}</p>
            </div>
            <div className="h-10 w-px bg-white/[0.08]" />
            <div>
              <p className="text-[11px] text-chalk-500">Focus today</p>
              <p className="mt-0.5 flex items-baseline gap-1 text-metric-lg font-semibold tracking-tight text-chalk-50">{tasks.length}<span className="text-sm font-normal text-chalk-500">actions</span></p>
            </div>
          </div>
        </div>
      </section>

      {/* Focus strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Videos to record" value={counts.videos} tone="amber" />
        <Stat label="Drafts to approve" value={counts.outreach} tone="indigo" />
        <Stat label="Follow-ups due" value={counts.followUps} tone="azure" />
        <Stat label="Meetings today" value={counts.meetings} tone="amber" />
        <Stat label="Proposals open" value={counts.proposals} tone="teal" />
      </div>

      {/* Acquisition approvals awaiting review */}
      {pendingApprovals > 0 && (
        <Link href="/approvals" className="card card-hover flex items-center justify-between p-4">
          <p className="flex items-center gap-2 text-sm text-chalk-200">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400/15 text-amber-300">{pendingApprovals}</span>
            {pendingApprovals} acquisition {pendingApprovals === 1 ? "plan" : "plans"} awaiting your approval
            {personalPending > 0 && <span className="text-xs text-amber-300/80">· {personalPending} Personal (individual)</span>}
            {activePlans > 0 && <span className="text-xs text-chalk-500">· {activePlans} active</span>}
          </p>
          <span className="text-xs text-azure-300">Open Approval Center →</span>
        </Link>
      )}

      {/* Acquisition workspace categories */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {workspace.map((w) => (
          <Link key={w.label} href={w.href} className="card card-hover px-3 py-2.5 text-center">
            <p className={`text-lg font-semibold tabular-nums ${w.count > 0 ? "text-chalk-50" : "text-chalk-600"}`}>{w.count}</p>
            <p className="text-[10px] text-chalk-500">{w.label}</p>
          </Link>
        ))}
      </div>

      {/* Today's category mix (subtle) */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/[0.05] bg-ink-900/30 px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Today's mix</span>
          {mix.map((m) => (
            <span key={m.group} className="text-xs text-chalk-300">
              {m.group.replace(" and ", " & ").replace(" Services", "").replace(" and Local Commerce", "")} <span className="font-mono text-chalk-500">{m.count}</span>
            </span>
          ))}
          {activeCount > 0 && <span className="text-xs text-chalk-300">Active work <span className="font-mono text-chalk-500">{activeCount}</span></span>}
          {advisories[0] && <span className="ml-auto text-[11px] text-amber-300/80">{advisories[0]}</span>}
        </div>
      )}

      {/* Discovery unavailable banner (production, no key) */}
      {discoveryMode === "disabled" && (
        <div className="card border-coral-500/25 bg-coral-500/[0.04] p-4">
          <p className="flex items-center gap-2 text-sm text-coral-200">
            <AlertTriangle size={16} /> Automatic discovery is unavailable — no Google Places key configured. Your existing Today items are preserved; add businesses manually from Discover.
          </p>
        </div>
      )}

      {/* Priority queue */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200"><Sparkles size={15} className="text-azure-300" /> Priority queue</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-chalk-500">
              <Clock size={11} /> {tasks.length} of {queueSize} · next auto-run {nextRun.relative}
            </p>
          </div>
          <TodayControls atCapacity={atCapacity} />
        </div>
        {tasks.length === 0 ? (
          <EmptyState icon={Sparkles} title="You're all caught up." hint="Tap “Find more leads” to have Artifex research and qualify new businesses for you, or open Discover to search manually." />
        ) : (
          <div className="space-y-3">
            {tasks.map((task, idx) => {
              const lead = leadMap.get(task.leadId);
              if (!lead) return null;
              const meta = TASK_META[task.type];
              const Icon = meta.icon;
              return (
                <div key={task.id} className="card card-hover p-5 animate-fade-up" style={{ animationDelay: `${Math.min(idx * 45, 300)}ms` }}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="truncate text-[15px] font-semibold text-chalk-50 ring-focus hover:text-azure-300">
                          {lead.businessName}
                        </Link>
                        <TierBadge tier={lead.tier} />
                        <StageBadge stage={lead.pipelineStage} />
                      </div>
                      <p className="mt-1 text-xs text-chalk-500">{lead.industry} · {lead.city}, {lead.state}</p>
                      <p className={`mt-2.5 flex items-center gap-1.5 text-xs font-medium ${meta.tone}`}>
                        <Icon size={13} /> {meta.label}
                        {task.type === "follow_up" && <span className="text-chalk-500">· {relativeDate(task.dueAt)}</span>}
                      </p>
                      {lead.recommendationReason && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-chalk-300">{lead.recommendationReason}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-chalk-500">
                        <span className="inline-flex items-center gap-1.5">Score <ScorePill score={lead.leadScore} /></span>
                        {lead.recommendedService && <span>Service · <span className="text-chalk-300">{lead.recommendedService}</span></span>}
                        <span>Opportunity · <span className="text-teal-300/90">{formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</span></span>
                        {lead.nextFollowUpAt && <span>Next · {shortDate(lead.nextFollowUpAt)}</span>}
                      </div>
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
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-chalk-200"><CalendarClock size={15} className="text-amber-300" /> Meetings today</h2>
          <div className="space-y-2">
            {meetingsToday.map((m) => {
              const lead = leadMap.get(m.leadId);
              return (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card card-hover flex items-center justify-between p-4 ring-focus">
                  <div>
                    <p className="font-medium text-chalk-100">{lead?.businessName}</p>
                    <p className="text-xs text-chalk-500">{lead?.industry}</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-300">
                    <CalendarClock size={15} /> {timeOfDay(m.scheduledAt)}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
