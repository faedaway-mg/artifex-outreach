// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT OUTBOUND LANES — the two independently-configured Google Workspace cold
// lanes (A and B) as a single non-secret read-model. Each lane has its own address,
// domain, per-lane daily cap, enabled/disabled switch, and live health (sent-today,
// failure, cooldown). This is the source of truth the Launch Readiness gate and the
// operator dashboard both read, so "which mail system does which job" is explicit.
//
// SECRET SAFETY: only non-secret values (addresses, booleans, counters) are exposed;
// refresh tokens / client secret are never read here.
//
// CAPS: per-lane caps are configurable and NEVER assumed. `GOOGLE_SENDER_<n>_DAILY_CAP`
// overrides the shared `GOOGLE_SENDER_DAILY_CAP` for that lane; both default to the
// conservative shared default. Two configured lanes do NOT automatically authorize
// 40 sends/day — the combined capacity is simply the sum of each lane's OWN remaining
// capacity, and a disabled/unhealthy lane contributes zero (no quota transfer).
// ─────────────────────────────────────────────────────────────────────────────
import { listSenderPublic } from "./sender-registry";
import { LANE_SLOTS, laneDailyCap, laneEnabled } from "./config";
import { senderHealthSnapshot, type SenderHealthRow } from "./sender-health";

export { LANE_SLOTS, laneDailyCap, laneEnabled };

const trim = (v: string | undefined | null): string => (typeof v === "string" ? v.trim() : "");

export interface ProspectLaneView {
  id: string;              // "sender-1" | "sender-2"
  label: string;           // "A" | "B"
  address: string | null;  // non-secret mailbox address (null when not configured)
  domain: string | null;
  configured: boolean;     // address + refresh token both present
  authenticated: boolean;  // credential fully resolvable (address + token + OAuth app)
  enabled: boolean;        // operator switch
  healthy: boolean;        // enabled + configured + under cap + not cooling
  sentToday: number;
  cap: number;             // this lane's OWN daily cap
  remaining: number;       // max(0, cap - sentToday) when healthy, else 0
  cooldownUntil: string | null;
  lastErrorCode: string | null;
}

export interface ProspectLanesView {
  transport: "google-workspace";
  lanes: ProspectLaneView[];
  configuredLaneCount: number;
  /** Sum of each HEALTHY, ENABLED lane's OWN remaining capacity. No quota transfer between lanes. */
  combinedCapacityRemaining: number;
  /** True when at least one lane is healthy + enabled + has capacity (prospect outbound is possible). */
  anyLaneAvailable: boolean;
  /** OAuth app present (client id + secret). */
  oauthConfigured: boolean;
}

/**
 * Build the full two-lane view (config + health + capacity). READ-ONLY. Merges the static per-lane
 * config with the live health snapshot; a lane's cap/enabled are applied per-lane (not the shared cap).
 */
export async function prospectLanesView(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<ProspectLanesView> {
  const health = await senderHealthSnapshot(env, now).catch(() => [] as SenderHealthRow[]);
  const healthById = new Map(health.map((h) => [h.id, h]));
  const publicById = new Map(listSenderPublic(env).map((s) => [s.id, s]));
  const nowIso = now.toISOString();
  const oauthConfigured = !!trim(env.GOOGLE_OAUTH_CLIENT_ID) && !!trim(env.GOOGLE_OAUTH_CLIENT_SECRET);

  const lanes: ProspectLaneView[] = LANE_SLOTS.map((slot) => {
    const address = trim(env[slot.addrKey]) || null;
    const refreshTokenConfigured = !!trim(env[slot.tokKey]);
    const configured = !!address && refreshTokenConfigured;
    const authenticated = configured && oauthConfigured;
    const enabled = laneEnabled(slot.id, env);
    const cap = laneDailyCap(slot.id, env);
    const h = healthById.get(slot.id);
    const sentToday = h?.sentToday ?? 0;
    const cooldownUntil = h?.cooldownUntil ?? null;
    const cooling = !!cooldownUntil && cooldownUntil > nowIso;
    const healthy = authenticated && enabled && sentToday < cap && !cooling;
    return {
      id: slot.id, label: slot.label, address, domain: address ? address.split("@")[1]?.toLowerCase() ?? null : null,
      configured, authenticated, enabled, healthy, sentToday, cap,
      remaining: healthy ? Math.max(0, cap - sentToday) : 0,
      cooldownUntil, lastErrorCode: h?.lastErrorCode ?? (publicById.has(slot.id) ? null : null),
    };
  });

  return {
    transport: "google-workspace",
    lanes,
    configuredLaneCount: lanes.filter((l) => l.configured).length,
    combinedCapacityRemaining: lanes.reduce((sum, l) => sum + l.remaining, 0),
    anyLaneAvailable: lanes.some((l) => l.healthy && l.remaining > 0),
    oauthConfigured,
  };
}
