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

export const DAILY_CAP = 20;
export const ACCOUNTING_TZ = "America/Los_Angeles";
export const PAUSE_ENV = "QR_OUTREACH_PAUSED";
export const MORNING_WINDOW: SendingWindow = { timezone: ACCOUNTING_TZ, startHour: 8, endHour: 10, weekdays: [1, 2, 3, 4, 5] };

/** Hour(0-23) + weekday(0=Sun) for `now` in an IANA tz (same shape comms/scheduler uses). */
function zonedParts(now: Date, timezone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  const hour = (parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24) || 0;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf((parts.find((p) => p.type === "weekday")?.value ?? "Sun").slice(0, 3));
  return { hour, weekday };
}

/** The cap-accounting day key (YYYY-MM-DD) in America/Los_Angeles — one shared quota per LA day. */
export function laDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ACCOUNTING_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Weekday 08:00–10:00 in the given tz. No weekend sending; no evening/overnight. */
export function withinMorningWindow(now: Date, tz: string = ACCOUNTING_TZ, window: SendingWindow = MORNING_WINDOW): boolean {
  const { hour, weekday } = zonedParts(now, tz);
  if (!window.weekdays.includes(weekday)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/** Recipient-local window tz, or the LA fallback. `reliable` is false when we had to fall back. */
export function recipientWindowTz(knownTz: string | null | undefined): { tz: string; reliable: boolean } {
  return knownTz ? { tz: knownTz, reliable: true } : { tz: ACCOUNTING_TZ, reliable: false };
}

export function outreachPaused(): boolean {
  return process.env[PAUSE_ENV] === "1";
}

export type SendResult = { ok: boolean; providerId?: string | null; ambiguous?: boolean };

export interface SchedulerDeps {
  now: Date;
  campaignId: string;
  cap?: number;
  window?: SendingWindow;
  /** Total sends already recorded for the current LA day (follow-ups + manual + automated). */
  countSentToday: () => Promise<number>;
  /** Known recipient timezone for a lead, if reliably established (else LA fallback is used). */
  recipientTzOf?: (leadId: string) => Promise<string | null> | string | null;
  /** The transport. MUST be non-delivering during the dry run. Returns ambiguous=true on an
   *  uncertain provider response (then the slot is RETAINED and the send is NOT retried here). */
  send: (args: { leadId: string; auth: SendAuthorization; pdf: Buffer }) => Promise<SendResult>;
  /** Pause override (defaults to the env switch). */
  isPaused?: () => boolean;
  /** Cap the number processed this tick (staggering / batch bound). */
  maxThisTick?: number;
}

export interface CandidateOutcome {
  leadId: string;
  outcome: "sent" | "held" | "quota-reached" | "paused" | "outside-window" | "ambiguous";
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
  const isPaused = deps.isPaused ?? outreachPaused;
  const outcomes: CandidateOutcome[] = [];
  let sent = 0;
  const limit = deps.maxThisTick ?? leadIds.length;
  let processed = 0;

  for (const leadId of leadIds) {
    if (processed >= limit) break;
    // Pause-all — enforced at the dispatch boundary, before any per-lead work.
    if (isPaused()) { outcomes.push({ leadId, outcome: "paused" }); continue; }
    // Shared daily cap — re-counted every time so a burst / concurrent tick can't exceed it.
    const usedNow = await deps.countSentToday();
    if (usedNow >= cap) { outcomes.push({ leadId, outcome: "quota-reached" }); continue; }

    processed += 1;
    // Weekday morning window in the recipient's tz (LA fallback).
    const knownTz = (await deps.recipientTzOf?.(leadId)) ?? null;
    const { tz } = recipientWindowTz(knownTz);
    if (!withinMorningWindow(deps.now, tz, deps.window ?? MORNING_WINDOW)) { outcomes.push({ leadId, outcome: "outside-window", reason: `outside 08:00–10:00 ${tz}` }); continue; }

    // Authorize (content-eligibility + suppression + held + recipient) and bind the EXACT bytes.
    const auth = await authorizeForSend(leadId, { campaignId: deps.campaignId, now: deps.now.toISOString() });
    if (!auth.authorized || !auth.auth || !auth.pdf) { outcomes.push({ leadId, outcome: "held", reason: auth.reason }); continue; }
    // Final-boundary re-verification of the exact authorized revision (deterministic fingerprint).
    const valid = await authorizationValidForDispatch(leadId, auth.auth);
    if (!valid.ok) { outcomes.push({ leadId, outcome: "held", reason: valid.reason }); continue; }

    // Ship the EXACT authorized bytes returned by authorizeForSend — never a re-render.
    const res = await deps.send({ leadId, auth: auth.auth, pdf: auth.pdf });
    if (res.ambiguous) { outcomes.push({ leadId, outcome: "ambiguous", reason: "uncertain provider response — slot retained, reconcile before retry", revisionId: auth.auth.revisionId }); continue; }
    if (res.ok) { sent += 1; outcomes.push({ leadId, outcome: "sent", revisionId: auth.auth.revisionId }); }
    else { outcomes.push({ leadId, outcome: "held", reason: "transport refused" }); }
  }

  const finalUsed = await deps.countSentToday();
  return { laDay: laDayKey(deps.now), cap, startedWith: leadIds.length, sent, quotaRemaining: Math.max(0, cap - finalUsed), outcomes };
}
