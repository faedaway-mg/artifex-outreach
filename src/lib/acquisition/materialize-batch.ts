// Acquisition OS — DAILY MATERIALIZATION (nationwide-refill mandate, §4).
//
// Before a sending day, pick up to 20 of the STRONGEST delivery-ready leads while preserving geographic
// diversity, and schedule each in its OWN recipient-local 08:00–10:00 weekday window. The global cap (§5)
// still binds: we never select more than the shared 20/day remaining. This module is pure — it decides
// WHAT to schedule and WHEN, but writes nothing and sends nothing (freezing + enqueue happen in the caller
// against the existing frozen-review + emailSends machinery).

import type { DeliveryContext } from "./delivery-ready";

// US state/territory → dominant IANA timezone (multi-zone states use the zone covering most population).
// Recipient-local scheduling needs a concrete zone; the lead's state is the coarse-but-reliable signal.
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago",
  KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles",
  NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York",
  NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

export function resolveTimezone(state: string | null | undefined): string | null {
  if (!state) return null;
  const key = state.trim().toUpperCase();
  return STATE_TZ[key] ?? null;
}

export interface RecipientWindow { startHour: number; endHour: number; weekdays: number[] } // weekday: 0=Sun
export const RECIPIENT_WINDOW: RecipientWindow = { startHour: 8, endHour: 10, weekdays: [1, 2, 3, 4, 5] };

// Hour (0-23) + weekday (0=Sun) for an instant in an IANA timezone.
function zonedParts(at: Date, tz: string): { y: number; m: number; d: number; hour: number; weekday: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  let hour = parseInt(get("hour"), 10); if (hour === 24) hour = 0;
  return { y: +get("year"), m: +get("month"), d: +get("day"), hour, weekday: wd };
}

// The UTC offset (minutes) of a timezone at a given instant — lets us map a desired local wall-clock time
// back to a UTC instant without a tz library.
function offsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour === 24 ? 0 : +p.hour), +p.minute, +p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

// The UTC instant for a given local wall-clock (y,m,d,hour,minute) in `tz`. Two-pass to settle DST.
function localWallToUtc(tz: string, y: number, m: number, d: number, hour: number, minute: number): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  for (let i = 0; i < 2; i++) {
    const off = offsetMinutes(guess, tz);
    guess = new Date(Date.UTC(y, m - 1, d, hour, minute) - off * 60000);
  }
  return guess;
}

/** The next recipient-local slot at/after `now` inside the 08:00–10:00 weekday window for `tz`. `index`
 *  spreads sends across the two-hour window (deterministic, avoids bunching every send at exactly 08:00). */
export function nextRecipientSlot(now: Date, tz: string, index = 0, window: RecipientWindow = RECIPIENT_WINDOW): Date {
  const spanMin = Math.max(1, (window.endHour - window.startHour) * 60 - 1); // stay strictly before endHour
  const minuteOffset = ((index * 17) % spanMin);                            // 17-min stride → even spread
  const hour = window.startHour + Math.floor(minuteOffset / 60);
  const minute = minuteOffset % 60;
  // Walk day by day (max 8) until we land a weekday whose window hasn't fully passed.
  for (let addDays = 0; addDays < 8; addDays++) {
    const probe = new Date(now.getTime() + addDays * 86400000);
    const { y, m, d, weekday } = zonedParts(probe, tz);
    if (!window.weekdays.includes(weekday)) continue;
    const slot = localWallToUtc(tz, y, m, d, hour, minute);
    if (slot.getTime() >= now.getTime()) return slot; // today only if the slot is still ahead
  }
  // Fallback (unreachable in practice): one day out at window start.
  const p = zonedParts(new Date(now.getTime() + 86400000), tz);
  return localWallToUtc(tz, p.y, p.m, p.d, window.startHour, minute);
}

export interface MaterializedPick {
  leadId: string;
  businessName: string;
  state: string | null;
  timezone: string;
  score: number;
  scheduledAt: string;    // ISO UTC instant inside the recipient-local window
  localWindow: string;    // human "08:00–10:00 America/New_York" for the audit/report
}

export interface BatchPlan {
  picks: MaterializedPick[];
  requested: number;      // how many we were allowed to take (min of cap-remaining, dailyTarget)
  selected: number;       // how many we actually scheduled
  shortfall: number;      // requested - selected (honest §6)
  byState: Record<string, number>;
}

/** Select up to `dailyTarget` strongest ready leads, capped by the global remaining, preserving geographic
 *  diversity (round-robin across states so one metro can't fill the batch). Pure. Only fully DELIVERY_READY
 *  contexts should be passed in (the caller filters with assessDeliveryReadiness first). */
export function selectDailyBatch(
  ready: DeliveryContext[],
  opts: { now: Date; dailyTarget: number; capRemaining: number },
): BatchPlan {
  const requested = Math.max(0, Math.min(opts.dailyTarget, opts.capRemaining));
  // Bucket by state, each bucket strongest-first.
  const buckets = new Map<string, DeliveryContext[]>();
  for (const c of [...ready].sort((a, b) => b.score - a.score)) {
    const k = (c.state || "??").toUpperCase();
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(c);
  }
  // Round-robin across state buckets (buckets ordered by their strongest lead) → geographic diversity.
  const order = [...buckets.entries()].sort((a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0)).map((e) => e[0]);
  const picked: DeliveryContext[] = [];
  let progressed = true;
  while (picked.length < requested && progressed) {
    progressed = false;
    for (const st of order) {
      if (picked.length >= requested) break;
      const next = buckets.get(st)!.shift();
      if (next) { picked.push(next); progressed = true; }
    }
  }
  const byState: Record<string, number> = {};
  const picks: MaterializedPick[] = picked.map((c, i) => {
    const tz = c.recipientTimezone || resolveTimezone(c.state) || "America/Los_Angeles";
    const slot = nextRecipientSlot(opts.now, tz, i);
    byState[(c.state || "??").toUpperCase()] = (byState[(c.state || "??").toUpperCase()] ?? 0) + 1;
    return { leadId: c.leadId, businessName: c.businessName, state: c.state, timezone: tz, score: c.score, scheduledAt: slot.toISOString(), localWindow: `08:00–10:00 ${tz}` };
  });
  return { picks, requested, selected: picks.length, shortfall: requested - picks.length, byState };
}
