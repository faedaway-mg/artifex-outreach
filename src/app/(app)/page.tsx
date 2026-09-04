import Link from "next/link";
import { Mic, AlertTriangle, CalendarClock, ArrowRight, Sparkles } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { ACCOUNTING_TZ } from "@/lib/outreach/sending-window";

export const dynamic = "force-dynamic";

// Hard-simplified Today (state/hierarchy mandate part 3): render ONLY meaningful, non-empty work. Empty
// sections are hidden entirely. Blocked leads are NOT the operator's workload — they are "automatically
// excluded" and kept visually secondary. One hero action, then schedule, then a compact activity line.
export default async function TodayPage() {
  const snap = await buildCompanySnapshot();
  const c = snap.counts;
  const firstVoiceover = snap.needsVoiceover[0]?.leadId ?? null;
  const nextScheduled = [...snap.scheduled].sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))[0];
  const nextSchedLabel = nextScheduled ? new Date(nextScheduled.scheduledAt).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : null;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const activityBits = [
    c.scheduled > 0 ? `${c.scheduled} scheduled` : null,
    `${c.sentToday} sent today`,
    c.replies > 0 ? `${c.replies} ${c.replies === 1 ? "reply" : "replies"}` : null,
  ].filter(Boolean);
  const nothing = c.needsVoiceover === 0 && c.rendering === 0 && c.readyToSchedule === 0 && c.needsAttention === 0 && c.scheduled === 0 && c.sentToday === 0 && c.replies === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="eyebrow">{today} · Today</p>

      {/* HERO — the one action that needs Jordan now. Only shown when there is genuine voiceover work. */}
      {c.needsVoiceover > 0 && (
        <Link href={firstVoiceover ? `/company/${firstVoiceover}` : "#"} className="block rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5 transition-colors hover:bg-amber-400/[0.09]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Mic size={22} className="text-amber-300" />
              <div>
                <div className="text-xl font-semibold text-chalk-50">{c.needsVoiceover} {c.needsVoiceover === 1 ? "voiceover" : "voiceovers"} ready</div>
                <div className="text-[13px] text-chalk-400">Record and everything else is automatic.</div>
              </div>
            </div>
            <span className="btn-primary text-sm">Start <ArrowRight size={14} /></span>
          </div>
        </Link>
      )}

      {/* RENDERING — voiceover uploaded, video finishing in the background. NOT operator work; informational. */}
      {c.rendering > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[13.5px] text-chalk-300">
          <span className="flex items-center gap-2"><Sparkles size={15} className="text-teal-300/80" /> {c.rendering} {c.rendering === 1 ? "video" : "videos"} rendering</span>
          <span className="text-[12px] text-chalk-500">finishing automatically</span>
        </div>
      )}

      {/* READY to schedule */}
      {c.readyToSchedule > 0 && (
        <Link href="/schedule" className="flex items-center justify-between rounded-xl border border-teal-400/20 bg-teal-400/[0.04] px-4 py-3.5 transition-colors hover:bg-teal-400/[0.08]">
          <span className="flex items-center gap-2 text-[15px] text-chalk-100"><CalendarClock size={17} className="text-teal-300" /> {c.readyToSchedule} {c.readyToSchedule === 1 ? "package" : "packages"} ready to schedule</span>
          <span className="btn-secondary text-xs">Review and schedule <ArrowRight size={13} /></span>
        </Link>
      )}

      {/* Compact activity line (always concise, never a wall). */}
      {(c.scheduled > 0 || c.sentToday > 0 || c.replies > 0) && (
        <Link href="/sent" className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[13.5px] text-chalk-300 transition-colors hover:bg-white/[0.04]">
          <span>{activityBits.join(" · ")}{nextSchedLabel ? ` · next ${nextSchedLabel}` : ""}</span>
          <ArrowRight size={14} className="text-chalk-500" />
        </Link>
      )}

      {/* Needs attention — only when there is a genuine failure. */}
      {c.needsAttention > 0 && (
        <Link href="/needs-attention" className="flex items-center justify-between rounded-xl border border-coral-400/25 bg-coral-400/[0.05] px-4 py-3 transition-colors hover:bg-coral-400/[0.09]">
          <span className="flex items-center gap-2 text-[14px] text-coral-100"><AlertTriangle size={16} className="text-coral-300" /> {c.needsAttention} needs attention</span>
          <ArrowRight size={14} className="text-coral-300/70" />
        </Link>
      )}

      {nothing && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center">
          <Sparkles size={20} className="mx-auto text-teal-300" />
          <p className="mt-2 text-[14px] text-chalk-200">You’re all caught up.</p>
          <p className="text-[12.5px] text-chalk-500">New work appears here automatically.</p>
        </div>
      )}

      {/* Quiet background status — retryable automation (narration/evidence reanalysis). NOT operator work:
          informational only, never a call to action. */}
      {c.reanalyzing > 0 && (
        <p className="px-1 text-[12px] text-chalk-600">{c.reanalyzing} {c.reanalyzing === 1 ? "company is" : "companies are"} being reanalyzed automatically.</p>
      )}

      {/* Automatically excluded — NOT Jordan's workload; secondary, inspectable. */}
      {c.blocked > 0 && (
        <Link href="/blocked" className="flex items-center justify-between px-1 pt-1 text-[12.5px] text-chalk-500 transition-colors hover:text-chalk-300">
          <span>{c.blocked} automatically excluded</span>
          <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}
