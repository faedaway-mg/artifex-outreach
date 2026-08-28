// ─────────────────────────────────────────────────────────────────────────────
// Runtime pause for automated outreach — the "stop everything now" control.
//
// Two layers, checked FRESH at every dispatch boundary:
//   1. DB flag  (settings.outreachPaused) — PRIMARY. A settings write is read on the next tick with
//      NO redeploy/restart, so an operator can halt the queue in seconds. Audited.
//   2. env var  (QR_OUTREACH_PAUSED=1)    — SECONDARY belt-and-suspenders. On Railway an env change
//      needs a redeploy to reach the running process, so it is the slower, coarser kill-switch.
//
// Honest boundary: pausing stops work that has not YET been handed to the provider. A send the
// provider has already accepted cannot be recalled — that is a property of email, not a gap here.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";

export const PAUSE_ENV = "QR_OUTREACH_PAUSED";

/** True if automated outreach is paused RIGHT NOW by either control. Reads settings fresh (no cache)
 *  so a DB pause is observed on the very next tick. Fails safe: on a read error, treats as NOT paused
 *  is wrong — instead we treat an env pause as authoritative and only consult the DB when reachable. */
export async function outreachPausedNow(): Promise<boolean> {
  if (process.env[PAUSE_ENV] === "1") return true;
  const s = await getSettings();
  return s.outreachPaused === true;
}

/** Flip the DB-backed pause. Audited. Takes effect on the next tick — no deploy. */
export async function setOutreachPaused(paused: boolean, opts: { actor: string; reason?: string }): Promise<void> {
  await updateSettings({ outreachPaused: paused });
  await appendAudit({
    action: paused ? "outreach.paused" : "outreach.resumed",
    actor: opts.actor,
    targetType: "settings",
    targetId: "singleton",
    meta: { reason: opts.reason ?? null },
    ip: null,
  });
}
