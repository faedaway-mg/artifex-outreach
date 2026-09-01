"use client";
// Owner-facing Scheduler card — shows whether AUTOMATION is genuinely running (from the cron's last
// check-in, not from scheduled DB rows), the LA window/cap, today's throughput, next wake, and a
// pause/resume control. No secrets, no full recipient addresses.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Pause, Play, CircleCheck, CircleAlert, CircleDot } from "lucide-react";
import { pauseSchedulerAction, resumeSchedulerAction } from "@/lib/outreach/scheduler-actions";
import type { SchedulerStatus } from "@/lib/outreach/scheduler-status";

const fmt = (iso: string | null, tz = "America/Los_Angeles") =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "—";

export function SchedulerStatusCard({ status }: { status: SchedulerStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [paused, setPaused] = useState(status.paused);

  const verdict = status.verdict;
  const tone =
    verdict === "Active" && !paused ? { icon: <CircleCheck size={16} className="text-teal-300" />, text: "text-teal-200", label: "Active" }
      : verdict === "Degraded" ? { icon: <CircleAlert size={16} className="text-amber-300" />, text: "text-amber-200", label: "Degraded" }
        : { icon: <CircleDot size={16} className="text-chalk-400" />, text: "text-chalk-300", label: paused ? "Paused" : "Inactive" };

  const toggle = () =>
    start(async () => {
      const res = paused ? await resumeSchedulerAction() : await pauseSchedulerAction();
      setPaused(res.paused);
      router.refresh();
    });

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3 py-1"><span className="text-[12px] text-chalk-500">{k}</span><span className="text-[12.5px] tabular-nums text-chalk-200 text-right">{v}</span></div>
  );

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <CalendarClock size={17} className="text-gold-300" />
        <h2 className="text-[15px] font-semibold text-chalk-50">Scheduler</h2>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[12px] font-medium ${tone.text}`}>{tone.icon} {tone.label}</span>
      </div>

      {verdict === "Inactive" && !paused && (
        <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[12px] text-chalk-400">
          No cron check-in recorded recently. Scheduled rows may exist, but no autonomous process is
          invoking the dispatch runner yet — deploy the outreach-send cron service to make it Active.
        </p>
      )}

      <div className="mt-3 divide-y divide-white/[0.05]">
        <Row k="Delivery provider" v={status.provider} />
        <Row k="Sending window" v={status.window.label} />
        <Row k="Weekdays" v={status.weekdaysLabel} />
        <Row k="Daily cap" v={status.dailyCap} />
        <Row k="Sent today" v={`${status.sentToday} / ${status.dailyCap}`} />
        <Row k="Remaining today" v={status.remainingToday} />
        <Row k="Scheduled (awaiting window)" v={status.scheduledTotal} />
        <Row k="Due right now" v={status.dueNow} />
        <Row k="Next scheduler wakeup" v={fmt(status.nextCronWakeup)} />
        <Row k="Next eligible window" v={status.nextEligibleWindow} />
        <Row k="Last cron invocation" v={fmt(status.lastInvocationAt)} />
        <Row k="Last successful dispatch" v={fmt(status.lastDispatchAt)} />
        <Row k="Prospect delivery gate" v={status.prospectDeliveryEnabled ? "Enabled" : "Test address only"} />
        <Row k="Auto-send" v={status.autosendEnabled ? "Enabled" : "Off"} />
        {status.lastError && <Row k="Last error" v={<span className="text-amber-300">{status.lastError}</span>} />}
      </div>

      <button onClick={toggle} disabled={pending} className="btn-secondary mt-4 w-full justify-center !py-2.5 text-[13.5px] disabled:opacity-50">
        {paused ? <><Play size={15} /> Resume scheduling</> : <><Pause size={15} /> Pause scheduling</>}
      </button>
    </section>
  );
}
