// ─────────────────────────────────────────────────────────────────────────────
// Owner-facing SCHEDULER runtime status. The verdict (Active / Inactive / Degraded) is derived from
// whether the CRON has actually checked in recently — NOT inferred from the presence of scheduled DB
// rows. If no cron invocation has been recorded within the freshness horizon, the scheduler is
// Inactive, even if bindings exist. Read-only; exposes no secrets or full recipient addresses.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, allEmailSends, listAudit } from "../repo";
import { resolveSendingWindow, nextSendingDateKey, laParts } from "./sending-window";
import { DAILY_CAP } from "./outreach-scheduler";
import { listScheduledBindings, dueScheduled } from "./scheduled-batch";
import { outreachPausedNow } from "./outreach-pause";
import { emailsSentOn } from "./send-capacity";

const RUNNER_ACTIONS = new Set(["outreach.runner.dispatched", "outreach.runner.delivery-blocked"]);
// A cron that hasn't checked in within this many minutes is not considered live.
const FRESH_MINUTES = 90;

export type SchedulerVerdict = "Active" | "Inactive" | "Degraded";

export interface SchedulerStatus {
  verdict: SchedulerVerdict;
  provider: "Resend";
  window: { tz: string; startHour: number; endHour: number; label: string };
  weekdaysLabel: string;
  dailyCap: number;
  paused: boolean;
  autosendEnabled: boolean;
  prospectDeliveryEnabled: boolean;
  scheduledTotal: number;      // persisted bindings awaiting their window
  dueNow: number;              // bindings whose staggered time has already arrived
  sentToday: number;
  remainingToday: number;
  nextCronWakeup: string | null;   // ISO — next Railway wake (UTC), null if unknowable
  nextEligibleWindow: string;      // human LA label for the next window open
  lastInvocationAt: string | null; // last time the cron hit the endpoint (any outcome)
  lastDispatchAt: string | null;   // last time a real send actually happened
  lastError: string | null;
}

/** The next UTC instant the cron wakes (every 5 min, hours 12–15 UTC, Mon–Fri) at/after `now`, or null. */
export function nextCronWakeup(now: Date): string | null {
  const t = new Date(Math.ceil(now.getTime() / 300000) * 300000); // round up to the next 5-min boundary
  for (let i = 0; i < 2016; i++) { // up to a week of 5-min steps
    const dow = t.getUTCDay();
    const hr = t.getUTCHours();
    if (dow >= 1 && dow <= 5 && hr >= 12 && hr <= 15) return t.toISOString();
    t.setUTCMinutes(t.getUTCMinutes() + 5);
  }
  return null;
}

export async function getSchedulerStatus(now: Date = new Date()): Promise<SchedulerStatus> {
  const [settings, sends, audit, bindings, due, paused] = await Promise.all([
    getSettings(), allEmailSends(), listAudit(200), listScheduledBindings(), dueScheduled(now), outreachPausedNow(),
  ]);
  const window = resolveSendingWindow(settings);
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

  const invocations = audit.filter((a) => RUNNER_ACTIONS.has(a.action));
  const lastInvocation = invocations[0] ?? null; // listAudit returns newest-first
  const lastDispatch = audit.find((a) => a.action === "outreach.runner.dispatched" && Number((a.meta as any)?.sent ?? 0) > 0) ?? null;
  const lastInvocationAt = lastInvocation?.createdAt ?? null;

  // Verdict is about the EXECUTOR, not the data. No recent check-in ⇒ Inactive (even with bindings).
  let verdict: SchedulerVerdict = "Inactive";
  if (lastInvocationAt) {
    const ageMin = (now.getTime() - new Date(lastInvocationAt).getTime()) / 60000;
    verdict = ageMin <= FRESH_MINUTES ? "Active" : "Degraded";
  }

  const sentToday = emailsSentOn(sends, now);
  const p = laParts(now, window.timezone);
  const nextKey = nextSendingDateKey(now, window);

  return {
    verdict,
    provider: "Resend",
    window: { tz: window.timezone, startHour: window.startHour, endHour: window.endHour, label: `${hh(window.startHour)}–${hh(window.endHour)} ${window.timezone}` },
    weekdaysLabel: "Monday–Friday",
    dailyCap: DAILY_CAP,
    paused,
    autosendEnabled: process.env.QR_AUTOSEND_ENABLED === "1",
    prospectDeliveryEnabled: process.env.COMMS_PROSPECT_DELIVERY_ENABLED === "1",
    scheduledTotal: bindings.length,
    dueNow: due.length,
    sentToday,
    remainingToday: Math.max(0, DAILY_CAP - sentToday),
    nextCronWakeup: nextCronWakeup(now),
    nextEligibleWindow: `${nextKey} ${hh(window.startHour)} ${window.timezone}` + (nextKey === `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` ? " (today)" : ""),
    lastInvocationAt,
    lastDispatchAt: lastDispatch?.createdAt ?? null,
    lastError: null,
  };
}
