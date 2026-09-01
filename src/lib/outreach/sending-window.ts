// ─────────────────────────────────────────────────────────────────────────────
// The ONE source of truth for the outreach send WINDOW and the next sending DATE, in America/
// Los_Angeles. The scheduler, the batch stagger, the operator schedule surface, and the cron runner
// all resolve the window from Settings through here so they can never disagree — and so a wall-clock
// hour (e.g. 5:00 AM) is ALWAYS interpreted in LA, never silently as UTC.
//
// Canonical timestamps are stored as UTC instants (see staggeredTimes); every GATE and every DISPLAY
// converts to LA via Intl. DST (PST/PDT) is handled automatically by the IANA zone.
// ─────────────────────────────────────────────────────────────────────────────
import type { SendingWindow, Settings } from "../types";

export const ACCOUNTING_TZ = "America/Los_Angeles";

/** The accepted production window: weekdays 05:00–07:00 America/Los_Angeles. Used when Settings has no
 *  (valid) window. Weekdays are 0=Sun … 6=Sat; [1,2,3,4,5] = Mon–Fri. */
export const DEFAULT_SENDING_WINDOW: SendingWindow = {
  timezone: ACCOUNTING_TZ,
  startHour: 5,
  endHour: 7,
  weekdays: [1, 2, 3, 4, 5],
};

function validWindow(w: unknown): w is SendingWindow {
  if (!w || typeof w !== "object") return false;
  const x = w as Partial<SendingWindow>;
  return typeof x.timezone === "string" && !!x.timezone
    && Number.isInteger(x.startHour) && x.startHour! >= 0 && x.startHour! <= 23
    && Number.isInteger(x.endHour) && x.endHour! >= 1 && x.endHour! <= 24
    && x.startHour! < x.endHour!
    && Array.isArray(x.weekdays) && x.weekdays.length > 0 && x.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/** Resolve the active send window from Settings, falling back to the accepted production default.
 *  This is the value the scheduler window-gate, the batch stagger, and the UI all share. */
export function resolveSendingWindow(settings?: Pick<Settings, "sendingWindow"> | null): SendingWindow {
  return validWindow(settings?.sendingWindow) ? (settings!.sendingWindow as SendingWindow) : DEFAULT_SENDING_WINDOW;
}

/** LA calendar parts (year/month/day + weekday 0=Sun + hour 0-23) for an instant. */
export function laParts(now: Date, tz: string = ACCOUNTING_TZ): { y: number; m: number; d: number; weekday: number; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hour12: false })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday).slice(0, 3));
  return { y: +p.year, m: +p.month, d: +p.day, weekday, hour: (parseInt(String(p.hour), 10) % 24) || 0 };
}

/** The LA calendar date (YYYY-MM-DD) of `now`. */
export function laDateKey(now: Date, tz: string = ACCOUNTING_TZ): string {
  const { y, m, d } = laParts(now, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The next eligible SENDING date key (YYYY-MM-DD) in LA for the given window: TODAY when today is a
 * sending weekday AND the LA clock is still before the window's end hour; otherwise the next calendar
 * day whose LA weekday is in window.weekdays. Never returns a weekend/non-window day. Replaces the old
 * hardcoded MONDAY_TARGET so the batch always targets a real, in-the-future LA sending day.
 */
export function nextSendingDateKey(now: Date, window: SendingWindow = DEFAULT_SENDING_WINDOW): string {
  const tz = window.timezone || ACCOUNTING_TZ;
  const today = laParts(now, tz);
  const isSendingDay = (weekday: number) => window.weekdays.includes(weekday);
  // Today still counts only if it's a sending weekday and we haven't passed the window's close.
  if (isSendingDay(today.weekday) && today.hour < window.endHour) {
    return `${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;
  }
  // Walk forward from tomorrow (LA) to the next sending weekday. Step by whole LA days via noon-LA anchors.
  for (let add = 1; add <= 8; add++) {
    // Anchor at ~noon LA `add` days ahead to avoid DST edges, then read its LA calendar parts.
    const anchor = new Date(Date.UTC(today.y, today.m - 1, today.d, 19, 0, 0) + add * 86400000);
    const p = laParts(anchor, tz);
    if (isSendingDay(p.weekday)) return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  // Unreachable for any non-empty weekday set; keep the type total.
  return laDateKey(now, tz);
}

/** Format a UTC ISO instant as an LA time label with the zone shown (A.3: tz beside every timestamp). */
export function laClockLabel(iso: string, tz: string = ACCOUNTING_TZ): string {
  const t = new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const abbr = tz === ACCOUNTING_TZ ? " PT" : "";
  return `${t}${abbr}`;
}
