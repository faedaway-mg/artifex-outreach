// ─────────────────────────────────────────────────────────────────────────────
// Shared daily send quota — ATOMIC reservation over the email_sends ledger.
//
// The daily cap is one shared pool per America/Los_Angeles day, drawn down by follow-ups, manual
// sends, AND automated outreach alike (they all write email_sends rows). A plain "count then send"
// is NOT concurrency-safe: two workers (or two overlapping cron ticks, or a manual send racing a
// scheduled one) can both read "19 used, 1 left" and both send → 21. This module closes that race.
//
// reserveDailySlot() serializes the count+insert for a given LA day behind a Postgres transaction-
// scoped ADVISORY LOCK, counts the day's quota-consuming rows, and — only if under the cap — inserts
// a reservation row in the SAME transaction. The unique index on idempotency_key additionally makes
// a given (lead, day) reservation exactly-once. A reservation that never ships is released (deleted);
// one that ships is consumed (queued → sent) via the normal ledger status. On the in-memory backend
// the check+insert runs synchronously with no await between them, so it is atomic in the single JS
// thread (same guarantee the editorial CAS relies on).
// ─────────────────────────────────────────────────────────────────────────────
import { sql } from "drizzle-orm";
import { hasDb, getDb } from "@/db/client";
import * as t from "@/db/schema";
import { db as mem, newId, nowIso } from "../store";
import type { EmailSend } from "../types";

export const ACCOUNTING_TZ = "America/Los_Angeles";
// A ledger row DRAWS DOWN the daily pool unless it permanently FAILED (never left the system):
// reservations, queued, sending, and every sent-family status all count. Expressed as `status <>
// 'failed'` in SQL and `memConsumes` in memory. A released reservation is deleted, never lingering.
const RESERVATION_PROVIDER = "reservation"; // marks a bare quota hold (not yet a real send)

/** The cap-accounting day key (YYYY-MM-DD) in America/Los_Angeles — one shared quota per LA day. */
export function laDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ACCOUNTING_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** LA-day key of a stored ledger timestamp (ISO/UTC), for the in-memory backend. */
function rowLaDay(r: EmailSend): string {
  const iso = r.sentAt ?? (r as any).sendingAt ?? r.queuedAt ?? r.createdAt;
  return laDayKey(new Date(iso));
}
function memConsumes(r: EmailSend): boolean {
  // A row draws down the pool unless it permanently FAILED (never left the system). Released
  // reservations are deleted, so they never linger here. Mirrors the SQL `status <> 'failed'`.
  return r.status !== ("failed" as any);
}

export interface ReserveResult {
  granted: boolean;
  reason?: "quota-reached" | "already-reserved";
  reservationId?: string;
  /** For an already-reserved hold: the current ledger status, so a re-tick can tell a shipped send
   *  (skip, don't resend) from a bare "reserved" hold left by a crashed prior tick (safe to recover). */
  existingStatus?: string;
  used?: number; // quota-consuming rows for the day AFTER this call
}

/**
 * Atomically reserve one slot in the shared LA-day quota. Serialized per day (advisory lock on the
 * real DB; synchronous check-insert in memory), so concurrent callers competing for the final slot
 * resolve to exactly ONE grant. Idempotent per (lead, day): a repeat returns the existing hold
 * without consuming another slot. Returns granted=false with reason "quota-reached" when full.
 */
export async function reserveDailySlot(opts: { now: Date; cap: number; leadId: string; key?: string }): Promise<ReserveResult> {
  const dayKey = laDayKey(opts.now);
  const key = opts.key ?? `qr-slot:${opts.leadId}:${dayKey}`;
  const now = opts.now.toISOString();

  if (hasDb()) {
    return await getDb().transaction(async (tx) => {
      // Serialize ALL reservations for this LA day. Transaction-scoped: released on commit/rollback.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${dayKey}, 0))`);
      const existing: any = await tx.execute(sql`select id, status from email_sends where idempotency_key = ${key} limit 1`);
      const exRow = (Array.isArray(existing) ? existing[0] : existing?.rows?.[0]);
      if (exRow) return { granted: true, reason: "already-reserved", reservationId: exRow.id, existingStatus: exRow.status };
      // Count the day's quota-consuming rows by their LA calendar day (naive-UTC → LA, DST-correct).
      const cntRes: any = await tx.execute(sql`
        select count(*)::int as n from email_sends
        where status <> 'failed'
          and to_char(((coalesce(sent_at, sending_at, queued_at, created_at)::timestamp at time zone 'UTC') at time zone ${ACCOUNTING_TZ}), 'YYYY-MM-DD') = ${dayKey}
      `);
      const used = Number((Array.isArray(cntRes) ? cntRes[0] : cntRes?.rows?.[0])?.n ?? 0);
      if (used >= opts.cap) return { granted: false, reason: "quota-reached", used };
      const id = newId("esend");
      await tx.execute(sql`
        insert into email_sends (id, idempotency_key, step_id, plan_id, lead_id, to_addr, from_addr, subject, status, provider, provider_message_id, attempts, queued_at, created_at, updated_at)
        values (${id}, ${key}, null, null, ${opts.leadId}, '', '', '', 'reserved', ${RESERVATION_PROVIDER}, null, 0, ${now}, ${now}, ${now})
      `);
      return { granted: true, reservationId: id, used: used + 1 };
    });
  }

  // In-memory backend: synchronous check + push, atomic in one JS thread (no await between).
  const arr = ((mem() as any).emailSends ??= []) as EmailSend[];
  const ex = arr.find((r) => r.idempotencyKey === key);
  if (ex) return { granted: true, reason: "already-reserved", reservationId: ex.id, existingStatus: ex.status };
  const used = arr.filter((r) => memConsumes(r) && rowLaDay(r) === dayKey).length;
  if (used >= opts.cap) return { granted: false, reason: "quota-reached", used };
  const id = newId("esend");
  arr.push({ id, idempotencyKey: key, stepId: null, planId: null, leadId: opts.leadId, toAddr: "", fromAddr: "", subject: "", status: "reserved" as any, provider: RESERVATION_PROVIDER, providerMessageId: null, attempts: 0, lastError: null, lastErrorCode: null, nextAttemptAt: null, queuedAt: now, sendingAt: null, sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null, createdAt: now, updatedAt: now } as EmailSend);
  return { granted: true, reservationId: id, used: used + 1 };
}

/** Release a bare reservation (a hold that never shipped), returning the slot to the pool. Never
 *  touches a row that already advanced past "reserved" (i.e. a real send in flight). */
export async function releaseSlot(reservationId: string): Promise<void> {
  if (hasDb()) {
    await getDb().execute(sql`delete from email_sends where id = ${reservationId} and status = 'reserved' and provider = ${RESERVATION_PROVIDER}`);
    return;
  }
  const arr = ((mem() as any).emailSends ??= []) as EmailSend[];
  const i = arr.findIndex((r) => r.id === reservationId && r.status === ("reserved" as any) && r.provider === RESERVATION_PROVIDER);
  if (i >= 0) arr.splice(i, 1);
}

/** Consume a reservation once the send actually left: reserved → sent (keeps the slot drawn down). */
export async function consumeSlot(reservationId: string, patch: Partial<EmailSend> = {}): Promise<void> {
  const p = { ...patch, status: "sent" as EmailSend["status"], sentAt: patch.sentAt ?? nowIso(), updatedAt: nowIso() };
  if (hasDb()) {
    await getDb().update(t.emailSends).set(p as any).where(sql`id = ${reservationId} and status = 'reserved'`);
    return;
  }
  const arr = ((mem() as any).emailSends ??= []) as EmailSend[];
  const r = arr.find((x) => x.id === reservationId && x.status === ("reserved" as any));
  if (r) Object.assign(r, p);
}

/** Read-only: quota-consuming rows for the LA day of `now` (for reporting / the dry run). */
export async function countSlotsUsed(now: Date): Promise<number> {
  const dayKey = laDayKey(now);
  if (hasDb()) {
    const res: any = await getDb().execute(sql`
      select count(*)::int as n from email_sends
      where status <> 'failed'
        and to_char(((coalesce(sent_at, sending_at, queued_at, created_at)::timestamp at time zone 'UTC') at time zone ${ACCOUNTING_TZ}), 'YYYY-MM-DD') = ${dayKey}
    `);
    return Number((Array.isArray(res) ? res[0] : res?.rows?.[0])?.n ?? 0);
  }
  const arr = ((mem() as any).emailSends ??= []) as EmailSend[];
  return arr.filter((r) => memConsumes(r) && rowLaDay(r) === dayKey).length;
}
