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
import { CheckCircle2, ArrowRight, ArrowLeft, X, Video, Mail, RotateCcw, FileText, Phone, CalendarClock, Compass, Clock } from "lucide-react";
import {
  todaysTasks, listLeads, allMeetings, getSettings, getBusinessIntelligence, contactsForLead, memoryForLead,
} from "@/lib/repo";
import { buildWorkQueue, batchLeadIds, categoryTitle, kindOfTask, type WorkKind } from "@/lib/work-queue";
import { buildOutreachKit } from "@/lib/outreach/kit";
import { buildVideoScript } from "@/lib/outreach/content";
import { renderPersonalEmailHtml } from "@/lib/outreach/email-render";
import { readingSeconds } from "@/lib/outreach/voice-engine";
import { memoryReferences } from "@/lib/reasoning";
import { deslug } from "@/lib/utils";
import { BatchAdvance } from "@/components/BatchAdvance";
import { EmailDecision } from "@/components/EmailDecision";

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
    const litUp = total > 0;
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        {/* A completed constellation — the batch, lit */}
        <svg viewBox="0 0 120 60" className="mx-auto h-16 w-32" role="img" aria-label="batch complete">
          {[[16, 40], [42, 20], [70, 44], [98, 24]].map((p, k, arr) => (
            k < arr.length - 1 ? <line key={`l${k}`} x1={p[0]} y1={p[1]} x2={arr[k + 1][0]} y2={arr[k + 1][1]} stroke="#E8A24A" strokeOpacity={litUp ? 0.5 : 0.12} strokeWidth="1.2" /> : null
          ))}
          {[[16, 40], [42, 20], [70, 44], [98, 24]].map((p, k) => (
            <g key={`n${k}`}><circle cx={p[0]} cy={p[1]} r="6" fill="#F5BC63" opacity={litUp ? 0.16 : 0.05} /><circle cx={p[0]} cy={p[1]} r="3" fill={litUp ? "#F6CD88" : "#5B6472"} /></g>
          ))}
        </svg>
        <h1 className="mt-3 text-xl font-semibold text-chalk-50">{total === 0 ? "Nothing here right now." : `${title} — done.`}</h1>
        <p className="mt-1.5 text-[14px] text-chalk-400">{total === 0 ? "This batch is empty. One less thing." : `All ${total} done. That's the batch.`}</p>
        <Link href="/" className="btn-secondary mt-6 justify-center !py-2.5"><ArrowLeft size={16} /> Back to today's work</Link>
      </div>
    );
  }

  const lead = leadMap.get(ids[i])!;
  const bi = await getBusinessIntelligence(lead.id);
  const profile = bi?.profile?.businessProfile ?? null;

  // ── A concise, kind-appropriate brief — only what helps do THIS work ────────
  const why = (lead.recommendationReason?.trim()) || bi?.profile?.briefing?.whyItMatters || "Worth a thoughtful touch today.";
  const observations = (bi?.profile?.briefing?.strongestOpportunities ?? []).slice(0, 2);

  const nextHref = `/work/${kind}?ids=${idsParam}&i=${i + 1}`;
  const stepTask = tasks.find((t) => t.leadId === lead.id && kindOfTask(t.type) === kind) ?? null;
  const isEmail = kind === "email" || kind === "follow-up";

  let contactName = "";
  let firstQuestion: string | null = null;
  let emailProps: null | { subject: string; openingSentence: string; readingLabel: string; fullParagraphs: string[]; contact: string; html: string } = null;

  if (profile && (kind === "call" || isEmail)) {
    const [contacts, memory] = await Promise.all([contactsForLead(lead.id), memoryForLead(lead.id)]);
    const kit = buildOutreachKit({ lead, profile, settings, contacts, memoryLines: memoryReferences(memory).map((r) => r.sentence) });
    contactName = kit.decisionMaker.primary?.name ?? "";
    firstQuestion = kit.discovery?.questions?.[0]?.question ?? null;
    if (isEmail) {
      const email = kind === "follow-up" ? kit.followUp : kit.email;
      const paras = email.paragraphs;
      const secs = Math.round(readingSeconds(email.body));
      const html = renderPersonalEmailHtml({ email, settings, unsubscribeUrl: "https://outreach.artifexlabs.tech/api/comms/unsubscribe" });
      emailProps = {
        subject: email.subject,
        openingSentence: paras[1] ?? paras[0] ?? email.subject,
        readingLabel: secs < 60 ? `~${Math.max(5, secs)}s read` : `~${Math.round(secs / 60)} min read`,
        fullParagraphs: paras,
        contact: contactName,
        html,
      };
    }
  }
  const videoScript = kind === "video" && profile ? buildVideoScript(lead, profile) : null;
  const action = ACTION[kind];

  const Header = (
    <>
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Exit batch" className="rounded-lg p-1.5 text-chalk-500 hover:bg-white/[0.06] hover:text-chalk-200"><X size={18} /></Link>
        <div className="flex flex-1 items-center gap-2">
          <Icon size={15} className="text-amber-300" />
          <span className="text-[13px] font-medium text-chalk-200">{title}</span>
          <span className="ml-auto text-[12px] tabular-nums text-chalk-500">{i + 1} of {total}</span>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-amber-400/80 transition-all" style={{ width: `${(i / total) * 100}%` }} />
      </div>
    </>
  );

  const Observations = observations.length > 0 && (
    <div className="mt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What stood out</p>
      <ul className="mt-1.5 space-y-1.5">
        {observations.map((o, k) => <li key={k} className="flex gap-2 text-[13.5px] text-chalk-300"><span className="mt-0.5 text-amber-300">→</span><span>{o}</span></li>)}
      </ul>
    </div>
  );

  // Email keeps its own inline decision + advance.
  if (isEmail && emailProps) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        {Header}
        <EmailDecision
          leadId={lead.id} mode={kind === "follow-up" ? "followup" : "intro"}
          business={lead.businessName} industry={deslug(lead.industry)} contact={emailProps.contact}
          why={why} observations={observations} subject={emailProps.subject} openingSentence={emailProps.openingSentence}
          readingLabel={emailProps.readingLabel} fullParagraphs={emailProps.fullParagraphs} html={emailProps.html}
          taskId={stepTask?.id ?? null} nextHref={nextHref} isLast={i + 1 >= total}
        />
      </div>
    );
  }

  // ── The step body, kind-appropriate. Video + call stay in the loop (no deep-link). ─
  let body: React.ReactNode;
  if (kind === "video" && videoScript) {
    body = (
      <section className="card p-5 sm:p-6">
        <p className="text-[12px] text-chalk-500">Record a video for</p>
        <h1 className="mt-0.5 text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{lead.businessName}</h1>
        <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-chalk-500"><Clock size={12} /> ~{videoScript.estimatedSeconds}s · read it, then record on your phone</p>
        <div className="mt-4 space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
          <p className="text-[14px] leading-relaxed text-chalk-100">{videoScript.opening}</p>
          {videoScript.observations.map((o, k) => <p key={k} className="text-[14px] leading-relaxed text-chalk-200">{o}</p>)}
          <p className="text-[14px] leading-relaxed text-chalk-200">{videoScript.question}</p>
          <p className="text-[14px] leading-relaxed text-chalk-300">{videoScript.close}</p>
        </div>
      </section>
    );
  } else if (kind === "call") {
    const opener = `Hi — is this ${contactName || "the owner"}? I'm Jordan, I run Artifex Labs. I looked at ${lead.businessName} recently and noticed a couple of small things — do you have a quick minute?`;
    body = (
      <section className="card p-5 sm:p-6">
        <p className="text-[12px] text-chalk-500">Call</p>
        <h1 className="mt-0.5 text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{lead.businessName}</h1>
        <p className="mt-0.5 text-[12.5px] text-chalk-500">{[contactName, lead.phone].filter(Boolean).join(" · ") || "No direct contact on file"}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-chalk-300">{why}</p>
        {Observations}
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">A natural way in</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-200">“{opener}”</p>
          {firstQuestion && <p className="mt-2 text-[13px] text-chalk-400">Then ask: “{firstQuestion}”</p>}
        </div>
        {lead.phone
          ? <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="btn-primary mt-5 w-full justify-center !py-3 text-[15px]"><Phone size={16} /> Call now</a>
          : <Link href={`/leads/${lead.id}`} className="btn-secondary mt-5 w-full justify-center !py-2.5 text-[14px]">Find a number →</Link>}
      </section>
    );
  } else {
    // "understand" is a read, not a hand-off: the concise brief IS the work, so depth is
    // an optional secondary and "Done — next" carries the loop forward. "report" opens the
    // full review (a document that can't live in a card), but we carry the batch's next stop
    // so the operator returns to the loop instead of the dashboard.
    const staysInLoop = kind === "understand";
    const deepHref = kind === "report" ? `${action.href(lead.id)}?next=${encodeURIComponent(nextHref)}` : action.href(lead.id);
    body = (
      <section className="card p-5 sm:p-6">
        <p className="text-[12px] text-chalk-500">{action.verb}</p>
        <h1 className="mt-0.5 text-[1.4rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{lead.businessName}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-chalk-300">{why}</p>
        {Observations}
        <Link href={deepHref} className={`${staysInLoop ? "btn-secondary" : "btn-primary"} mt-5 w-full justify-center !py-3 text-[15px]`}>{action.label} <ArrowRight size={17} /></Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {Header}
      {body}
      <BatchAdvance taskId={stepTask?.id ?? null} nextHref={nextHref} isLast={i + 1 >= total} />
      <p className="text-center text-[11px] text-chalk-600">{i + 1} of {total} · the batch stays put while you work</p>
    </div>
  );
}
