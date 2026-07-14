import type { ProspectingProfile } from "./types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TZ = "America/Los_Angeles";

/**
 * Human-readable description of the next scheduled prospecting run, evaluated in
 * America/Los_Angeles. Display-only — the external cron performs the actual run.
 */
export function nextScheduledRun(p: ProspectingProfile): { relative: string; label: string } {
  if (!p.enabled) return { relative: "paused", label: "Automation paused" };
  if (!p.weekdays.length) return { relative: "not scheduled", label: "No weekdays selected" };

  const [h, m] = (p.runTime || "05:30").split(":").map((x) => parseInt(x, 10));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const nowWeekday = parts.find((x) => x.type === "weekday")?.value ?? "Sun";
  const nowHour = parseInt(parts.find((x) => x.type === "hour")?.value ?? "0", 10);
  const nowMin = parseInt(parts.find((x) => x.type === "minute")?.value ?? "0", 10);
  const nowIdx = DAYS.indexOf(nowWeekday.slice(0, 3));
  const nowMinutes = nowHour * 60 + nowMin;
  const runMinutes = h * 60 + m;

  for (let i = 0; i < 8; i++) {
    const idx = (nowIdx + i) % 7;
    if (!p.weekdays.includes(idx)) continue;
    if (i === 0 && nowMinutes >= runMinutes) continue; // already passed today
    const time = fmtTime(h, m);
    const rel = i === 0 ? `today ${time}` : i === 1 ? `tomorrow ${time}` : `${DAYS[idx]} ${time}`;
    return { relative: rel, label: `${DAYS[idx]} at ${time} (PT)` };
  }
  return { relative: "not scheduled", label: "Not scheduled" };
}

function fmtTime(h: number, m: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
