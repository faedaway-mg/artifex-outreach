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
 * `dominant` is where most of the population is; `west` is what to use when the
 * longitude says the business sits past the dividing meridian. Approximating a
 * state line with a meridian is wrong at the margins and honest about it — the
 * confidence returned is "state-approximate", never "state".
 */
const SPLIT_STATES: Record<string, { dominant: string; west: string; meridian: number }> = {
  AK: { dominant: "America/Anchorage", west: "America/Anchorage", meridian: -170 },
  FL: { dominant: "America/New_York", west: "America/Chicago", meridian: -85 },
  ID: { dominant: "America/Boise", west: "America/Los_Angeles", meridian: -116.5 },
  IN: { dominant: "America/Indiana/Indianapolis", west: "America/Chicago", meridian: -87.2 },
  KS: { dominant: "America/Chicago", west: "America/Denver", meridian: -101.5 },
  KY: { dominant: "America/New_York", west: "America/Chicago", meridian: -85.5 },
  MI: { dominant: "America/Detroit", west: "America/Menominee", meridian: -87.5 },
  ND: { dominant: "America/Chicago", west: "America/Denver", meridian: -101 },
  NE: { dominant: "America/Chicago", west: "America/Denver", meridian: -101 },
  OR: { dominant: "America/Los_Angeles", west: "America/Boise", meridian: -117.5 },
  SD: { dominant: "America/Chicago", west: "America/Denver", meridian: -100.5 },
  TN: { dominant: "America/Chicago", west: "America/New_York", meridian: -85.5 },
  TX: { dominant: "America/Chicago", west: "America/Denver", meridian: -105 },
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
export function inferZone(lead: Pick<Lead, "state" | "longitude" | "latitude">): ZoneInference {
  const state = (lead.state ?? "").trim().toUpperCase().slice(0, 2);
  const lon = typeof lead.longitude === "number" ? lead.longitude : null;

  const split = SPLIT_STATES[state];
  if (split) {
    if (lon != null) {
      const zone = lon < split.meridian ? split.west : split.dominant;
      return { zone, confidence: "coordinates", because: `${state} spans two zones; the map pin puts this business in ${label(zone)}.` };
    }
    return {
      zone: split.dominant,
      confidence: "state-approximate",
      because: `${state} spans two time zones and this business has no map pin — assuming ${label(split.dominant)}, which covers most of the state.`,
    };
  }

  const zone = STATE_ZONE[state];
  if (zone) return { zone, confidence: "state", because: `${state} is entirely in ${label(zone)}.` };

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

export interface BusinessHours {
  openHour: number;
  closeHour: number;
  /** Weekday indices the business is open. 1 = Monday. */
  weekdays: number[];
  source: "lead" | "assumed";
}

/**
 * What counts as "open".
 *
 * `leads.hours` exists as a nullable text column and is CURRENTLY ALWAYS NULL —
 * the Places field mask does not request opening hours, so nothing has ever
 * populated it. Rather than pretend otherwise, this parses the column when it one
 * day holds something and otherwise returns a stated assumption, labelled
 * "assumed" so nothing downstream can mistake it for a fact.
 */
export function businessHours(lead: Pick<Lead, "hours">): BusinessHours {
  const assumed: BusinessHours = { openHour: 9, closeHour: 17, weekdays: [1, 2, 3, 4, 5], source: "assumed" };
  const raw = (lead.hours ?? "").trim();
  if (!raw) return assumed;

  // "Mon–Fri 9–5", "Mon-Fri 8-17", "9am-5pm" — the shapes the mock data uses.
  const range = raw.match(/(\d{1,2})\s*(am|pm)?\s*[–-]\s*(\d{1,2})\s*(am|pm)?/i);
  if (!range) return assumed;
  const to24 = (n: string, mer: string | undefined, assumePm: boolean) => {
    let h = Number(n) % 24;
    const m = (mer ?? "").toLowerCase();
    if (m === "pm" && h < 12) h += 12;
    else if (m === "am" && h === 12) h = 0;
    else if (!m && assumePm && h < 8) h += 12;
    return h;
  };
  const openHour = to24(range[1], range[2], false);
  const closeHour = to24(range[3], range[4], true);
  if (!(closeHour > openHour)) return assumed;
  return { openHour, closeHour, weekdays: [1, 2, 3, 4, 5], source: "lead" };
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
  lead: Pick<Lead, "state" | "longitude" | "latitude" | "hours">,
  now: Date,
): CallWindow {
  const { zone, confidence, because } = inferZone(lead);
  const { hour, minute, clock } = zonedParts(now, zone);
  const hours = businessHours(lead);
  const { weekday } = zonedParts(now, zone);
  const minutesNow = hour * 60 + minute;

  const openToday = hours.weekdays.includes(weekday);
  let state: CallState;
  let opensInMinutes: number | null = null;
  let closesInMinutes: number | null = null;

  if (!openToday) state = "closed-today";
  else if (minutesNow < hours.openHour * 60) {
    state = "opens-later";
    opensInMinutes = hours.openHour * 60 - minutesNow;
  } else if (minutesNow >= hours.closeHour * 60) state = "closed-for-the-day";
  else {
    state = "open";
    closesInMinutes = hours.closeHour * 60 - minutesNow;
  }

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
export function compareForCalling<T extends Pick<Lead, "state" | "longitude" | "latitude" | "hours" | "businessName">>(
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
