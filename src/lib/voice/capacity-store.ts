// ─────────────────────────────────────────────────────────────────────────────
// VOICE CAPACITY — LIVE ASSEMBLER (mandate C). Gathers the real signals the pure
// Capacity Manager needs and returns a VoiceCapacity. Read-only: never sends, never
// charges, never generates. EVERY external signal is guarded — a failing subsystem
// degrades to "thin data → labelled conservative fallback", never a crash or a
// fabricated number. Acquisition and Social voice lineage stay SEPARATE: prospect vs
// social voiceovers are distinguished by the `social-` leadId prefix, so a social
// average never contaminates the prospect forecast and vice-versa.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings } from "../repo";
import { getVoiceConfig, listVoiceovers, type VoiceoverRecord } from "./store";
import { resolveVoiceUsageConfig, computeVoiceUsage } from "./usage";
import {
  computeVoiceCapacity,
  forecastAcquisitionReserve,
  DEFAULT_RESERVE_CONFIG,
  type ReserveConfig,
  type AcquisitionDemandSignals,
  type VoiceCapacity,
} from "./capacity";
import { fetchProviderBalance } from "./provider-balance";
import type { ProviderBalance } from "./capacity";

const SOCIAL_LEAD_PREFIX = "social-";

/** Reserve knobs, resolved from Settings.voiceCapacity → env → defaults. */
export async function getReserveConfig(env: NodeJS.ProcessEnv = process.env): Promise<ReserveConfig> {
  const stored = ((await getSettings()) as any).voiceCapacity ?? {};
  const envNum = (k: string): number | null => {
    const raw = (env[k] ?? "").trim();
    const n = Number(raw);
    return raw && Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    fallbackReserveMinutes:
      num(stored.fallbackReserveMinutes) ?? envNum("ELEVENLABS_ACQ_RESERVE_FALLBACK_MIN") ?? DEFAULT_RESERVE_CONFIG.fallbackReserveMinutes,
    fallbackProspectMinutes:
      num(stored.fallbackProspectMinutes) ?? envNum("ELEVENLABS_PROSPECT_FALLBACK_MIN") ?? DEFAULT_RESERVE_CONFIG.fallbackProspectMinutes,
    horizonDays:
      num(stored.horizonDays) ?? envNum("ELEVENLABS_RESERVE_HORIZON_DAYS") ?? DEFAULT_RESERVE_CONFIG.horizonDays,
  };
}

/** Persist a reserve-config change (operator). Never touches usage/ledger history. */
export async function setReserveConfig(patch: Partial<ReserveConfig>, _actor: string): Promise<ReserveConfig> {
  const cur = ((await getSettings()) as any).voiceCapacity ?? {};
  const next = { ...cur, ...clean(patch) };
  await updateSettings({ voiceCapacity: next } as any);
  return getReserveConfig();
}

/** Average MEASURED duration (seconds) of READY voiceovers matching a lineage predicate. */
function averageSeconds(records: VoiceoverRecord[], pred: (r: VoiceoverRecord) => boolean): number {
  const ready = records.filter((r) => r.status === "VOICEOVER_READY" && (r.durationSeconds ?? 0) > 0 && pred(r));
  if (!ready.length) return 0;
  const total = ready.reduce((n, r) => n + (r.durationSeconds ?? 0), 0);
  return total / ready.length;
}

export interface CapacitySignalsOverride {
  finalistsMeetingContract?: number;
  readyToSendInventory?: number;
  combinedDailyCapacity?: number;
}

// A tiny module-scope cache so a page that renders/polls often doesn't hammer the
// provider subscription endpoint. 60s TTL; fail-open. Deliberately not persisted.
let _balanceCache: { at: number; value: ProviderBalance | null } | null = null;
async function cachedProviderBalance(nowMs: number): Promise<ProviderBalance | null> {
  if (_balanceCache && nowMs - _balanceCache.at < 60_000) return _balanceCache.value;
  const value = await fetchProviderBalance().catch(() => null);
  _balanceCache = { at: nowMs, value };
  return value;
}

/**
 * Load the live shared VoiceCapacity. `pre` lets a caller that already fetched the
 * pipeline signals (e.g. the cockpit) avoid re-fetching them. `nowMs` is injectable so
 * the provider-balance cache is testable without a real clock.
 */
export async function loadVoiceCapacity(
  nowIso: string,
  pre: CapacitySignalsOverride = {},
  opts: { skipProviderBalance?: boolean; nowMs?: number } = {},
): Promise<VoiceCapacity> {
  // 1) Usage meter over the READY voiceover records (the ONE existing meter).
  const voiceCfg = await getVoiceConfig().catch(() => ({ monthlyMinuteBudget: null, billingResetDay: null, hardCapMinutes: null }));
  const { config, source } = resolveVoiceUsageConfig(voiceCfg as any);
  const records = await listVoiceovers().catch(() => [] as VoiceoverRecord[]);
  const usage = computeVoiceUsage(records, config, nowIso);

  // 2) Lineage-separated averages (prospect vs social).
  const avgProspect = averageSeconds(records, (r) => !r.leadId.startsWith(SOCIAL_LEAD_PREFIX));
  const avgSocial = averageSeconds(records, (r) => r.leadId.startsWith(SOCIAL_LEAD_PREFIX));

  // 3) Acquisition pipeline signals — each guarded to a safe default (→ thin-data fallback).
  const finalistsMeetingContract = pre.finalistsMeetingContract ?? (await safeFinalists(nowIso));
  const combinedDailyCapacity = pre.combinedDailyCapacity ?? (await safeCombinedCapacity(nowIso));
  const readyToSendInventory = pre.readyToSendInventory ?? (await safeReadyToSend());

  const signals: AcquisitionDemandSignals = {
    finalistsMeetingContract,
    readyToSendInventory,
    combinedDailyCapacity,
    avgProspectNarrationSeconds: avgProspect,
  };

  const reserveCfg = await getReserveConfig();
  const daysUntilReset = usage.billingResetDate
    ? Math.max(0, Math.ceil((new Date(usage.billingResetDate).getTime() - new Date(nowIso).getTime()) / (24 * 3600 * 1000)))
    : null;
  const reserve = forecastAcquisitionReserve(signals, daysUntilReset, reserveCfg);

  // 4) Optional real provider balance (best-effort, cached, fail-open).
  const provider = opts.skipProviderBalance ? null : await cachedProviderBalance(opts.nowMs ?? new Date(nowIso).getTime());

  const allowanceSource: VoiceCapacity["allowanceSource"] =
    source.monthlyMinuteBudget !== "unset"
      ? source.monthlyMinuteBudget
      : provider?.charactersLimit != null
        ? "provider"
        : "unset";

  return computeVoiceCapacity({
    usage,
    allowanceSource,
    reserve,
    provider,
    averageSocialSeconds: avgSocial,
    nowIso,
  });
}

// ── Guarded signal fetchers — a failure yields the safe default, never a throw ──────
async function safeFinalists(nowIso: string): Promise<number> {
  try {
    const { computeLeadSprintSnapshot } = await import("../lead-sprint/snapshot");
    const cap = await safeCombinedCapacity(nowIso);
    const snap = await computeLeadSprintSnapshot({ now: nowIso, nearTermCapacity: cap, podsOnly: true } as any);
    return Math.max(0, (snap as any).finalistsMeetingContract ?? 0);
  } catch {
    return 0;
  }
}
async function safeCombinedCapacity(nowIso: string): Promise<number> {
  try {
    const { rampView } = await import("../comms/ramp-store");
    const rv = await rampView(nowIso);
    return Math.max(0, rv.combinedDailyCapacity ?? 0);
  } catch {
    return 0;
  }
}
async function safeReadyToSend(): Promise<number> {
  try {
    const { listOffers, effectiveOutreachState } = await import("../quick-fix/store");
    const offers = await listOffers();
    return offers.filter((o) => effectiveOutreachState(o) === "APPROVED_NOT_SENT").length;
  } catch {
    return 0;
  }
}

function num(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}
function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (num(v) != null) out[k] = v;
  return out as Partial<T>;
}

/** TEST ONLY: clear the provider-balance cache between cases. */
export function __resetCapacityCacheForTests(): void {
  _balanceCache = null;
}
