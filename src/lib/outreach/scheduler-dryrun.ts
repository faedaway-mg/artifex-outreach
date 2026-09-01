// ─────────────────────────────────────────────────────────────────────────────
// Authenticated DRY-RUN evaluation of the scheduled-outreach runner. It answers "what WOULD the cron
// do right now?" by running the exact production selection + every dispatch-time check, and returns a
// breakdown — WITHOUT the ability to send. It is READ-ONLY and TRANSPORT-FREE by construction:
//   • it never imports the provider / submitCompliantDispatch — Resend cannot be reached from here;
//   • it never reserves, consumes, or releases a quota slot, never writes an email_sends row, never
//     mutates a scheduled binding, and never appends a send receipt.
// The only writes anywhere in scheduling are in the LIVE runner (outreach-scheduler.runScheduledOutreach),
// which this module does not call. Result carries dryRun:true.
// ─────────────────────────────────────────────────────────────────────────────
import type { SendingWindow } from "../types";
import { dueScheduled, validateScheduled } from "./scheduled-batch";
import { withinMorningWindow, DAILY_CAP } from "./outreach-scheduler";
import { allowedColdRecipient } from "../comms/outreach-transport";
import { countSlotsUsed } from "../comms/send-quota";
import { laParts } from "./sending-window";

export interface DryRunResult {
  dryRun: true;
  laTime: string;                 // human LA datetime the app evaluated
  inWindow: boolean;              // is `now` inside the LA weekday window?
  window: { tz: string; startHour: number; endHour: number; weekdays: number[] };
  due: number;                    // scheduled bindings whose staggered time has arrived
  eligible: number;               // would pass EVERY dispatch-time check right now
  wouldSend: number;              // eligible, capped by remaining daily quota, only if inWindow
  blocked: { count: number; reasons: Record<string, number> };
  quota: { cap: number; usedToday: number; remaining: number };
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/**
 * Evaluate — never dispatch. Mirrors the runner's gates: LA window → per-item re-verification
 * (recipient/suppression/drift/template/CTA via validateScheduled) → provider-neutral recipient gate
 * → shared LA-day quota. Returns the counts and the aggregate block reasons. No side effects.
 */
export async function evaluateScheduledDryRun(now: Date, window: SendingWindow, cap: number = DAILY_CAP): Promise<DryRunResult> {
  const p = laParts(now, window.timezone);
  const laTime = `${window.timezone} ${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:00 (${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday]})`;
  const inWindow = withinMorningWindow(now, window.timezone, window);

  const due = await dueScheduled(now);
  const usedToday = await countSlotsUsed(now);
  const remaining = Math.max(0, cap - usedToday);

  const reasons: Record<string, number> = {};
  let eligible = 0;

  if (!inWindow) {
    // Outside the LA window the runner dispatches NOTHING — every due item is safely a no-send.
    for (const _ of due) bump(reasons, "outside-window");
  } else {
    for (const { leadId, binding } of due) {
      const valid = await validateScheduled(leadId, binding);
      if (!valid.ok) { bump(reasons, valid.reason ?? "invalid"); continue; }
      const gate = allowedColdRecipient(binding.recipient);
      if (!gate.ok) { bump(reasons, "recipient-gate"); continue; }
      eligible += 1;
    }
  }

  const wouldSend = inWindow ? Math.min(eligible, remaining) : 0;
  if (inWindow && eligible > wouldSend) for (let i = 0; i < eligible - wouldSend; i++) bump(reasons, "quota-reached");

  const blockedCount = Object.values(reasons).reduce((a, b) => a + b, 0);
  return {
    dryRun: true,
    laTime,
    inWindow,
    window: { tz: window.timezone, startHour: window.startHour, endHour: window.endHour, weekdays: window.weekdays },
    due: due.length,
    eligible,
    wouldSend,
    blocked: { count: blockedCount, reasons },
    quota: { cap, usedToday, remaining },
  };
}
