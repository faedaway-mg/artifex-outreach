// ─────────────────────────────────────────────────────────────────────────────
// Business Intelligence Profile — public surface.
//
// Import from "@/lib/business-intelligence" so the internal module layout (signals,
// rules, context) can evolve without touching consumers. See ./ARCHITECTURE.md.
// ─────────────────────────────────────────────────────────────────────────────
export * from "./types";
export * from "./confidence";
export { buildContext, reading } from "./context";
export { buildBusinessProfile } from "./profile";
export { ALL_SIGNALS, SIGNALS_BY_DIMENSION, DIGITAL_PRESENCE_SIGNALS, DISCOVERY_SIGNALS, CUSTOMER_EXPERIENCE_SIGNALS, OPERATIONS_SIGNALS } from "./signals";
export { OPPORTUNITY_RULES, deriveOpportunities } from "./opportunities";
export { openingFromProfile, toDeliverableOpportunities, toExecutiveDigest } from "./adapters";
