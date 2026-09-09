// ─────────────────────────────────────────────────────────────────────────────
// SENDER HEALTH + ROTATION — deterministic dual-sender allocation with per-sender
// daily caps and a cooldown on repeated failure. Conservative by default (does NOT
// maximize volume). Per-sender caps STACK UNDER the existing global outreach cap —
// they never replace it. One sender's failure cannot cause unlimited spillover:
// the other sender still has its own cap, and a failing sender enters cooldown.
// State lives in the Settings singleton (survives deploy, no migration). No secrets.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings } from "../../repo";
import { configuredSenderIds, listSenderPublic } from "./sender-registry";
import { senderDailyCap } from "./config";

export interface SenderHealthState {
  date: string; // LA accounting date the counters belong to
  sentToday: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  consecutiveErrors: number;
  cooldownUntil: string | null; // ISO; while > now the sender is skipped
}

const COOLDOWN_MS = Number(process.env.GOOGLE_SENDER_COOLDOWN_MS ?? 15 * 60_000);
const COOLDOWN_ERROR_THRESHOLD = 3;

function laDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function fresh(date: string): SenderHealthState {
  return { date, sentToday: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null, consecutiveErrors: 0, cooldownUntil: null };
}

/** Normalize a stored state onto the current accounting date (resets daily counters). */
function forDate(prev: SenderHealthState | undefined, date: string): SenderHealthState {
  if (!prev) return fresh(date);
  if (prev.date !== date) return { ...fresh(date), lastSuccessAt: prev.lastSuccessAt, lastErrorAt: prev.lastErrorAt, lastErrorCode: prev.lastErrorCode };
  return prev;
}

async function readHealth(): Promise<Record<string, SenderHealthState>> {
  const s = (await getSettings()) as any;
  return (s.senderHealth ?? {}) as Record<string, SenderHealthState>;
}

async function writeHealth(next: Record<string, SenderHealthState>): Promise<void> {
  await updateSettings({ senderHealth: next } as any);
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export type SenderSelection =
  | { ok: true; senderId: string; address: string; sentToday: number; cap: number }
  | { ok: false; reason: string };

/**
 * Pick an eligible healthy sender. Deterministic per lead (stable attribution →
 * replies return to the mailbox that actually sends), constrained by per-sender
 * daily cap and cooldown. Read-only — consuming a slot happens on recordSuccess.
 */
export async function selectSender(args: { leadId?: string; now?: Date; env?: NodeJS.ProcessEnv }): Promise<SenderSelection> {
  const env = args.env ?? process.env;
  const now = args.now ?? new Date();
  const ids = configuredSenderIds(env);
  if (ids.length === 0) return { ok: false, reason: "no configured Google Workspace senders" };
  const cap = senderDailyCap(env);
  const date = laDate(now);
  const health = await readHealth();
  const nowIso = now.toISOString();

  const eligible = ids.filter((id) => {
    const st = forDate(health[id], date);
    const cooling = !!st.cooldownUntil && st.cooldownUntil > nowIso;
    return st.sentToday < cap && !cooling;
  });
  if (eligible.length === 0) return { ok: false, reason: "all configured senders are at their daily cap or cooling down" };

  const idx = args.leadId ? hash(args.leadId) % eligible.length : 0;
  const senderId = eligible[idx];
  const address = listSenderPublic(env).find((s) => s.id === senderId)?.address ?? "";
  const st = forDate(health[senderId], date);
  return { ok: true, senderId, address, sentToday: st.sentToday, cap };
}

/** Record a successful send against a sender (increments the daily count, clears errors). */
export async function recordSenderSuccess(senderId: string, nowIso: string): Promise<void> {
  const date = laDate(new Date(nowIso));
  const health = await readHealth();
  const st = forDate(health[senderId], date);
  health[senderId] = { ...st, date, sentToday: st.sentToday + 1, lastSuccessAt: nowIso, consecutiveErrors: 0, cooldownUntil: null };
  await writeHealth(health);
}

/** Record a transport error; after repeated failures the sender enters cooldown. */
export async function recordSenderError(senderId: string, nowIso: string, code: string): Promise<void> {
  const date = laDate(new Date(nowIso));
  const health = await readHealth();
  const st = forDate(health[senderId], date);
  const consecutiveErrors = st.consecutiveErrors + 1;
  const cooldownUntil = consecutiveErrors >= COOLDOWN_ERROR_THRESHOLD ? new Date(new Date(nowIso).getTime() + COOLDOWN_MS).toISOString() : st.cooldownUntil;
  health[senderId] = { ...st, date, lastErrorAt: nowIso, lastErrorCode: code, consecutiveErrors, cooldownUntil };
  await writeHealth(health);
}

export interface SenderHealthRow {
  id: string;
  address: string;
  sentToday: number;
  cap: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  cooldownUntil: string | null;
  healthy: boolean;
}

/** Non-secret snapshot for diagnostics / operator display. */
export async function senderHealthSnapshot(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<SenderHealthRow[]> {
  const cap = senderDailyCap(env);
  const date = laDate(now);
  const nowIso = now.toISOString();
  const health = await readHealth();
  return listSenderPublic(env).map((s) => {
    const st = forDate(health[s.id], date);
    const cooling = !!st.cooldownUntil && st.cooldownUntil > nowIso;
    return {
      id: s.id, address: s.address, sentToday: st.sentToday, cap,
      lastSuccessAt: st.lastSuccessAt, lastErrorAt: st.lastErrorAt, lastErrorCode: st.lastErrorCode,
      cooldownUntil: st.cooldownUntil, healthy: st.sentToday < cap && !cooling,
    };
  });
}
