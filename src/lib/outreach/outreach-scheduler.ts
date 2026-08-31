// ─────────────────────────────────────────────────────────────────────────────
// Weekday scheduled-outreach engine (Gates 2–3). Decides WHICH authorized reviews may be
// dispatched RIGHT NOW, under: a weekday morning window (recipient-local, LA fallback), a per-LA-day
// TOTAL cap of 20 (shared by follow-ups + manual + automated — counted from the email_sends ledger),
// staggering, and a pause-all switch. It NEVER sends by itself — it hands a fully re-verified,
// authorized, artifact-bound message to an injected transport (non-delivering during the dry run).
//
// Content eligibility is NOT delivery authorization: every candidate is re-authorized and
// re-verified (fingerprint + suppression + window + quota + pause) at THIS final boundary.
// ─────────────────────────────────────────────────────────────────────────────
import type { SendingWindow } from "../types";
import { authorizeForSend, authorizationValidForDispatch, type SendAuthorization } from "./review-send-policy";
import { reserveDailySlot, releaseSlot, consumeSlot, countSlotsUsed, laDayKey as laDayKeyOf, ACCOUNTING_TZ as ACCT_TZ, type ReserveResult } from "../comms/send-quota";
import { outreachPausedNow } from "./outreach-pause";

export const DAILY_CAP = 20;
export const ACCOUNTING_TZ = ACCT_TZ;
export const PAUSE_ENV = "QR_OUTREACH_PAUSED";
export const MORNING_WINDOW: SendingWindow = { timezone: ACCOUNTING_TZ, startHour: 8, endHour: 10, weekdays: [1, 2, 3, 4, 5] };

const SENT_FAMILY = new Set(["sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed"]);

/** Hour(0-23) + weekday(0=Sun) for `now` in an IANA tz (same shape comms/scheduler uses). */
function zonedParts(now: Date, timezone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  const hour = (parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24) || 0;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf((parts.find((p) => p.type === "weekday")?.value ?? "Sun").slice(0, 3));
  return { hour, weekday };
}

/** The cap-accounting day key (YYYY-MM-DD) in America/Los_Angeles — one shared quota per LA day.
 *  Canonical implementation lives in comms/send-quota so the quota and the scheduler never disagree. */
export const laDayKey = laDayKeyOf;

/** Weekday 08:00–10:00 in the given tz. No weekend sending; no evening/overnight. */
export function withinMorningWindow(now: Date, tz: string = ACCOUNTING_TZ, window: SendingWindow = MORNING_WINDOW): boolean {
  const { hour, weekday } = zonedParts(now, tz);
  if (!window.weekdays.includes(weekday)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/** Recipient-local window tz, or the LA fallback. `reliable` is false when we had to fall back.
 *  NOTE (as-built): no per-lead timezone is stored today (see comms/lead timezone), so a recipient
 *  tz is never reliably established and this ALWAYS returns the LA fallback — i.e. the active schedule
 *  is Mon–Fri 08:00–10:00 America/Los_Angeles for every recipient. Recipient-local windows are wired
 *  and tested (pass a tz to see it honored) but dormant until a reliable per-lead tz source exists. */
export function recipientWindowTz(knownTz: string | null | undefined): { tz: string; reliable: boolean } {
  return knownTz ? { tz: knownTz, reliable: true } : { tz: ACCOUNTING_TZ, reliable: false };
}

/** Env-only pause (secondary control; needs a redeploy on Railway to change). The primary pause is
 *  DB-backed and observed on the next tick with no redeploy — see outreachPausedNow(). */
export function outreachPaused(): boolean {
  return process.env[PAUSE_ENV] === "1";
}

export type SendResult = { ok: boolean; providerId?: string | null; ambiguous?: boolean };

export interface SchedulerDeps {
  now: Date;
  campaignId: string;
  cap?: number;
  window?: SendingWindow;
  /** Known recipient timezone for a lead, if reliably established (else LA fallback is used). */
  recipientTzOf?: (leadId: string) => Promise<string | null> | string | null;
  /** The transport. MUST be non-delivering during the dry run. Returns ambiguous=true on an
   *  uncertain provider response (then the slot is RETAINED and the send is NOT retried here). */
  send: (args: { leadId: string; auth: SendAuthorization }) => Promise<SendResult>;
  /** Pause override. Defaults to the DB-backed + env pause, observed fresh each tick. May be async. */
  isPaused?: () => boolean | Promise<boolean>;
  /** Cap the number processed this tick (staggering / batch bound). */
  maxThisTick?: number;
  // ── Quota: ATOMIC reservation over the shared email_sends ledger (overridable for tests). ──
  /** Atomically reserve one slot in the shared LA-day pool for this lead. Default = reserveDailySlot. */
  reserve?: (leadId: string, now: Date, cap: number) => Promise<ReserveResult>;
  /** Return a released reservation's slot to the pool (transport refused). Default = releaseSlot. */
  release?: (reservationId: string) => Promise<void>;
  /** Mark a reservation consumed once the send left (reserved → sent). Default = consumeSlot. */
  consume?: (reservationId: string) => Promise<void>;
  /** Read-only quota used for the day, for reporting quotaRemaining. Default = countSlotsUsed. */
  usedToday?: (now: Date) => Promise<number>;
}

export interface CandidateOutcome {
  leadId: string;
  outcome: "sent" | "held" | "quota-reached" | "paused" | "outside-window" | "ambiguous" | "already-sent";
  reason?: string;
  revisionId?: string;
}
export interface SchedulerSummary {
  laDay: string;
  cap: number;
  startedWith: number;
  sent: number;
  quotaRemaining: number;
  outcomes: CandidateOutcome[];
}

/**
 * Process a queue of candidate leadIds at `now`. For EACH, in order, re-verify everything at the
 * final boundary and hand an authorized, artifact-bound message to the transport — or hold with a
 * reason. Stops immediately on pause or when the shared daily cap is reached. The quota is re-counted
 * before every dispatch (so concurrent ticks/workers cannot exceed the cap on a single-writer store;
 * the ledger's unique idempotency key prevents double-send of the same step).
 */
export async function runScheduledOutreach(leadIds: string[], deps: SchedulerDeps): Promise<SchedulerSummary> {
  const cap = deps.cap ?? DAILY_CAP;
  const isPaused = deps.isPaused ?? outreachPausedNow;
  const reserve = deps.reserve ?? ((leadId, now, c) => reserveDailySlot({ now, cap: c, leadId }));
  const release = deps.release ?? releaseSlot;
  // Stamp the consumed send with the TICK's clock so its cap-accounting day matches the reservation
  // (in production the tick clock is wall-clock; this also keeps deterministic ticks self-consistent).
  const consume = deps.consume ?? ((id: string) => consumeSlot(id, { sentAt: deps.now.toISOString() }));
  const usedToday = deps.usedToday ?? countSlotsUsed;
  const outcomes: CandidateOutcome[] = [];
  let sent = 0;
  const limit = deps.maxThisTick ?? leadIds.length;
  let processed = 0;

  for (const leadId of leadIds) {
    if (processed >= limit) break;
    // Pause-all — observed FRESH at the dispatch boundary (DB flag + env), before any per-lead work.
    if (await isPaused()) { outcomes.push({ leadId, outcome: "paused" }); continue; }

    processed += 1;
    // Weekday morning window in the recipient's tz (LA fallback — see recipientWindowTz).
    const knownTz = (await deps.recipientTzOf?.(leadId)) ?? null;
    const { tz } = recipientWindowTz(knownTz);
    if (!withinMorningWindow(deps.now, tz, deps.window ?? MORNING_WINDOW)) { outcomes.push({ leadId, outcome: "outside-window", reason: `outside 08:00–10:00 ${tz}` }); continue; }

    // Authorize (content-eligibility + suppression + held + recipient); binds to the frozen artifact SHA.
    const auth = await authorizeForSend(leadId, { campaignId: deps.campaignId, now: deps.now.toISOString() });
    if (!auth.authorized || !auth.auth) { outcomes.push({ leadId, outcome: "held", reason: auth.reason }); continue; }
    // Final-boundary re-verification of the exact authorized revision (deterministic fingerprint).
    const valid = await authorizationValidForDispatch(leadId, auth.auth);
    if (!valid.ok) { outcomes.push({ leadId, outcome: "held", reason: valid.reason }); continue; }

    // ATOMICALLY reserve a slot in the shared LA-day pool. Serialized per day, so a burst / two
    // concurrent ticks / a manual send racing this one can never take the pool past the cap.
    const slot = await reserve(leadId, deps.now, cap);
    if (!slot.granted) { outcomes.push({ leadId, outcome: "quota-reached" }); continue; }
    // Idempotency: this lead already holds a slot today. If it already SHIPPED, never resend; if it's
    // a bare "reserved" hold left by a crashed prior tick, fall through and (re)ship it once.
    if (slot.reason === "already-reserved" && slot.existingStatus && SENT_FAMILY.has(slot.existingStatus)) {
      outcomes.push({ leadId, outcome: "already-sent", reason: "already sent to this lead today", revisionId: auth.auth.revisionId });
      continue;
    }

    // Ship through the transport, which re-resolves the identical frozen artifact (never a re-render,
    // never a caller-carried Buffer) and binds it to auth.pdfSha256.
    const res = await deps.send({ leadId, auth: auth.auth });
    if (res.ambiguous) {
      // Uncertain provider response: RETAIN the reserved slot (do not release, do not consume) so a
      // reconcile can resolve it without a double-send. Not counted as sent.
      outcomes.push({ leadId, outcome: "ambiguous", reason: "uncertain provider response — slot retained, reconcile before retry", revisionId: auth.auth.revisionId });
      continue;
    }
    if (res.ok) {
      if (slot.reservationId) await consume(slot.reservationId); // reserved → sent (stays counted)
      sent += 1; outcomes.push({ leadId, outcome: "sent", revisionId: auth.auth.revisionId });
    } else {
      if (slot.reservationId) await release(slot.reservationId); // transport refused → return the slot
      outcomes.push({ leadId, outcome: "held", reason: "transport refused" });
    }
  }

  const finalUsed = await usedToday(deps.now);
  return { laDay: laDayKey(deps.now), cap, startedWith: leadIds.length, sent, quotaRemaining: Math.max(0, cap - finalUsed), outcomes };
}
