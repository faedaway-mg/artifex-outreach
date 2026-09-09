// ─────────────────────────────────────────────────────────────────────────────
// JURISDICTION SEND-ELIGIBILITY REGISTRY — cold-email law is jurisdiction-specific.
// A lead can be a perfect commercial prospect and still NOT be sendable. Country is
// a HARD input before any cold outreach. UNKNOWN fails closed. Rules are NOT
// inherited between countries ("Europe" is not one regime). No jurisdiction rule
// here is derived from model memory: a rule may ENABLE production sending only when
// it carries a real primary-regulator source + reviewed date + version.
//
// Current posture: the United States is the active operating jurisdiction (its
// CAN-SPAM compliance is already implemented in the send path — see comms/
// commercial-message.ts + acquisition/compliance.ts). Every other jurisdiction is
// architected but DISABLED (review/blocked) until a sourced rule clears it.
// ─────────────────────────────────────────────────────────────────────────────

export type SendEligibilityState =
  | "SEND_ALLOWED_WITH_RULES"
  | "REQUIRES_ENTITY_CLASSIFICATION"
  | "REQUIRES_COMPLIANCE_REVIEW"
  | "BLOCKED_FOR_COLD_EMAIL"
  | "UNKNOWN";

export type EntityType = "corporation" | "sole-trader" | "partnership" | "individual" | "unknown";

export interface JurisdictionRule {
  country: string; // canonical key, e.g. "US", "GB", "CA"
  label: string;
  state: SendEligibilityState;
  /** Whether the law's treatment depends on the recipient's entity type. */
  requiresEntityType: boolean;
  allowedEntityTypes: EntityType[];
  requiredMessageElements: string[];
  suppressionRequired: boolean;
  /** Primary regulator/government source. null ⇒ rule is NOT production-enabled. */
  source: string | null;
  sourceType: "primary-regulator" | "secondary" | "none";
  reviewedAt: string | null; // ISO date the rule was reviewed
  ruleVersion: string | null;
  operatorApprovedVersion: string | null;
  notes: string;
}

export interface JurisdictionVerdict {
  country: string;
  state: SendEligibilityState;
  /** True ONLY when a sourced, operator-approved rule affirmatively allows a cold send. */
  coldSendAllowed: boolean;
  requiredMessageElements: string[];
  reasons: string[];
  rule: JurisdictionRule | null;
}

// Only the US is production-enabled — it is the jurisdiction whose compliance the
// system already implements and operates under. Everything else is disabled pending
// a sourced legal review; none inherits another country's rule.
const REGISTRY: Record<string, JurisdictionRule> = {
  US: {
    country: "US", label: "United States",
    state: "SEND_ALLOWED_WITH_RULES", requiresEntityType: false, allowedEntityTypes: ["corporation", "sole-trader", "partnership", "individual", "unknown"],
    requiredMessageElements: ["accurate from/subject", "physical postal address", "clear opt-out (List-Unsubscribe + link)", "honor opt-out promptly"],
    suppressionRequired: true,
    source: "FTC CAN-SPAM Act — 16 CFR Part 316 (implemented in comms/commercial-message.ts + acquisition/compliance.ts)",
    sourceType: "primary-regulator", reviewedAt: "2026-09-09", ruleVersion: "us-canspam-v1", operatorApprovedVersion: "us-canspam-v1",
    notes: "Active operating jurisdiction. Cold B2B commercial email permitted with the required elements above, all already enforced by the send path.",
  },
  GB: { country: "GB", label: "United Kingdom", state: "REQUIRES_COMPLIANCE_REVIEW", requiresEntityType: true, allowedEntityTypes: [], requiredMessageElements: [], suppressionRequired: true, source: null, sourceType: "none", reviewedAt: null, ruleVersion: null, operatorApprovedVersion: null, notes: "PECR/UK-GDPR treat sole traders/individuals differently from corporate bodies. Needs a sourced rule + entity classification before enabling." },
  CA: { country: "CA", label: "Canada", state: "REQUIRES_COMPLIANCE_REVIEW", requiresEntityType: true, allowedEntityTypes: [], requiredMessageElements: [], suppressionRequired: true, source: null, sourceType: "none", reviewedAt: null, ruleVersion: null, operatorApprovedVersion: null, notes: "CASL is consent-based and strict. Do not enable without a sourced rule." },
  AU: { country: "AU", label: "Australia", state: "REQUIRES_COMPLIANCE_REVIEW", requiresEntityType: false, allowedEntityTypes: [], requiredMessageElements: [], suppressionRequired: true, source: null, sourceType: "none", reviewedAt: null, ruleVersion: null, operatorApprovedVersion: null, notes: "Spam Act 2003 (consent/identify/unsubscribe). Needs a sourced rule before enabling." },
  NZ: { country: "NZ", label: "New Zealand", state: "REQUIRES_COMPLIANCE_REVIEW", requiresEntityType: false, allowedEntityTypes: [], requiredMessageElements: [], suppressionRequired: true, source: null, sourceType: "none", reviewedAt: null, ruleVersion: null, operatorApprovedVersion: null, notes: "Unsolicited Electronic Messages Act 2007. Needs a sourced rule before enabling." },
  IE: { country: "IE", label: "Ireland", state: "REQUIRES_COMPLIANCE_REVIEW", requiresEntityType: true, allowedEntityTypes: [], requiredMessageElements: [], suppressionRequired: true, source: null, sourceType: "none", reviewedAt: null, ruleVersion: null, operatorApprovedVersion: null, notes: "ePrivacy/GDPR — an EU member state with its OWN rule; must not inherit any other country's." },
};

function normalizeCountry(input: string | null | undefined): string {
  const v = (input ?? "").trim().toUpperCase();
  if (!v) return "UNKNOWN";
  const map: Record<string, string> = { USA: "US", "UNITED STATES": "US", UK: "GB", "GREAT BRITAIN": "GB", "UNITED KINGDOM": "GB", CANADA: "CA", AUSTRALIA: "AU", "NEW ZEALAND": "NZ", IRELAND: "IE" };
  return map[v] ?? v;
}

/**
 * Resolve cold-send eligibility for a country + (optional) entity type. Fails closed:
 * an unknown country is UNKNOWN and never sendable; a rule that needs an entity type
 * but has none resolves to REQUIRES_ENTITY_CLASSIFICATION (not sendable).
 */
export function sendEligibility(country: string | null | undefined, entityType: EntityType = "unknown"): JurisdictionVerdict {
  const key = normalizeCountry(country);
  const rule = REGISTRY[key] ?? null;
  const reasons: string[] = [];

  if (!rule) {
    reasons.push(`jurisdiction "${key}" is unknown — failing closed (no cold send)`);
    return { country: key, state: "UNKNOWN", coldSendAllowed: false, requiredMessageElements: [], reasons, rule: null };
  }

  // A sourced, operator-approved, affirmatively-allowed rule is the ONLY path to a send.
  const affirmative = rule.state === "SEND_ALLOWED_WITH_RULES" && !!rule.source && rule.sourceType === "primary-regulator" && !!rule.operatorApprovedVersion;

  if (!affirmative) {
    reasons.push(`${rule.label}: ${rule.state} — not enabled for cold email${rule.source ? "" : " (no sourced rule)"}`);
    return { country: key, state: rule.state, coldSendAllowed: false, requiredMessageElements: rule.requiredMessageElements, reasons, rule };
  }

  if (rule.requiresEntityType && (entityType === "unknown" || !rule.allowedEntityTypes.includes(entityType))) {
    reasons.push(`${rule.label} requires a known, allowed entity type before sending (got "${entityType}")`);
    return { country: key, state: "REQUIRES_ENTITY_CLASSIFICATION", coldSendAllowed: false, requiredMessageElements: rule.requiredMessageElements, reasons, rule };
  }

  reasons.push(`${rule.label}: cold B2B email permitted with required elements`);
  return { country: key, state: "SEND_ALLOWED_WITH_RULES", coldSendAllowed: true, requiredMessageElements: rule.requiredMessageElements, reasons, rule };
}

const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

/** Infer a lead's country from its state code. US when a US state; otherwise unknown (fail closed). */
export function inferCountry(loc: { state?: string | null; country?: string | null }): string {
  if (loc.country) return normalizeCountry(loc.country);
  const st = (loc.state ?? "").trim().toUpperCase();
  if (US_STATES.has(st)) return "US";
  return "UNKNOWN";
}

/** Snapshot of the registry for operator display (which jurisdictions are enabled vs review/blocked). */
export function jurisdictionRegistrySnapshot(): { enabled: string[]; review: string[]; blocked: string[]; rules: JurisdictionRule[] } {
  const rules = Object.values(REGISTRY);
  return {
    enabled: rules.filter((r) => sendEligibility(r.country).coldSendAllowed).map((r) => r.label),
    review: rules.filter((r) => r.state === "REQUIRES_COMPLIANCE_REVIEW" || r.state === "REQUIRES_ENTITY_CLASSIFICATION").map((r) => r.label),
    blocked: rules.filter((r) => r.state === "BLOCKED_FOR_COLD_EMAIL").map((r) => r.label),
    rules,
  };
}
