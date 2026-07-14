import Link from "next/link";
import { todaysTasks, listLeads, allMeetings, allProposals } from "@/lib/repo";
import { TierBadge, StageBadge, ScorePill, Stat, EmptyState } from "@/components/ui";
import { TaskActions } from "@/components/TaskActions";
import { formatRange, relativeDate, timeOfDay, shortDate } from "@/lib/utils";
import { Video, Mail, Phone, CalendarClock, FileText, ArrowRight } from "lucide-react";
import type { TaskType, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const TASK_META: Record<TaskType, { label: string; icon: any; primary: string }> = {
  review: { label: "Review lead", icon: ArrowRight, primary: "Review lead" },
  prepare_video: { label: "Prepare video", icon: Video, primary: "Prepare video" },
  review_and_send: { label: "Review & send", icon: Mail, primary: "Review & send" },
  call: { label: "Call", icon: Phone, primary: "Call" },
  follow_up: { label: "Follow up", icon: Mail, primary: "Follow up" },
  prepare_meeting: { label: "Prepare meeting", icon: CalendarClock, primary: "Prepare meeting" },
  prepare_proposal: { label: "Prepare proposal", icon: FileText, primary: "Prepare proposal" },
};

export default async function TodayPage() {
  const [tasks, leads, meetings, proposals] = await Promise.all([
    todaysTasks(),
    listLeads(),
    allMeetings(),
    allProposals(),
  ]);
  const leadMap = new Map<string, Lead>(leads.map((l) => [l.id, l]));

  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const meetingsToday = meetings.filter((m) => {
    const d = new Date(m.scheduledAt);
    return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && d <= endOfToday;
  });
  const proposalsOpen = proposals.filter((p) => p.status === "sent");

  const counts = {
    videos: tasks.filter((t) => t.type === "prepare_video").length,
    outreach: tasks.filter((t) => t.type === "review_and_send").length,
    followUps: tasks.filter((t) => t.type === "follow_up").length,
    meetings: meetingsToday.length,
    proposals: proposalsOpen.length,
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="label">Today · {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Who should I contact today?</h1>
        <p className="mt-1 text-sm text-chalk-400">
          Your prioritized work queue — each lead has a reason, evidence, and one clear next action.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Videos to record" value={counts.videos} tone="amber" />
        <Stat label="Drafts to approve" value={counts.outreach} tone="indigo" />
        <Stat label="Follow-ups due" value={counts.followUps} tone="azure" />
        <Stat label="Meetings today" value={counts.meetings} tone="amber" />
        <Stat label="Proposals open" value={counts.proposals} />
      </div>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-chalk-400">Priority queue</h2>
        {tasks.length === 0 ? (
          <EmptyState title="You're all caught up." hint="Head to Discover to find new leads." />
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const lead = leadMap.get(task.leadId);
              if (!lead) return null;
              const meta = TASK_META[task.type];
              const Icon = meta.icon;
              return (
                <div key={task.id} className="card card-hover animate-fade-up p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="truncate font-semibold text-chalk-50 hover:text-azure-300">
                          {lead.businessName}
                        </Link>
                        <TierBadge tier={lead.tier} />
                        <StageBadge stage={lead.pipelineStage} />
                        <span className="text-xs text-chalk-500">{lead.industry} · {lead.city}, {lead.state}</span>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-300">
                        <Icon size={13} /> {meta.label}
                        {task.type === "follow_up" && <span className="text-chalk-500">· {relativeDate(task.dueAt)}</span>}
                      </p>
                      {lead.recommendationReason && <p className="mt-1.5 max-w-2xl text-sm text-chalk-300">{lead.recommendationReason}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-chalk-500">
                        <span>Score: <ScorePill score={lead.leadScore} /></span>
                        {lead.recommendedService && <span>Service: <span className="text-chalk-300">{lead.recommendedService}</span></span>}
                        <span>Est: <span className="text-chalk-300">{formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</span></span>
                        {lead.nextFollowUpAt && <span>Next follow-up: {shortDate(lead.nextFollowUpAt)}</span>}
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

      {meetingsToday.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-chalk-400">Meetings today</h2>
          <div className="space-y-2">
            {meetingsToday.map((m) => {
              const lead = leadMap.get(m.leadId);
              return (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card card-hover flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-chalk-100">{lead?.businessName}</p>
                    <p className="text-xs text-chalk-500">{lead?.industry}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-amber-300">
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
