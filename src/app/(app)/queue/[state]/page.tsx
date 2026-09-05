import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft, ArrowRight, Mic, Sparkles, CalendarClock, Mail, MessageSquare, AlertTriangle, CheckCircle2 } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { latestProspectPackage, packageShareUrl } from "@/lib/outreach/prospect-package-store";
import { attentionAck } from "@/lib/outreach/attention-actions";
import { listAudit } from "@/lib/repo";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";
import { ReadyApproveCard } from "@/components/queue/ReadyApproveCard";
import { AttentionCard } from "@/components/queue/AttentionCard";

export const dynamic = "force-dynamic";

// ONE tap-to-filter queue (mandate 15 Parts 1/2/3/6). Every Today count opens /queue/<state>: a bounded,
// independently-scrollable list whose visible count EQUALS the canonical count. URL-addressable (survives
// refresh/Back), obvious selected filter, honest empty states, always a Back path. All counts come from the
// ONE canonical snapshot — the list shows exactly the records behind the tapped number.
type StateKey = "voiceover" | "rendering" | "ready" | "attention" | "scheduled" | "sent" | "replies";
const ORDER: StateKey[] = ["voiceover", "rendering", "ready", "attention", "scheduled", "sent", "replies"];
const META: Record<StateKey, { title: string; icon: any; accent: string }> = {
  voiceover: { title: "Record voiceovers", icon: Mic, accent: "text-amber-300" },
  rendering: { title: "Rendering", icon: Sparkles, accent: "text-teal-300" },
  ready: { title: "Ready to approve", icon: CheckCircle2, accent: "text-teal-300" },
  attention: { title: "Needs attention", icon: AlertTriangle, accent: "text-coral-300" },
  scheduled: { title: "Scheduled", icon: CalendarClock, accent: "text-teal-300" },
  sent: { title: "Sent today", icon: Mail, accent: "text-chalk-300" },
  replies: { title: "Replies", icon: MessageSquare, accent: "text-teal-300" },
};

export default async function QueuePage({ params }: { params: { state: string } }) {
  const state = params.state as StateKey;
  if (!ORDER.includes(state)) notFound();

  const snap = await buildCompanySnapshot();
  const c = snap.counts;
  const countOf: Record<StateKey, number> = {
    voiceover: c.needsVoiceover, rendering: c.rendering, ready: c.readyToSchedule, attention: c.needsAttention,
    scheduled: c.scheduled, sent: c.sentToday, replies: c.replies,
  };

  // Build the base URL (for the signed video share link) from the incoming request.
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const baseUrl = host ? `${proto}://${host}` : (process.env.APP_BASE_URL ?? "");

  const M = META[state];
  const count = countOf[state];

  return (
    <div className="mx-auto max-w-2xl">
      {/* Back path — always present (mandate Part 6). */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-chalk-400 transition-colors hover:text-chalk-200"><ArrowLeft size={15} /> Today</Link>

      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-chalk-50"><M.icon size={20} className={M.accent} /> {M.title} · {count}</h1>

      {/* Filter chips — URL-addressable; the active one is obvious. */}
      <div className="mt-3 -mx-1 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Work states">
        {ORDER.filter((s) => countOf[s] > 0 || s === state).map((s) => {
          const active = s === state;
          return (
            <Link key={s} href={`/queue/${s}`} role="tab" aria-selected={active}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${active ? "border-teal-400/40 bg-teal-400/15 text-teal-100 font-medium" : "border-white/10 bg-white/[0.02] text-chalk-400 hover:text-chalk-200"}`}>
              {META[s].title} <span className="tabular-nums opacity-70">{countOf[s]}</span>
            </Link>
          );
        })}
      </div>

      {/* Bounded, independently-scrollable list (never expands the document). */}
      <div data-queue-list className="mt-4 max-h-[calc(100dvh-11rem)] space-y-2.5 overflow-y-auto pb-24">
        {count === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center">
            <M.icon size={22} className={`mx-auto ${M.accent} opacity-70`} />
            <p className="mt-2 text-[14px] text-chalk-200">Nothing in {M.title.toLowerCase()}.</p>
            <p className="text-[12.5px] text-chalk-500">New work appears here automatically.</p>
          </div>
        ) : state === "ready" ? (
          await Promise.all(snap.ready.map(async (r) => {
            const pkg = await latestProspectPackage(r.leadId).catch(() => null);
            const shareHref = pkg?.share ? packageShareUrl(pkg, baseUrl) : null;
            return <ReadyApproveCard key={r.leadId} leadId={r.leadId} business={r.business} recipient={r.recipient ?? "—"}
              state="READY_TO_APPROVE" packageVersion={pkg?.packageVersion ?? null} subject={pkg?.subject ?? null}
              bodyText={pkg?.bodyText ?? null} shareHref={shareHref} hasVideo={!!pkg?.video} pdfHref={`/api/quick-review/${r.leadId}/pdf`} />;
          }))
        ) : state === "attention" ? (
          await (async () => {
            const audit = await listAudit(5000);
            return Promise.all(snap.needsAttention.map(async (r) => {
              const ack = await attentionAck(r.leadId, audit as Array<{ action?: string; targetId?: string }>);
              return <AttentionCard key={r.leadId} leadId={r.leadId} business={r.business} reason={r.failReason ?? "Needs a human decision."} ack={ack} />;
            }));
          })()
        ) : state === "scheduled" ? (
          snap.scheduled.map((r) => (
            <Row key={r.leadId} leadId={r.leadId} business={r.business}
              sub={`${r.recipient} · ${new Date(r.scheduledAt).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} PT`} />
          ))
        ) : state === "sent" ? (
          snap.sentToday.map((r) => <Row key={r.leadId} leadId={r.leadId} business={r.business} sub={`${r.when} · ${r.providerState}`} noLink />)
        ) : state === "replies" ? (
          snap.replies.map((r) => <Row key={r.leadId} leadId={r.leadId} business={r.business} sub={r.when ? `Replied ${r.when}` : "Replied"} href={`/meetings`} />)
        ) : (
          // voiceover + rendering
          (state === "voiceover" ? snap.needsVoiceover : snap.rendering).map((r) => (
            <Row key={r.leadId} leadId={r.leadId} business={r.business} sub={r.finding ?? (state === "rendering" ? "Finishing…" : "Ready to record")} href={`/company/${r.leadId}`} />
          ))
        )}
      </div>
    </div>
  );
}

function Row({ leadId, business, sub, href, noLink }: { leadId: string; business: string; sub: string; href?: string; noLink?: boolean }) {
  const inner = (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-0">
        <div className="truncate text-[14.5px] text-chalk-100">{business}</div>
        <div className="truncate text-[12.5px] text-chalk-400">{sub}</div>
      </div>
      {!noLink && <ArrowRight size={15} className="shrink-0 text-chalk-500" />}
    </div>
  );
  if (noLink) return inner;
  return <Link href={href ?? `/company/${leadId}`} className="block transition-colors hover:bg-white/[0.02]">{inner}</Link>;
}
