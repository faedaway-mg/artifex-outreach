// ─────────────────────────────────────────────────────────────────────────────
// ACQUISITION CAPACITY MODES — an explicit operating posture so Quick-Cash can be
// throttled/delegated/paused later (e.g. when GovCon starts consuming capacity)
// WITHOUT breaking customer service. Parallel in spirit to legacy-freeze: a small,
// durable, env-driven gate checked at the dispatch boundary.
//
//   GROWTH    — expand discovery to fill the qualified-inventory target. Actual
//               sends still obey transport caps + operator approvals + freeze/pause.
//   MAINTAIN  — reduced new acquisition; emphasize existing customers / repeats.
//   PAUSED    — no NEW cold Quick-Cash outbound. Customer / transactional / reply /
//               fulfillment traffic remains fully operational.
//   DELEGATED — discovery/sales may continue per configured fulfillment-team
//               capacity; the system must never exceed actual delivery capacity.
//
// INVARIANTS: customer/transactional traffic is NEVER gated by capacity mode. The
// mode NEVER changes sender caps. DELEGATED is never auto-activated — only an
// explicit operator env selects it. The current cold freeze is independent and is
// never altered here.
// ─────────────────────────────────────────────────────────────────────────────

export type CapacityMode = "GROWTH" | "MAINTAIN" | "PAUSED" | "DELEGATED";

export const CAPACITY_MODE_ENV = "QUICKCASH_CAPACITY_MODE";

const VALID: CapacityMode[] = ["GROWTH", "MAINTAIN", "PAUSED", "DELEGATED"];

/** Resolve the current mode from env. Defaults to GROWTH (no behavior change). */
export function currentCapacityMode(env: NodeJS.ProcessEnv = process.env): CapacityMode {
  const v = (env[CAPACITY_MODE_ENV] ?? "").trim().toUpperCase() as CapacityMode;
  return VALID.includes(v) ? v : "GROWTH";
}

export interface CapacityPosture {
  mode: CapacityMode;
  /** May NEW cold Quick-Cash outbound run? (Still subject to caps/freeze/pause.) */
  coldOutreachAllowed: boolean;
  /** May we discover/qualify NEW acquisition leads? */
  newAcquisitionAllowed: boolean;
  /** May discovery EXPAND breadth to fill the inventory target? */
  discoveryExpansionAllowed: boolean;
  /** ALWAYS true — customer / transactional / reply / fulfillment is never gated by mode. */
  customerTrafficAllowed: true;
  /** Sender caps are authoritative and NEVER changed by mode. */
  altersSenderCaps: false;
  note: string;
}

export function capacityPosture(mode: CapacityMode = currentCapacityMode()): CapacityPosture {
  const base = { mode, customerTrafficAllowed: true as const, altersSenderCaps: false as const };
  switch (mode) {
    case "PAUSED":
      return { ...base, coldOutreachAllowed: false, newAcquisitionAllowed: false, discoveryExpansionAllowed: false, note: "PAUSED — no new cold Quick-Cash outbound. Customer/transactional/reply/fulfillment fully operational." };
    case "MAINTAIN":
      return { ...base, coldOutreachAllowed: true, newAcquisitionAllowed: true, discoveryExpansionAllowed: false, note: "MAINTAIN — reduced new acquisition; emphasize existing customers/repeats. Discovery does not expand." };
    case "DELEGATED":
      return { ...base, coldOutreachAllowed: true, newAcquisitionAllowed: true, discoveryExpansionAllowed: true, note: "DELEGATED — discovery/sales continue per configured fulfillment-team capacity; never exceed actual delivery capacity." };
    case "GROWTH":
    default:
      return { ...base, coldOutreachAllowed: true, newAcquisitionAllowed: true, discoveryExpansionAllowed: true, note: "GROWTH — expand discovery to the qualified-inventory target. Sends still obey caps + approvals." };
  }
}

/** The gate the cold-dispatch boundary consults. PAUSED stops NEW cold outbound. */
export function coldOutreachAllowedByCapacity(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; mode: CapacityMode; reason: string } {
  const posture = capacityPosture(currentCapacityMode(env));
  return { allowed: posture.coldOutreachAllowed, mode: posture.mode, reason: posture.coldOutreachAllowed ? `capacity mode ${posture.mode} permits cold outbound (still capped/approved)` : `capacity mode ${posture.mode} — new cold Quick-Cash outbound is paused; customer traffic unaffected` };
}
