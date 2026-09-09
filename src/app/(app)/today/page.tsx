import Link from "next/link";
import { Mic, Sparkles, CheckCircle2, AlertTriangle, CalendarClock, Mail, MessageSquare, ArrowRight } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";

export const dynamic = "force-dynamic";

// Today = a MINIMAL command center (mandate 15 Part 1): one compact, tappable row per NON-EMPTY canonical
// state. Every count opens /queue/<state> — a bounded filtered list whose visible count equals this number.
// Empty states are hidden; backend terminology, funnel stats, and diagnostics are kept off Today.
// Quick-Cash Consolidation: Today is now a SECONDARY surface — the default home is the Quick-Cash workspace.
export default async function TodayPage() {
  const snap = await buildCompanySnapshot();
  const c = snap.counts;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const rows = [
    { key: "voiceover", label: "Record voiceovers", n: c.needsVoiceover, icon: Mic, accent: "text-amber-300", tone: "border-amber-400/25 bg-amber-400/[0.06] hover:bg-amber-400/[0.09]" },
    { key: "rendering", label: "Rendering", n: c.rendering, icon: Sparkles, accent: "text-teal-300", tone: "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]" },
    { key: "ready", label: "Ready to approve", n: c.readyToSchedule, icon: CheckCircle2, accent: "text-teal-300", tone: "border-teal-400/20 bg-teal-400/[0.05] hover:bg-teal-400/[0.09]" },
    { key: "attention", label: "Needs attention", n: c.needsAttention, icon: AlertTriangle, accent: "text-coral-300", tone: "border-coral-400/25 bg-coral-400/[0.05] hover:bg-coral-400/[0.09]" },
    { key: "scheduled", label: "Scheduled", n: c.scheduled, icon: CalendarClock, accent: "text-teal-300", tone: "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]" },
    { key: "sent", label: "Sent today", n: c.sentToday, icon: Mail, accent: "text-chalk-300", tone: "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]" },
    { key: "replies", label: "Replies", n: c.replies, icon: MessageSquare, accent: "text-teal-300", tone: "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]" },
  ].filter((r) => r.n > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-2.5">
      <p className="eyebrow">{today} · Today</p>

      {rows.map((r) => (
        <Link key={r.key} href={`/queue/${r.key}`} className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 transition-colors ${r.tone}`}>
          <span className="flex items-center gap-3">
            <r.icon size={20} className={r.accent} />
            <span className="text-[15.5px] text-chalk-50">{r.label}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums text-chalk-50">{r.n}</span>
            <ArrowRight size={15} className="text-chalk-500" />
          </span>
        </Link>
      ))}

      {rows.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-10 text-center">
          <Sparkles size={20} className="mx-auto text-teal-300" />
          <p className="mt-2 text-[14px] text-chalk-200">You’re all caught up.</p>
          <p className="text-[12.5px] text-chalk-500">New work appears here automatically.</p>
        </div>
      )}

      {/* Quiet background status — automatic reanalysis. Not operator work. */}
      {c.reanalyzing > 0 && (
        <p className="px-1 pt-1 text-[12px] text-chalk-600">{c.reanalyzing} {c.reanalyzing === 1 ? "company is" : "companies are"} being prepared automatically.</p>
      )}

      {/* Automatically excluded — secondary, inspectable, never the operator's workload. */}
      {c.blocked > 0 && (
        <Link href="/blocked" className="flex items-center justify-between px-1 pt-1 text-[12.5px] text-chalk-500 transition-colors hover:text-chalk-300">
          <span>{c.blocked} automatically excluded</span>
          <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}
