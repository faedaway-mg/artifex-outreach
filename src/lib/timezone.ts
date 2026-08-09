// ─────────────────────────────────────────────────────────────────────────────
// What time is it where this business is?
//
// The workspace already has businesses in California and Ohio. A queue that
// orders a 7am Pasadena call ahead of a 10am Middletown call is not a scheduling
// preference, it is a wasted morning: one of those numbers rings a locked door.
//
// Three rules this module exists to enforce:
//
//   1. TIME NEVER DECIDES WHO OWNS ANYTHING. Ownership is relationship-driven.
//      Nothing here is imported by the assignment engine, and a test asserts it.
//      Timezone answers WHEN to contact a business, never WHO contacts it.
//
//   2. DAYLIGHT SAVING IS NEVER ARITHMETIC. Every conversion goes through
//      Intl.DateTimeFormat with an IANA zone, so "America/Los_Angeles" is
//      -8 or -7 because the platform's tz database says so — not because we
//      stored an offset that will be wrong twice a year. Arizona is correct for
//      free, which is the whole argument for zones over offsets.
//
//   3. AN INFERENCE MUST ANNOUNCE ITSELF. Nothing on a lead records its timezone
//      today, so every zone here is DERIVED from the address. The derivation
//      returns its own confidence and its own reason, and the UI shows them,
//      because an operator who is told "closed" deserves to know whether that
//      came from a fact or from a state abbreviation.
//
// Pure. No I/O, no storage, no clock of its own — `now` is always passed in, so
// every function is deterministic under test.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "./types";

export const DEFAULT_ZONE = "America/Los_Angeles";

/** How much to trust a derived zone. */
export type ZoneConfidence = "stored" | "coordinates" | "state" | "state-approximate" | "default";

export interface ZoneInference {
  zone: string;
  confidence: ZoneConfidence;
  /** One sentence an operator can read. */
  because: string;
}

// The 46 unambiguous US states/territories. Split states are handled below.
const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago", AR: "America/Chicago", AZ: "America/Phoenix",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York",
  DC: "America/New_York", DE: "America/New_York", GA: "America/New_York",
  HI: "Pacific/Honolulu", IA: "America/Chicago", IL: "America/Chicago",
  LA: "America/Chicago", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MN: "America/Chicago", MO: "America/Chicago",
  MS: "America/Chicago", MT: "America/Denver", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NV: "America/Los_Angeles", NY: "America/New_York", OH: "America/New_York",
  OK: "America/Chicago", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", UT: "America/Denver", VA: "America/New_York",
  VT: "America/New_York", WA: "America/Los_Angeles", WI: "America/Chicago",
  WV: "America/New_York", WY: "America/Denver", PR: "America/Puerto_Rico",
};

/**
 * States a single abbreviation cannot answer for.
 *
 * THREE fields, not two, and the third is the whole point. An earlier shape had
 * only `dominant` and `west`, which quietly assumed the less-populous half of a
 * split state is always the WESTERN half. That is false for Tennessee (the
 * Eastern-time end is Knoxville, in the east) and for Oregon (the Mountain-time
 * end is Malheur County, also in the east), and both were inverted as a result —
 * Memphis was reported as Eastern and Knoxville as Central. So:
 *
 *   east      the zone for a business at or past the meridian
 *   west      the zone for a business west of it
 *   fallback  what to assume with NO map pin — where most people live, which is
 *             a different question and deserves a different field
 *
 * Approximating a state line with a meridian is wrong at the margins and honest
 * about it: with no pin the confidence is "state-approximate", never "state".
 */
const SPLIT_STATES: Record<string, { east: string; west: string; meridian: number; fallback: string }> = {
  AK: { east: "America/Anchorage", west: "America/Adak", meridian: -169.5, fallback: "America/Anchorage" },
  FL: { east: "America/New_York", west: "America/Chicago", meridian: -85, fallback: "America/New_York" },
  ID: { east: "America/Boise", west: "America/Los_Angeles", meridian: -116.5, fallback: "America/Boise" },
  IN: { east: "America/Indiana/Indianapolis", west: "America/Chicago", meridian: -87.2, fallback: "America/Indiana/Indianapolis" },
  KS: { east: "America/Chicago", west: "America/Denver", meridian: -101.5, fallback: "America/Chicago" },
  KY: { east: "America/New_York", west: "America/Chicago", meridian: -85.5, fallback: "America/New_York" },
  MI: { east: "America/Detroit", west: "America/Menominee", meridian: -87.5, fallback: "America/Detroit" },
  ND: { east: "America/Chicago", west: "America/Denver", meridian: -101, fallback: "America/Chicago" },
  NE: { east: "America/Chicago", west: "America/Denver", meridian: -101, fallback: "America/Chicago" },
  OR: { east: "America/Boise", west: "America/Los_Angeles", meridian: -117.2, fallback: "America/Los_Angeles" },
  SD: { east: "America/Chicago", west: "America/Denver", meridian: -100.5, fallback: "America/Chicago" },
  TN: { east: "America/New_York", west: "America/Chicago", meridian: -85.5, fallback: "America/Chicago" },
  TX: { east: "America/Chicago", west: "America/Denver", meridian: -105, fallback: "America/Chicago" },
};

const isZone = (z: string | null | undefined): z is string => {
  if (!z) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

/**
 * Derive the business's timezone from what the lead already carries.
 *
 * Deliberately NOT cached and NOT stored. It is a map lookup over a 50-entry
 * table — measured in microseconds, called a few dozen times per page — and
 * caching it would mean a migration, a backfill, and a column that goes stale the
 * first time an address is corrected. The moment a business tells us its own
 * timezone, THAT is worth a column; a derivation is not.
 */
/**
 * Recover a two-letter state from a Google-formatted address line.
 *
 * Discovery stores the formatted address verbatim AND parses city/state out of
 * it into their own columns — but that parse has failed on real production rows
 * (four Ohio businesses carry `state = ""` while their address plainly reads
 * "Middletown, OH 45042, USA"). Reading the address is therefore not a guess and
 * not a heuristic: it is the SAME fact, from the copy that did not get lost.
 *
 * Anchored on the "XX 12345" pair so that a two-letter word elsewhere in a
 * street name cannot be mistaken for a state.
 */
export function stateFromAddress(address: string | null | undefined): string | null {
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address ?? "");
  return m ? m[1] : null;
}

export function inferZone(lead: Pick<Lead, "state" | "longitude" | "latitude"> & { address?: string | null }): ZoneInference {
  const stored = (lead.state ?? "").trim().toUpperCase().slice(0, 2);
  const state = stored || (stateFromAddress(lead.address) ?? "");
  const fromAddress = !stored && Boolean(state);
  const lon = typeof lead.longitude === "number" ? lead.longitude : null;

  const split = SPLIT_STATES[state];
  if (split) {
    if (lon != null) {
      const zone = lon < split.meridian ? split.west : split.east;
      return { zone, confidence: "coordinates", because: `${state} spans two zones; the map pin puts this business in ${label(zone)}.` };
    }
    return {
      zone: split.fallback,
      confidence: "state-approximate",
      because: `${state} spans two time zones and this business has no map pin — assuming ${label(split.fallback)}, where most of the state lives.`,
    };
  }

  const zone = STATE_ZONE[state];
  if (zone) {
    return {
      zone,
      confidence: "state",
      because: fromAddress
        ? `${state} is entirely in ${label(zone)} — read from the address line, because the state column is empty for this business.`
        : `${state} is entirely in ${label(zone)}.`,
    };
  }

  return { zone: DEFAULT_ZONE, confidence: "default", because: "No usable address — falling back to the workspace's own timezone." };
}

/** Human-readable zone name, e.g. "Pacific Time". */
export function label(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date(0));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

export interface ZonedParts {
  /** 0–23, in the target zone. */
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  /** "7:40 AM" */
  clock: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The wall clock in `zone` at instant `now`.
 *
 * This is the only place a date becomes an hour, and it goes through the tz
 * database every time. That is what makes daylight saving a non-event here: we
 * never hold an offset long enough for one to go stale.
 */
export function zonedParts(now: Date, zone: string): ZonedParts {
  const tz = isZone(zone) ? zone : DEFAULT_ZONE;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const weekday = Math.max(0, WEEKDAYS.indexOf(String(parts.weekday).slice(0, 3)));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour, minute, weekday, clock: `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}` };
}

// ── Business hours ───────────────────────────────────────────────────────────

/** One open interval on one day, in minutes from local midnight. A `close` that is
 *  ≤ `open` denotes hours that run PAST midnight into the next day (a bar open
 *  10pm–2am). Full-day cover is `{ open: 0, close: 1440 }` (a 24-hour business). */
export interface DayWindow {
  open: number;
  close: number;
}

export interface BusinessHours {
  /** Index 0 = Sunday … 6 = Saturday. `null` = closed that whole day. */
  days: Array<DayWindow | null>;
  source: "lead" | "assumed";
}

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const WEEKDAY_9_5: Array<DayWindow | null> = [null, { open: 540, close: 1020 }, { open: 540, close: 1020 }, { open: 540, close: 1020 }, { open: 540, close: 1020 }, { open: 540, close: 1020 }, null];

/** The stated assumption we fall back to when nothing reliable is known. */
const ASSUMED: BusinessHours = { days: WEEKDAY_9_5, source: "assumed" };

/** Parse a clock token ("9", "9am", "5:30pm", "17", "17:00") to minutes-from-midnight,
 *  or null if it isn't a time. `assumePm` disambiguates a bare hour (a "5" that closes
 *  a business is 5pm, not 5am) — exactly the heuristic the old single-range parser used. */
function parseClock(raw: string, assumePm: boolean): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = (m[3] ?? "").toLowerCase();
  if (h > 24 || min > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && assumePm && h < 8) h += 12;
  return (h % 24) * 60 + min;
}

/** "9-5", "9:00 AM – 5:00 PM", "8-17", "Open 24 hours", "closed" → a window or null. */
function parseWindow(raw: string): DayWindow | null | undefined {
  const s = raw.trim().toLowerCase();
  if (!s || /closed/.test(s)) return null;
  if (/24\s*hours|24\/7|open\s*24|all\s*day/.test(s)) return { open: 0, close: 1440 };
  const m = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:[–\-—]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(raw);
  if (!m) return undefined; // not a shape we understand
  const open = parseClock(m[1], false);
  const close = parseClock(m[2], true);
  if (open == null || close == null) return undefined;
  if (open === close) return undefined;
  return { open, close }; // close ≤ open is kept — it means overnight.
}

/** Expand a day token or inclusive day range ("mon", "mon-fri", "mon–sat") to indices. */
function parseDays(raw: string): number[] | null {
  const s = raw.trim().toLowerCase();
  if (/daily|every\s*day|everyday|all\s*week|7\s*days/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const range = /^([a-z]+)\s*[–\-—]\s*([a-z]+)$/.exec(s);
  if (range) {
    const a = DAY_INDEX[range[1]];
    const b = DAY_INDEX[range[2]];
    if (a == null || b == null) return null;
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; if (out.length > 7) return null; }
    return out;
  }
  const one = DAY_INDEX[s];
  return one == null ? null : [one];
}

/**
 * What counts as "open", per day of the week, in the business's own local time.
 *
 * `leads.hours` is a nullable text column that in production is STILL almost always
 * null (the Places field mask does not request opening hours). When it is null, or
 * carries a shape we can't read, this returns the stated assumption (Mon–Fri 9–5)
 * labelled `source: "assumed"` — so nothing downstream can mistake a guess for a
 * fact, and the queue can refuse to suppress a business on an assumption.
 *
 * When it DOES carry hours, three real shapes are understood, and the parse is
 * per-day so a business open on the weekend (a hotel, a Sunday restaurant) is not
 * silently treated as Mon–Fri:
 *
 *   • Google Places `weekday_text`, one day per line —
 *     "Monday: 9:00 AM – 5:00 PM", "Sunday: Closed", "Monday: Open 24 hours"
 *   • a day range + a time range on one line — "Mon–Fri 9–5", "Daily 11–21"
 *   • "24/7" / "Open 24 hours" — open around the clock, every day
 *   • a bare time range with no days — "9am–5pm" — applied Mon–Fri (back-compat)
 */
export function businessHours(lead: Pick<Lead, "hours">): BusinessHours {
  const raw = (lead.hours ?? "").trim();
  if (!raw) return ASSUMED;

  // Whole-business 24/7 shorthand, before any day parsing.
  if (/^\s*(24\/7|open\s*24\s*hours?|24\s*hours?)\s*$/i.test(raw)) {
    return { days: Array.from({ length: 7 }, () => ({ open: 0, close: 1440 })), source: "lead" };
  }

  const days: Array<DayWindow | null> = [null, null, null, null, null, null, null];
  let matched = false;

  // Google `weekday_text` style: split on newlines OR on "<Day>:" boundaries so a
  // single joined string still parses. Each segment is "<days>: <window>".
  const segments = raw.includes("\n")
    ? raw.split(/\n+/)
    : raw.split(/(?=(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*:)/i);
  for (const seg of segments) {
    const parts = seg.split(":");
    if (parts.length < 2) continue;
    const dayIdx = parseDays(parts[0]);
    if (!dayIdx) continue;
    const win = parseWindow(parts.slice(1).join(":"));
    if (win === undefined) continue; // unreadable window → leave those days closed
    matched = true;
    for (const d of dayIdx) days[d] = win;
  }
  if (matched) return { days, source: "lead" };

  // One-line "Mon–Fri 9–5" / "Daily 11–21": a day range followed by a time range.
  const combo = /^([a-z]+(?:\s*[–\-—]\s*[a-z]+)?|daily|every\s*day|everyday)\s+(.+)$/i.exec(raw);
  if (combo) {
    const dayIdx = parseDays(combo[1]);
    const win = parseWindow(combo[2]);
    if (dayIdx && win) {
      for (const d of dayIdx) days[d] = win;
      return { days, source: "lead" };
    }
  }

  // A bare time range, no days named → the historical behaviour: Mon–Fri.
  const bare = parseWindow(raw);
  if (bare) return { days: [null, bare, bare, bare, bare, bare, null], source: "lead" };

  return ASSUMED;
}

/** Is the business open at `minutesNow` on `weekday`, given its weekly hours?
 *  Handles overnight windows that spilled over from the previous day. Returns the
 *  minutes remaining until close (from `minutesNow`) when open, else null. */
function openFor(hours: BusinessHours, weekday: number, minutesNow: number): number | null {
  const today = hours.days[weekday];
  if (today) {
    if (today.close > today.open) {
      if (minutesNow >= today.open && minutesNow < today.close) return today.close - minutesNow;
    } else if (minutesNow >= today.open) {
      // Overnight window that opened today and closes tomorrow.
      return 1440 - minutesNow + today.close;
    }
  }
  const yest = hours.days[(weekday + 6) % 7];
  if (yest && yest.close <= yest.open && minutesNow < yest.close) {
    // Still inside last night's overnight window.
    return yest.close - minutesNow;
  }
  return null;
}

export type CallState = "open" | "opens-later" | "closed-for-the-day" | "closed-today";

export interface CallWindow {
  zone: string;
  confidence: ZoneConfidence;
  /** Their wall clock right now, e.g. "10:40 AM". */
  localClock: string;
  state: CallState;
  open: boolean;
  /** Minutes until they open. Null unless state is "opens-later". */
  opensInMinutes: number | null;
  /** Minutes until they close. Null unless open. */
  closesInMinutes: number | null;
  hoursSource: BusinessHours["source"];
  /** One line for the operator: "Open — 10:40 AM their time, closes in 6h". */
  label: string;
  /** Why the zone is what it is. */
  because: string;
}

/**
 * Can we call this business right now, and if not, when?
 *
 * Read-only advice. Nothing in the product refuses to place a call because of
 * this — an operator who wants to dial a closed business is allowed to; they may
 * know something the address does not.
 */
export function callWindow(
  lead: Pick<Lead, "state" | "longitude" | "latitude" | "hours"> & { address?: string | null },
  now: Date,
): CallWindow {
  const { zone, confidence, because } = inferZone(lead);
  const { hour, minute, weekday, clock } = zonedParts(now, zone);
  const hours = businessHours(lead);
  const minutesNow = hour * 60 + minute;

  const today = hours.days[weekday];
  let state: CallState;
  let opensInMinutes: number | null = null;
  let closesInMinutes: number | null = openFor(hours, weekday, minutesNow);

  if (closesInMinutes != null) state = "open";
  else if (today && minutesNow < today.open) {
    state = "opens-later";
    opensInMinutes = today.open - minutesNow;
  } else if (today) state = "closed-for-the-day";
  else state = "closed-today";

  const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
  const label =
    state === "open" ? `Open — ${clock} their time, closes in ${dur(closesInMinutes!)}`
    : state === "opens-later" ? `Opens in ${dur(opensInMinutes!)} — ${clock} their time`
    : state === "closed-for-the-day" ? `Closed for the day — ${clock} their time`
    : `Closed today — ${clock} their time`;

  return {
    zone, confidence, localClock: clock, state, open: state === "open",
    opensInMinutes, closesInMinutes, hoursSource: hours.source, label, because,
  };
}

/**
 * Ordering weight for time-sensitive work. Lower sorts first.
 *
 *   0 — open now and closing soonest (the ones that will be gone by lunch)
 *   1 — open now
 *   2 — opens later today, soonest first
 *   3 — closed for the day
 *   4 — closed today entirely
 *
 * Used ONLY as a tie-break inside a work kind that involves reaching a human, and
 * only after urgency and priority have already had their say. A follow-up that is
 * overdue does not get demoted because a receptionist went to lunch.
 */
export function callOrderWeight(w: CallWindow): number {
  switch (w.state) {
    case "open": return w.closesInMinutes != null && w.closesInMinutes <= 90 ? 0 : 1;
    case "opens-later": return 2;
    case "closed-for-the-day": return 3;
    default: return 4;
  }
}

/**
 * Compare two businesses for CALL ordering within an already-prioritised group.
 *
 * Deterministic and total: weight, then the tighter window, then business name.
 * There is no clock read inside — `now` comes from the caller — so the same
 * inputs always produce the same order, which is what keeps the daily queue
 * reproducible and testable.
 */
export function compareForCalling<T extends Pick<Lead, "state" | "longitude" | "latitude" | "hours" | "businessName"> & { address?: string | null }>(
  a: T, b: T, now: Date,
): number {
  const wa = callWindow(a, now);
  const wb = callWindow(b, now);
  const byWeight = callOrderWeight(wa) - callOrderWeight(wb);
  if (byWeight) return byWeight;
  if (wa.state === "open" && wb.state === "open") {
    return (wa.closesInMinutes ?? 0) - (wb.closesInMinutes ?? 0) || a.businessName.localeCompare(b.businessName);
  }
  if (wa.state === "opens-later" && wb.state === "opens-later") {
    return (wa.opensInMinutes ?? 0) - (wb.opensInMinutes ?? 0) || a.businessName.localeCompare(b.businessName);
  }
  return a.businessName.localeCompare(b.businessName);
}

/**
 * The end of the operator's day, in the operator's own zone.
 *
 * "Due today" has been computed with `new Date(...).setHours(23,59,59,999)` — the
 * SERVER's midnight. On Railway that is UTC, which means an operator in Los
 * Angeles has been losing the last 16 hours of their day: at 5pm Pacific the
 * server already believes it is tomorrow. This gives every day-boundary the zone
 * it should have had.
 *
 * Not yet wired into the scheduler — see the report. Changing what "today" means
 * changes what every queue contains, and that is a deliberate decision, not a
 * side effect of adding timezone support.
 */
export function endOfDayIn(zone: string, now: Date): Date {
  const { hour, minute } = zonedParts(now, zone);
  const msIntoDay = (hour * 60 + minute) * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - msIntoDay + 24 * 60 * 60 * 1000 - 1);
}

// ── Call-queue eligibility ───────────────────────────────────────────────────

/**
 * Should this business be WITHHELD from the active call queue right now?
 *
 * This is the one predicate the queue asks. It is deliberately conservative: it
 * returns true ONLY when hours we actually TRUST (`source: "lead"`) prove the
 * business is shut for the rest of today. Assumed hours never withhold anyone — an
 * unknown-hours business stays callable, because missing data must never read as
 * "closed" (that would empty the Sunday queue of every business we simply lack
 * hours for). `opens-later` is not withheld either: they become reachable within
 * the same call block, and the ordering already sinks them below open businesses.
 *
 * Advisory only for a human placing a single call (see callWindow); ENFORCED only
 * here, where an automated queue would otherwise hand the operator a locked door.
 */
export function knownClosedNow(
  lead: Pick<Lead, "state" | "longitude" | "latitude" | "hours"> & { address?: string | null },
  now: Date,
): boolean {
  const w = callWindow(lead, now);
  return w.hoursSource === "lead" && (w.state === "closed-today" || w.state === "closed-for-the-day");
}

// Minutes a zone is ahead of UTC at a given instant. The building block for turning
// a business's wall-clock opening time back into a real UTC instant.
function offsetMinutes(instant: Date, zone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

// The UTC instant of a wall-clock time (y-m-d h:m) in `zone`. Two-step: guess, then
// correct by the zone's offset at that guess. Opening hours never fall on the DST
// transition hour, so a single correction is exact for this use.
function wallToUtc(year: number, month0: number, day: number, minutes: number, zone: string): Date {
  const guess = Date.UTC(year, month0, day, Math.floor(minutes / 60), minutes % 60);
  const off = offsetMinutes(new Date(guess), zone);
  return new Date(guess - off * 60_000);
}

/**
 * The next instant this business opens, at or after `now`, as a real UTC Date.
 *
 * Used to reschedule a lead the operator marked CLOSED so it returns during the
 * next OPEN period rather than being buried or retried blind. Honours known hours
 * when we have them and the stated Mon–Fri 9–5 assumption when we don't (so a
 * business closed on a Sunday comes back Monday morning, not at midnight). Scans a
 * week ahead; returns null only if no day is ever open (which the assumption never
 * produces).
 */
export function nextOpenAt(
  lead: Pick<Lead, "state" | "longitude" | "latitude" | "hours"> & { address?: string | null },
  now: Date,
): Date | null {
  const { zone } = inferZone(lead);
  const hours = businessHours(lead);
  const { year, month, day } = ymdIn(now, zone);
  const { weekday, hour, minute } = zonedParts(now, zone);
  const minutesNow = hour * 60 + minute;

  for (let d = 0; d <= 7; d++) {
    const wd = (weekday + d) % 7;
    const win = hours.days[wd];
    if (!win) continue;
    // Today only counts if it hasn't opened yet — otherwise look to a later day.
    if (d === 0 && minutesNow >= win.open) continue;
    const base = new Date(Date.UTC(year, month - 1, day));
    base.setUTCDate(base.getUTCDate() + d);
    return wallToUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), win.open, zone);
  }
  return null;
}

// Calendar Y-M-D in a zone at an instant (companion to zonedParts, which stops at
// hour/minute/weekday). Kept private — only nextOpenAt needs the date part.
function ymdIn(now: Date, zone: string): { year: number; month: number; day: number } {
  const tz = isZone(zone) ? zone : DEFAULT_ZONE;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day };
}
