// ─────────────────────────────────────────────────────────────────────────────
// Lead Sprint market registry — the AUTHORITATIVE source of truth for which
// markets are in-scope for the current acquisition wave.
//
// Doctrine (needle-in-the-haystack qualification pass, 2026-09):
//   • Discovery, qualification, and every expensive downstream step must be
//     GATED on market membership BEFORE cost is spent.
//   • First-wave pods are a small set of secondary/regional metros. California
//     is explicitly OUT — it must have ZERO active candidates unless a future
//     configuration re-enables it. Fail CLOSED: an unknown market is NOT in.
//   • This registry is config-overridable (ACQ_ACTIVE_PODS) so production can
//     change the wave without a code change — the constants here are the
//     default, not a hard-code that fights production config.
//
// This module is intentionally free of DB / network / env side effects at import
// time so it is trivially testable and safe to import anywhere in the pipeline.
// ─────────────────────────────────────────────────────────────────────────────
import type { Territory } from "../types";

export interface MarketPod {
  /** Stable id used in config (ACQ_ACTIVE_PODS) and persisted classifications. */
  id: string;
  /** Operator-facing label. */
  label: string;
  /** Primary state(s) the pod spans. */
  states: string[];
  /** Constituent cities (lowercased match set). The pod IS these metros — not
   *  the whole state, so "AL" alone does not qualify a Birmingham lead. */
  cities: string[];
}

// First-wave pods. Cities chosen as the metro + immediate surrounding towns an
// operator would treat as one market. Extend deliberately — every city added
// widens what counts as "in market".
export const FIRST_WAVE_PODS: MarketPod[] = [
  {
    id: "greenville-sc",
    label: "Greenville / Upstate SC",
    states: ["SC"],
    cities: ["greenville", "greer", "simpsonville", "mauldin", "easley", "anderson", "taylors", "travelers rest"],
  },
  {
    id: "huntsville-al",
    label: "Huntsville / Madison AL",
    states: ["AL"],
    cities: ["huntsville", "madison", "athens", "decatur", "meridianville", "harvest", "hampton cove"],
  },
  {
    id: "chattanooga-tn-ga",
    label: "Chattanooga TN / N. GA",
    states: ["TN", "GA"],
    cities: ["chattanooga", "east ridge", "red bank", "soddy-daisy", "hixson", "ooltewah", "signal mountain",
      "fort oglethorpe", "ringgold", "dalton", "rossville"],
  },
  {
    id: "nw-arkansas",
    label: "Northwest Arkansas",
    states: ["AR"],
    cities: ["fayetteville", "springdale", "rogers", "bentonville", "bella vista", "siloam springs", "farmington", "lowell"],
  },
];

// Markets that are explicitly RETIRED for the current wave — never active unless
// individually re-enabled. California is here because the prior wave over-indexed
// on it; the doctrine requires zero active CA candidates.
export const RETIRED_STATES = new Set(["CA"]);

const byId = new Map(FIRST_WAVE_PODS.map((p) => [p.id, p]));

/** Which pod ids are ACTIVE. Defaults to all first-wave pods; production overrides
 *  with ACQ_ACTIVE_PODS="greenville-sc,huntsville-al" (comma-separated ids), or
 *  ACQ_ACTIVE_PODS="none" to freeze discovery. Unknown ids are ignored (fail-safe).
 *  Reads env at CALL time (not import) so tests and config changes take effect. */
export function activePodIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = (env.ACQ_ACTIVE_PODS ?? "").trim();
  if (!raw) return FIRST_WAVE_PODS.map((p) => p.id);
  if (raw.toLowerCase() === "none") return [];
  const requested = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return requested.filter((id) => byId.has(id));
}

/** True when a specific extra state has been explicitly re-enabled (e.g.
 *  ACQ_ENABLE_STATES="CA"). Used to relax RETIRED_STATES without a code change. */
export function explicitlyEnabledStates(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.ACQ_ENABLE_STATES ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  );
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** The pod a location belongs to, or null. Only matches by CITY membership within
 *  an active pod's state — a state alone never qualifies. Fails CLOSED. */
export function marketPodOf(
  loc: { city?: string | null; state?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): MarketPod | null {
  const city = norm(loc.city);
  const state = (loc.state ?? "").trim().toUpperCase();
  if (!city || !state) return null;
  const active = new Set(activePodIds(env));
  for (const pod of FIRST_WAVE_PODS) {
    if (!active.has(pod.id)) continue;
    if (!pod.states.includes(state)) continue;
    if (pod.cities.includes(city)) return pod;
  }
  return null;
}

export type GeoGate =
  | { allowed: true; podId: string; podLabel: string; reason: string }
  | { allowed: false; reason: string; retired: boolean };

/**
 * The GEO GATE — call this BEFORE any expensive work (analysis, screenshots,
 * browser interaction, media, PDF). Allowed only when the lead sits inside an
 * active first-wave pod. Retired states (CA) are reported distinctly so the
 * operator UI can label "wrong geography (retired market)" precisely.
 */
export function geoGate(
  loc: { city?: string | null; state?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): GeoGate {
  const state = (loc.state ?? "").trim().toUpperCase();
  const pod = marketPodOf(loc, env);
  if (pod) return { allowed: true, podId: pod.id, podLabel: pod.label, reason: `in active pod ${pod.label}` };
  const enabled = explicitlyEnabledStates(env);
  if (RETIRED_STATES.has(state) && !enabled.has(state)) {
    return { allowed: false, retired: true, reason: `${state} is a retired market for the current wave` };
  }
  return { allowed: false, retired: false, reason: state ? `${loc.city ?? "?"}, ${state} is outside all active pods` : "no resolved location" };
}

/** Discovery territories for the active wave — the cities of every active pod.
 *  Replaces the old SoCal default so discovery searches in-market by construction. */
export function activePodTerritories(env: NodeJS.ProcessEnv = process.env): Territory[] {
  const active = new Set(activePodIds(env));
  const out: Territory[] = [];
  for (const pod of FIRST_WAVE_PODS) {
    if (!active.has(pod.id)) continue;
    for (const city of pod.cities) {
      // Title-case the city for display; state from the pod's first state that
      // is consistent for single-state pods. Chattanooga pod spans TN/GA, so we
      // tag each city with the correct state below.
      out.push({ city: titleCase(city), state: stateForCity(pod, city) });
    }
  }
  return out;
}

function stateForCity(pod: MarketPod, city: string): string {
  // GA towns in the Chattanooga pod; everything else is the pod's primary state.
  const gaTowns = new Set(["fort oglethorpe", "ringgold", "dalton", "rossville"]);
  if (pod.id === "chattanooga-tn-ga") return gaTowns.has(city) ? "GA" : "TN";
  return pod.states[0];
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
