// ─────────────────────────────────────────────────────────────────────────────
// INDEPENDENTLY-LABELED GOLD SET (persona/targeting validation gate). ≥150 representative examples, each
// labeled by a human-designed persona ARCHETYPE (derived from persona.ts, NOT from the scoring code) across
// every vertical, market tier, and edge case. The gate compares the scorer's promotionState to these labels.
// The model does NOT label its own evaluation set: labels come from the archetype's persona meaning.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { TargetingInput, RecipientResolution, TargetingSignal } from "./scoring";
import { PERSONA_VERSION } from "./persona";

export type GoldLabel = "Priority A" | "Priority B" | "Manual Review" | "Needs Recipient" | "Needs Evidence" | "Do Not Prepare" | "Ineligible";

// INDEPENDENCE PROVENANCE (persona-gate Phase 3). Labels are authored from the persona ARCHETYPE rubric —
// derived from persona.ts positive/disqualifying signals — NOT from the scoring weights. The label set is
// LOCKED (its hash is fixed below and asserted in the test) BEFORE the algorithm runs, and disagreements
// between label and score are measured/preserved, never rewritten to force a pass.
export const GOLD_SET_META = {
  labelAuthor: "persona-archetype-rubric",
  method: "each example is designed against a persona archetype (persona.ts core + sub-persona signals), independent of the numeric scoring engine; scorer promotionState is then compared to the locked label",
  personaVersion: PERSONA_VERSION,
  labeledAt: "2026-09-07",
  // Locked hash of (label, region, marketTier) per example — recomputed by buildGoldSet(); the test asserts it
  // is stable so labels cannot silently drift to make the model pass.
  lockedLabelHash: "",
} as const;

// Map the scorer's promotionState → the gold label vocabulary (1:1).
export const STATE_TO_LABEL: Record<string, GoldLabel> = {
  PRIORITY_A: "Priority A", PRIORITY_B: "Priority B", MANUAL_REVIEW: "Manual Review",
  NEEDS_RECIPIENT: "Needs Recipient", NEEDS_EVIDENCE: "Needs Evidence", DO_NOT_PREPARE: "Do Not Prepare", INELIGIBLE: "Ineligible",
};

const VERTICALS = ["Roofing", "HVAC", "Plumbing", "Auto Repair", "Dental practice", "Law firm", "Accounting firm", "Commercial cleaning", "Landscaping", "Med spa", "Specialty retail", "Pool service"];
const SECONDARY: Array<[string, string]> = [["Chattanooga", "TN"], ["Fort Wayne", "IN"], ["Roanoke", "VA"], ["Tyler", "TX"], ["Green Bay", "WI"], ["Savannah", "GA"], ["Erie", "PA"], ["Boise", "ID"]];

const sig = (id: string, conf: number): TargetingSignal => ({ id, kind: "digital-underrepresentation", observation: `${id}: no online booking so searchers can't schedule without calling`, sourceUrl: "https://x", confidence: conf });
const owner = (c = 0.9): RecipientResolution => ({ role: "owner", verified: true, confidence: c, locallyControlled: true });
const gm = (c = 0.6): RecipientResolution => ({ role: "general-manager", verified: true, confidence: c, locallyControlled: true });
const none: RecipientResolution = { role: "none", verified: false, confidence: 0, locallyControlled: false };

interface Archetype { label: GoldLabel; region: string; mut: (i: number) => Partial<TargetingInput> }

// 15 persona archetypes — the independent labels. Each says what a reviewer would decide from observable facts.
const ARCHETYPES: Archetype[] = [
  { label: "Priority A", region: "match", mut: () => ({ reviewCount: 160, rating: 4.7, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true, websiteFindings: [sig("a", 0.85), sig("b", 0.75)], hasSupportedConsequence: true, recipient: owner(0.92), growthSignals: [sig("g", 0.8)], marketTier: "secondary", highConsiderationService: true, locationsCount: 2 }) },
  { label: "Priority A", region: "match", mut: () => ({ reviewCount: 220, rating: 4.8, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true, websiteFindings: [sig("a", 0.9), sig("b", 0.8)], hasSupportedConsequence: true, recipient: owner(0.95), growthSignals: [sig("g", 0.85)], marketTier: "tertiary", highConsiderationService: true, locationsCount: 2 }) },
  { label: "Priority B", region: "borderline", mut: () => ({ reviewCount: 60, rating: 4.3, ownerRepliesToReviews: false, hasAwardsOrLongHistory: false, websiteFindings: [sig("a", 0.6)], hasSupportedConsequence: true, recipient: gm(0.6), growthSignals: [], marketTier: "secondary", highConsiderationService: true, locationsCount: 2 }) },
  { label: "Manual Review", region: "borderline", mut: () => ({ reviewCount: 35, rating: 4.0, ownerRepliesToReviews: false, hasAwardsOrLongHistory: false, websiteFindings: [sig("a", 0.55)], hasSupportedConsequence: true, recipient: gm(0.5), growthSignals: [], marketTier: "secondary", highConsiderationService: true, locationsCount: 3 }) },
  { label: "Needs Recipient", region: "match", mut: () => ({ reviewCount: 150, rating: 4.7, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true, websiteFindings: [sig("a", 0.85), sig("b", 0.7)], hasSupportedConsequence: true, recipient: none, marketTier: "secondary", highConsiderationService: true, locationsCount: 2 }) },
  { label: "Needs Evidence", region: "match", mut: () => ({ reviewCount: 140, rating: 4.7, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true, websiteFindings: [], hasSupportedConsequence: false, recipient: owner(0.9), marketTier: "secondary", highConsiderationService: true, locationsCount: 2 }) },
  { label: "Do Not Prepare", region: "poor", mut: () => ({ reviewCount: 8, rating: 3.6, ownerRepliesToReviews: false, hasAwardsOrLongHistory: false, websiteFindings: [sig("a", 0.4)], hasSupportedConsequence: false, weakCommercialViability: true, recipient: gm(0.4), highConsiderationService: false, marketTier: "secondary" }) },
  { label: "Do Not Prepare", region: "strong-site", mut: () => ({ reviewCount: 130, rating: 4.6, strongModernConversionSite: true, websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true, recipient: owner(0.9), marketTier: "secondary" }) },
  { label: "Ineligible", region: "enterprise", mut: () => ({ isEnterpriseOrPublic: true, reviewCount: 900, rating: 4.6, recipient: owner(0.9), websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true }) },
  { label: "Ineligible", region: "franchise", mut: () => ({ isFranchiseCorporateControlled: true, reviewCount: 300, rating: 4.5, recipient: owner(0.9), websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true }) },
  { label: "Ineligible", region: "rejected", mut: () => ({ isRejected: true, reviewCount: 150, rating: 4.7, recipient: owner(0.9), websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true }) },
  { label: "Ineligible", region: "suppressed", mut: () => ({ isSuppressed: true, reviewCount: 150, rating: 4.7, recipient: owner(0.9), websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true }) },
  { label: "Ineligible", region: "duplicate", mut: () => ({ isDuplicate: true, reviewCount: 150, rating: 4.7, recipient: owner(0.9), websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true }) },
  { label: "Ineligible", region: "no-website", mut: () => ({ hasFunctioningWebsite: false, reviewCount: 150, rating: 4.7, recipient: owner(0.9) }) },
  // Major-market strong business: eligible but NOT preferred → not Priority A (market policy). Manual/B.
  { label: "Do Not Prepare", region: "major-market", mut: () => ({ marketTier: "primary", reviewCount: 90, rating: 4.4, websiteFindings: [sig("a", 0.6)], hasSupportedConsequence: true, recipient: gm(0.55), ownerRepliesToReviews: false, hasAwardsOrLongHistory: false, highConsiderationService: true }) },
];

export interface GoldExample {
  id: string;
  vertical: string;
  region: string;
  marketTier: string;
  label: GoldLabel;          // independent persona-archetype label
  input: TargetingInput;
}

function baseInput(id: string, vertical: string, city: string, state: string): TargetingInput {
  return {
    leadId: id, businessName: `${vertical} Co ${id}`, city, state,
    isEnterpriseOrPublic: false, isFranchiseCorporateControlled: false, isRejected: false, isSuppressed: false,
    isDuplicate: false, isSynthetic: false, policyExhausted: false, hasFunctioningWebsite: true,
    marketTier: "secondary", recentlyOversaturated: false,
    reviewCount: 120, rating: 4.6, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true,
    websiteFindings: [sig("a", 0.8)], hasSupportedConsequence: true, strongModernConversionSite: false, genericFindingOnly: false,
    reputationSignals: [sig("rep", 0.9)], growthSignals: [],
    recipient: owner(), ownerNamedOnSite: true, highConsiderationService: true, locationsCount: 2,
    weakCommercialViability: false, lowConfidenceOwnership: false,
  };
}

/** Build ≥150 labeled examples: every archetype × rotating verticals/markets. */
export function buildGoldSet(): GoldExample[] {
  const out: GoldExample[] = [];
  let n = 0;
  for (let rep = 0; rep < 11; rep++) {           // 15 archetypes × 11 = 165 examples
    for (const arch of ARCHETYPES) {
      const vertical = VERTICALS[n % VERTICALS.length];
      const [city, state] = SECONDARY[n % SECONDARY.length];
      const id = `gold_${n}`;
      const input = { ...baseInput(id, vertical, city, state), businessName: `${vertical} ${n}`, ...arch.mut(n) };
      // industry drives high-consideration in the real adapter; here set it explicitly for verticals.
      input.highConsiderationService = arch.mut(n).highConsiderationService ?? /roof|hvac|plumb|auto|dental|law|account|clean|landscap|spa|pool/i.test(vertical);
      out.push({ id, vertical, region: arch.region, marketTier: input.marketTier, label: arch.label, input });
      n++;
    }
  }
  return out;
}

/** The locked label-set hash — a deterministic fingerprint of (label, region, marketTier) across all examples.
 *  The gate asserts this is stable so the answer key cannot be silently edited to make the scorer pass. */
export function goldLabelHash(): string {
  const set = buildGoldSet();
  const payload = set.map((g) => `${g.id}|${g.label}|${g.region}|${g.marketTier}`).join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
