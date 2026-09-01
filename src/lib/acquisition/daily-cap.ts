// Acquisition OS — GLOBAL daily send cap (nationwide-refill mandate, §5).
//
// One authoritative accounting date (America/Los_Angeles) governs a single shared ceiling of 20 total
// PROSPECT messages, across initial outreach + scheduled follow-ups + manual prospect sends, in every US
// timezone. No timezone boundary may let a 21st prospect message go out on the same global cap day. This
// module is pure accounting: the caller supplies how many have already been sent on the LA date, and it
// answers how many remain — the dispatch/scheduler boundary consults it before every prospect send.

export const GLOBAL_DAILY_CAP = 20;
export const CAP_TIMEZONE = "America/Los_Angeles";

// The authoritative accounting date: the YYYY-MM-DD calendar date in America/Los_Angeles for `now`. A send
// in Boston at 02:00 ET and a send in LA at 23:00 PT can fall on the SAME LA date — that's the point.
export function laAccountingDate(now: Date, timezone: string = CAP_TIMEZONE): string {
  // en-CA yields ISO YYYY-MM-DD; formatting in the cap timezone gives the LA calendar date.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// The UTC instants bounding the LA accounting date for `now` — [startIso, endIso). The send-count query
// counts prospect sends whose sentAt falls in this half-open range, so the cap is measured on ONE LA day.
export function laDayBoundsUtc(now: Date, timezone: string = CAP_TIMEZONE): { startIso: string; endIso: string; date: string } {
  const date = laAccountingDate(now, timezone); // YYYY-MM-DD in LA
  const [y, m, d] = date.split("-").map(Number);
  // Find the UTC instant of local midnight for that LA date (two-pass to settle DST).
  const off = (at: Date): number => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(at).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour === 24 ? 0 : +p.hour), +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  };
  let start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 2; i++) start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - off(start) * 60000);
  const end = new Date(start.getTime() + 86400000);
  return { startIso: start.toISOString(), endIso: end.toISOString(), date };
}

export interface CapState {
  accountingDate: string;   // the LA date this accounting is for
  cap: number;              // 20
  sent: number;             // prospect messages already sent on this LA date (all channels/timezones)
  remaining: number;        // max(0, cap - sent)
  atCap: boolean;           // true when nothing more may go out today
}

// Compute the shared-cap state for the LA accounting date. `sentOnDate` MUST already be the global count of
// prospect messages sent on that LA date (initial + follow-up + manual), not a per-timezone slice.
export function capState(now: Date, sentOnDate: number, cap: number = GLOBAL_DAILY_CAP, timezone: string = CAP_TIMEZONE): CapState {
  const accountingDate = laAccountingDate(now, timezone);
  const sent = Math.max(0, sentOnDate);
  const remaining = Math.max(0, cap - sent);
  return { accountingDate, cap, sent, remaining, atCap: remaining <= 0 };
}

// The hard admission decision for ONE prospect send at dispatch time: allowed only while the global count is
// strictly under the cap. Used by the scheduler/dispatch boundary so no path can exceed 20 on the LA date.
export function admitOneSend(now: Date, sentOnDate: number, cap: number = GLOBAL_DAILY_CAP): { admit: boolean; state: CapState } {
  const state = capState(now, sentOnDate, cap);
  return { admit: state.remaining > 0, state };
}
