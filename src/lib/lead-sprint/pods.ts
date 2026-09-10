// ─────────────────────────────────────────────────────────────────────────────
// NATIONAL LEAD SPRINT — MARKET PODS (master mandate §4).
//
// The Sprint runs continuously and nationally, but four INITIAL PRIORITY market pods focus early
// discovery: Greenville, Huntsville, Chattanooga, Northwest Arkansas. A "pod" is a named regional
// cluster of cities/metros — broader than a single city so discovery scours the whole region rather
// than stopping at the first businesses in one town (§4: "Do not stop at the first businesses found").
//
// This is discovery FOCUS only. It never overrides qualification: a business inside a priority pod
// still has to pass suppression, cheap qualification, and scoring like any other. Future tertiary /
// suburban / micropolitan expansion is supported by adding pods — the classifier is data-driven, not
// a scatter of city-name conditions. Populations mirror market-policy's Census provenance.
// ─────────────────────────────────────────────────────────────────────────────
import { regionOfState, type USRegion } from "../market-policy";

export const LEAD_SPRINT_PODS_VERSION = "v1-2026-09";

export type PodPriority = "priority" | "expansion";

export interface MarketPod {
  id: string;                 // stable slug
  label: string;              // human name (e.g. "Greenville region")
  priority: PodPriority;      // priority = one of the four initial pods; expansion = future rollout
  region: USRegion;
  /** Anchor cities (lowercased) whose metros define the pod. Discovery may reach nearby towns too. */
  cities: Array<{ city: string; state: string }>;
  /** Lowercased city names that belong to this pod's regional cluster (anchor + satellites). */
  clusterCities: string[];
  /** States the pod spans (a pod can cross a state line, e.g. NW Arkansas / Chattanooga tri-state). */
  states: string[];
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

// The four initial priority pods. Each lists its anchor metro plus the satellite towns that make the
// pod a REGION, so discovery covers the cluster. Satellites are deliberately conservative (real nearby
// municipalities), not invented — expansion happens by adding verified towns, never by guessing.
export const MARKET_PODS: MarketPod[] = [
  {
    id: "greenville-sc",
    label: "Greenville region",
    priority: "priority",
    region: "South",
    cities: [{ city: "Greenville", state: "SC" }],
    clusterCities: ["greenville", "greer", "mauldin", "simpsonville", "easley", "taylors", "travelers rest", "anderson", "spartanburg"],
    states: ["SC"],
  },
  {
    id: "huntsville-al",
    label: "Huntsville region",
    priority: "priority",
    region: "South",
    cities: [{ city: "Huntsville", state: "AL" }],
    clusterCities: ["huntsville", "madison", "decatur", "athens", "hartselle", "meridianville", "harvest"],
    states: ["AL"],
  },
  {
    id: "chattanooga-tn",
    label: "Chattanooga region",
    priority: "priority",
    region: "South",
    cities: [{ city: "Chattanooga", state: "TN" }],
    // The Chattanooga metro crosses into North Georgia.
    clusterCities: ["chattanooga", "east ridge", "red bank", "soddy-daisy", "collegedale", "cleveland", "fort oglethorpe", "dalton", "ringgold"],
    states: ["TN", "GA"],
  },
  {
    id: "nw-arkansas",
    label: "Northwest Arkansas",
    priority: "priority",
    region: "South",
    cities: [
      { city: "Fayetteville", state: "AR" },
      { city: "Bentonville", state: "AR" },
    ],
    clusterCities: ["fayetteville", "bentonville", "rogers", "springdale", "bella vista", "siloam springs", "farmington", "lowell"],
    states: ["AR"],
  },
];

export interface PodMatch {
  pod: MarketPod | null;
  priority: PodPriority | "none";
}

/**
 * Classify a city/state into a market pod. Anchor/satellite city match wins; otherwise a state-level
 * fallback places a lead in a priority pod's state (still a focus market) as expansion-priority so the
 * pod's regional intent is honored without inventing town membership. Returns none when unmatched.
 */
export function podForLocation(city: string, state: string): PodMatch {
  const c = norm(city);
  const st = norm(state).toUpperCase();
  // Exact cluster-city match (most specific).
  for (const pod of MARKET_PODS) {
    if (pod.states.includes(st) && pod.clusterCities.includes(c)) {
      return { pod, priority: pod.priority };
    }
  }
  // State-level fallback: inside a priority pod's state but not a named cluster town → still a focus
  // region, treated as expansion (lower discovery priority than the named cluster).
  for (const pod of MARKET_PODS) {
    if (pod.states.includes(st)) return { pod, priority: "expansion" };
  }
  return { pod: null, priority: "none" };
}

/** True when a location is inside one of the four initial priority pods' named clusters. */
export function isPriorityPod(city: string, state: string): boolean {
  return podForLocation(city, state).priority === "priority";
}

/** The distinct regions the priority pods cover — used by the dashboard's market-distribution view. */
export function priorityPodRegions(): USRegion[] {
  return Array.from(new Set(MARKET_PODS.filter((p) => p.priority === "priority").map((p) => p.region)));
}

/** Region for an arbitrary lead location (delegates to market-policy so there is one source of truth). */
export function regionForLead(state: string): USRegion {
  return regionOfState(state);
}
