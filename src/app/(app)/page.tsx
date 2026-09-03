import Link from "next/link";
import { Mic, AlertTriangle, CalendarClock, Send, MessageSquareReply, Ban, ArrowRight, CircleCheck } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";

export const dynamic = "force-dynamic";

// Hard-simplification (mandate III): Today is ONLY these sections, all from the ONE canonical company
// snapshot — no carousels, no mission copy, no pipeline counts, no wall-of-text, no duplicate status.
// NEEDS YOU · READY · SCHEDULED · SENT · REPLIES · BLOCKED. Everything automatic stays in the backend.
export default async function TodayPage() {
  const snap = await buildCompanySnapshot();
  const c = snap.counts;
  const firstFocus = snap.focusQueueIds[0] ?? null;
  const firstAttention = snap.needsAttention[0]?.leadId ?? null;
  const nextScheduled = [...snap.scheduled].sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))[0];
  const nextSchedLabel = nextScheduled ? new Date(nextScheduled.scheduledAt).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : null;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="eyebrow">{today} · Today</p>

      {/* NEEDS YOU — opens the one-company-at-a-time focused workflow */}
      <Section title="Needs you">
        <Row
          href={firstFocus ? `/company/${firstFocus}` : undefined}
          label="Record voiceovers"
          count={c.needsVoiceover}
          icon={<Mic size={16} className="text-amber-300" />}
          hint={c.needsVoiceover > 0 ? "Upload a voiceover and the rest is automatic" : "None waiting on you"}
        />
        <Row
          href={c.needsAttention > 0 ? `/needs-attention` : undefined}
          label="Needs attention"
          count={c.needsAttention}
          icon={<AlertTriangle size={16} className="text-coral-300" />}
          hint={c.needsAttention > 0 ? "A render, package, or send failed — open to resolve" : "Nothing needs a fix"}
        />
      </Section>

      {/* READY — one button to the compact batch preview + approve-and-schedule-all */}
      <Section title="Ready">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="text-[14px] text-chalk-100">Packages ready to schedule</div>
            <div className="text-[12px] text-chalk-500">Next sending window: {snap.nextDateLabel}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums text-teal-300">{c.readyToSchedule}</span>
            {c.readyToSchedule > 0 && <Link href="/schedule" className="btn-primary text-xs"><CalendarClock size={13} /> Review and schedule</Link>}
          </div>
        </div>
      </Section>

      {/* SCHEDULED — count + next time + concise list */}
      <Section title="Scheduled">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="text-[14px] text-chalk-100">Scheduled to send</div>
            <div className="text-[12px] text-chalk-500">{nextSchedLabel ? `Next: ${nextSchedLabel}` : "Nothing scheduled"}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums text-azure-300">{c.scheduled}</span>
            {c.scheduled > 0 && <Link href="/sent" className="btn-ghost text-xs">View <ArrowRight size={13} /></Link>}
          </div>
        </div>
      </Section>

      {/* SENT — today's sends, provider state unambiguous */}
      <Section title="Sent today">
        {snap.sentToday.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-chalk-500">Nothing sent today.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {snap.sentToday.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate text-[13px] text-chalk-200">{r.business}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-chalk-500"><ProviderBadge state={r.providerState} /> {r.when} PT</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* REPLIES — only those that actually need Jordan */}
      {c.replies > 0 && (
        <Section title="Replies">
          <ul className="divide-y divide-white/5">
            {snap.replies.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate text-[13px] text-chalk-200">{r.business}</span>
                <Link href={`/meetings`} className="btn-ghost shrink-0 text-xs"><MessageSquareReply size={13} /> Open</Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* BLOCKED — one clickable number, never 80 lead pages */}
      <Link href="/blocked" className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]">
        <span className="flex items-center gap-2 text-[14px] text-chalk-200"><Ban size={16} className="text-chalk-500" /> Blocked</span>
        <span className="flex items-center gap-2"><span className="text-xl font-semibold tabular-nums text-chalk-300">{c.blocked}</span><ArrowRight size={14} className="text-chalk-500" /></span>
      </Link>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-chalk-500">{title}</div>
      <div className="divide-y divide-white/5">{children}</div>
    </section>
  );
}

function Row({ href, label, count, icon, hint }: { href?: string; label: string; count: number; icon: React.ReactNode; hint: string }) {
  const inner = (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">{icon}<div className="min-w-0"><div className="text-[14px] text-chalk-100">{label}</div><div className="truncate text-[12px] text-chalk-500">{hint}</div></div></div>
      <div className="flex items-center gap-2"><span className="text-2xl font-semibold tabular-nums text-chalk-100">{count}</span>{href && <ArrowRight size={14} className="text-chalk-500" />}</div>
    </div>
  );
  return href ? <Link href={href} className="block transition-colors hover:bg-white/[0.04]">{inner}</Link> : <div className="opacity-70">{inner}</div>;
}

function ProviderBadge({ state }: { state: string }) {
  const map: Record<string, { t: string; cls: string }> = {
    delivered: { t: "Delivered", cls: "text-teal-300" },
    sent: { t: "Provider accepted", cls: "text-azure-300" },
    sending: { t: "Sending", cls: "text-azure-300" },
    queued: { t: "Scheduled", cls: "text-chalk-400" },
    bounced: { t: "Bounced", cls: "text-coral-300" },
    complained: { t: "Complained", cls: "text-coral-300" },
    opened: { t: "Opened", cls: "text-teal-300" },
    clicked: { t: "Clicked", cls: "text-teal-300" },
    failed: { t: "Failed", cls: "text-coral-300" },
  };
  const m = map[state] ?? { t: state, cls: "text-chalk-400" };
  return <span className={`inline-flex items-center gap-1 ${m.cls}`}><CircleCheck size={11} /> {m.t}</span>;
}
