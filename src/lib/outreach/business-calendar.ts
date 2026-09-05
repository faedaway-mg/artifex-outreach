// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS-CALENDAR HOLIDAY GUARD (mandate 16). Normal B2B outreach must not schedule or dispatch on a
// configured holiday. Holidays are LA-calendar date keys (YYYY-MM-DD), configurable via BUSINESS_HOLIDAYS
// (comma-separated), defaulting to the US federal holidays relevant to the current batch. Pure + tested.
// ─────────────────────────────────────────────────────────────────────────────

// Sensible default set incl. Labor Day 2026 (Mon Sep 7) — the holiday behind the Sept-7 batch.
const DEFAULT_HOLIDAYS = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", // Labor Day (observed) — Monday
  "2026-11-11", "2026-11-26", "2026-12-25",
];

export function configuredHolidays(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = (env.BUSINESS_HOLIDAYS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return new Set(raw.length ? raw : DEFAULT_HOLIDAYS);
}

export function isBusinessHoliday(dateKey: string, env?: NodeJS.ProcessEnv): boolean {
  return configuredHolidays(env).has(dateKey);
}

/** Add whole days to a YYYY-MM-DD key (calendar arithmetic via UTC noon anchor — DST-agnostic for a date key). */
export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(dateKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next date key that is BOTH a configured sending weekday AND not a holiday, starting at `fromKey`. */
export function nextBusinessDayKey(fromKey: string, weekdays: number[] = [1, 2, 3, 4, 5], env?: NodeJS.ProcessEnv): string {
  let key = fromKey;
  for (let i = 0; i < 400; i++) {
    const wd = new Date(key + "T12:00:00Z").getUTCDay(); // weekday of the LA date (noon anchor is stable)
    if (weekdays.includes(wd) && !isBusinessHoliday(key, env)) return key;
    key = addDaysKey(key, 1);
  }
  return fromKey; // unreachable for a non-empty weekday set
}
