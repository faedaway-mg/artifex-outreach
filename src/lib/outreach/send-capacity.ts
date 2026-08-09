// ─────────────────────────────────────────────────────────────────────────────
// How many emails have already left today — the one number the email stream's
// warm-up-safe daily ceiling is measured against.
//
// "Emails to send" is bounded not by how many email-first leads EXIST, but by how
// many can safely go out today (deliverability protection wins over raw volume, per
// the operating brief). That ceiling is `emailDailyTarget`; this module answers the
// other half — what has already been spent — so the queue can surface exactly the
// safe remainder and defer the rest until tomorrow, without dropping anything.
//
// Pure over (rows, now): `now` is passed in, so it is deterministic under test.
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailSend } from "@/lib/types";

function sameDay(iso: string | null, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

/**
 * Count emails that have actually left the system today. A row counts once it has a
 * `sentAt` stamp (dispatch sets it on a successful send) — queued/failed rows do not,
 * so a bounce or a retry never wrongly consumes the day's send capacity.
 */
export function emailsSentOn(sends: EmailSend[], now: Date): number {
  return sends.filter((s) => sameDay(s.sentAt, now)).length;
}
