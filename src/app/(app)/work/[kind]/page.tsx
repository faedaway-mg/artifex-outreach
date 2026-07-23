// ─────────────────────────────────────────────────────────────────────────────
// Batch runner — one focused flow per kind of work.
//
// The operator picks a batch on Today and moves business-by-business without ever
// returning to the dashboard: a concise brief, one primary action, then advance. The
// position lives in the URL (?i=), so the browser back button works and an interruption
// never loses your place. Only what helps do THIS piece of work is shown — nothing else.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ArrowRight, ArrowLeft, X, Video, Mail, RotateCcw, FileText, Phone, CalendarClock, Compass } from "lucide-react";
import {
  todaysTasks, listLeads, allMeetings, getSettings, getBusinessIntelligence, contactsForLead, memoryForLead,
} from "@/lib/repo";
import { buildWorkQueue, batchLeadIds, categoryTitle, kindOfTask, type WorkKind } from "@/lib/work-queue";
import { buildOutreachKit } from "@/lib/outreach/kit";
import { memoryReferences } from "@/lib/reasoning";
import { BatchAdvance } from "@/components/BatchAdvance";

export const dynamic = "force-dynamic";

const KINDS: WorkKind[] = ["discovery", "follow-up", "email", "report", "call", "video", "understand"];
const ICON: Record<WorkKind, typeof Video> = { discovery: CalendarClock, "follow-up": RotateCcw, email: Mail, report: FileText, call: Phone, video: Video, understand: Compass };

// Per-kind primary action + how to frame the step.
const ACTION: Record<WorkKind, { verb: string; label: string; href: (id: string) => string }> = {
  discovery: { verb: "Talk with", label: "Open conversation mode", href: (id) => `/conversation/${id}` },
  "follow-up": { verb: "Follow up with", label: "Review the follow-up", href: (id) => `/leads/${id}/send` },
  email: { verb: "Approve the email to", label: "Review & approve", href: (id) => `/leads/${id}/send` },
  report: { verb: "Review the report for", label: "Open the review", href: (id) => `/leads/${id}/review` },
  call: { verb: "Call", label: "Open the call guide", href: (id) => `/leads/${id}` },
  video: { verb: "Record a video for", label: "Open the kit to record", href: (id) => `/leads/${id}/send` },
  understand: { verb: "Get to know", label: "Review the business", href: (id) => `/leads/${id}` },
};

export default async function BatchPage({ params, searchParams }: { params: { kind: string }; searchParams: { i?: string; ids?: string } }) {
  const kind = params.kind as WorkKind;
  if (!KINDS.includes(kind)) notFound();

  const settings = await getSettings();
  const [tasks, leads, meetings] = await Promise.all([todaysTasks(settings.prospecting.dailyQueueSize), listLeads(), allMeetings()]);
  const leadMap = new Map(leads.map((l) => [l.id, l]));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const meetingsToday = meetings
    .filter((m) => { const d = new Date(m.scheduledAt); return d >= startOfDay && d <= endOfDay; })
    .map((m) => ({ leadId: m.leadId, scheduledAt: m.scheduledAt }));

  const queue = buildWorkQueue({ tasks, meetingsToday, leads: leadMap });
  // The batch is fixed for its run (carried in the URL), so completing a step never
  // reshuffles the businesses under you. Fall back to a fresh batch on first entry.
  const carried = (searchParams.ids ?? "").split(",").map((s) => s.trim()).filter((id) => leadMap.has(id));
  const ids = carried.length > 0 ? carried : batchLeadIds(queue, kind);
  const idsParam = ids.join(",");
  const total = ids.length;
  const title = categoryTitle(kind);
  const Icon = ICON[kind];

  const i = Math.max(0, Math.min(total, parseInt(searchParams.i ?? "0", 10) || 0));

  // ── Batch complete ──────────────────────────────────────────────────────────
  if (total === 0 || i >= total) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400/12 text-emerald-300"><CheckCircle2 size={28} /></span>
        <h1 className="mt-4 text-xl font-semibold text-chalk-50">{total === 0 ? "Nothing here right now." : `${title} — done.`}</h1>
        <p className="mt-1.5 text-[14px] text-chalk-400">{total === 0 ? "This batch is empty. Nice — one less thing." : `You worked through all ${total}. That's the batch.`}</p>
        <Link href="/" className="btn-primary mt-6 justify-center !py-2.5"><ArrowLeft size={16} /> Back to today's work</Link>
      </div>
    );
  }

  const lead = leadMap.get(ids[i])!;
  const bi = await getBusinessIntelligence(lead.id);
  const profile = bi?.profile?.businessProfile ?? null;

  // ── A concise, kind-appropriate brief — only what helps do THIS work ────────
  const why = (lead.recommendationReason?.trim()) || bi?.profile?.briefing?.whyItMatters || "Worth a thoughtful touch today.";
  const observations = (bi?.profile?.briefing?.strongestOpportunities ?? []).slice(0, 2);

  let suggestedOpening: string | null = null;
  let suggestedQuestion: string | null = null;
  if (profile && (kind === "video" || kind === "call")) {
    const [contacts, memory] = await Promise.all([contactsForLead(lead.id), memoryForLead(lead.id)]);
    const kit = buildOutreachKit({ lead, profile, settings, contacts, memoryLines: memoryReferences(memory).map((r) => r.sentence) });
    suggestedOpening = kit.video?.opening ?? null;
    suggestedQuestion = kit.video?.question ?? null;
  }

  const action = ACTION[kind];
  const nextHref = `/work/${kind}?ids=${idsParam}&i=${i + 1}`;
  // The open task for this business in this batch — completing it ticks the mission.
  const stepTask = tasks.find((t) => t.leadId === lead.id && kindOfTask(t.type) === kind) ?? null;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Progress + exit */}
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Exit batch" className="rounded-lg p-1.5 text-chalk-500 hover:bg-white/[0.06] hover:text-chalk-200"><X size={18} /></Link>
        <div className="flex flex-1 items-center gap-2">
          <Icon size={15} className="text-azure-300" />
          <span className="text-[13px] font-medium text-chalk-200">{title}</span>
          <span className="ml-auto text-[12px] tabular-nums text-chalk-500">{i + 1} of {total}</span>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-azure-400/70 transition-all" style={{ width: `${((i) / total) * 100}%` }} />
      </div>

      {/* The focused brief */}
      <section className="card p-5 sm:p-6">
        <p className="text-[12px] text-chalk-500">{action.verb}</p>
        <h1 className="mt-0.5 text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{lead.businessName}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-chalk-300">{why}</p>

        {observations.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">{observations.length === 1 ? "What stood out" : "What stood out"}</p>
            <ul className="mt-1.5 space-y-1.5">
              {observations.map((o, k) => <li key={k} className="flex gap-2 text-[13.5px] text-chalk-300"><span className="mt-0.5 text-teal-300">→</span><span>{o}</span></li>)}
            </ul>
          </div>
        )}

        {suggestedOpening && (
          <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Suggested opening</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-200">“{suggestedOpening}”</p>
            {suggestedQuestion && <p className="mt-2 text-[13px] text-chalk-400">Then ask: “{suggestedQuestion}”</p>}
          </div>
        )}

        <Link href={action.href(lead.id)} className="btn-primary mt-5 w-full justify-center !py-3 text-[15px]">
          {action.label} <ArrowRight size={17} />
        </Link>
      </section>

      {/* Advance — completing persists and keeps the loop moving */}
      <BatchAdvance taskId={stepTask?.id ?? null} nextHref={nextHref} isLast={i + 1 >= total} />

      <p className="text-center text-[11px] text-chalk-600">{i + 1} of {total} · the batch stays put while you work</p>
    </div>
  );
}
