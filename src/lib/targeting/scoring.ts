// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TARGETING SCORE (mandate 27). ONE versioned 100-point model that decides whether a business is
// the persona we want — REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR: an owner-led, established local
// company with genuine customer trust whose website underrepresents the reputation it has already earned.
//
// The engine is PURE and DETERMINISTIC. It scores ONLY observable business conditions and publicly expressed
// operating behavior — never race, religion, health, disability, politics, orientation, or any sensitive
// personal trait, and never a claim about an individual's mental state. The "operator psychology" in the
// persona informs MESSAGE construction elsewhere; it is never stored as a fact about a person here.
//
// It consumes a normalized TargetingInput (an adapter maps canonical Lead + BusinessProfile + evidence +
// recipient into this shape) so the model is testable in isolation and can't drift with storage changes.
// ─────────────────────────────────────────────────────────────────────────────

export const TARGETING_MODEL_VERSION = "v1-2026-09";
export const TARGET_PERSONA = "REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR";

/** A single verified signal backing a score component. Every material claim must carry one. */
export interface TargetingSignal {
  id: string;              // stable finding id
  kind: "reputation" | "digital-underrepresentation" | "owner-accessibility" | "growth-timing" | "commercial-value";
  observation: string;     // what was directly observed (verified)
  sourceUrl?: string | null;
  confidence: number;      // 0..1
}

export type RecipientRole = "owner" | "founder" | "managing-partner" | "general-manager" | "marketing-leader" | "general-inbox" | "none";
export interface RecipientResolution {
  role: RecipientRole;
  verified: boolean;       // a real verification result, NOT an inferred pattern
  confidence: number;      // 0..1
  locallyControlled: boolean; // the recipient controls/influences the decision at this location
}

export interface TargetingInput {
  leadId: string;
  businessName: string;
  city: string;
  state: string;
  // ── terminal-exclusion signals (any true → INELIGIBLE) ──
  isEnterpriseOrPublic: boolean;
  isFranchiseCorporateControlled: boolean; // a corporate-controlled franchise LOCATION (not an independent franchisee)
  isRejected: boolean;
  isSuppressed: boolean;
  isDuplicate: boolean;
  isSynthetic: boolean;
  policyExhausted: boolean;
  hasFunctioningWebsite: boolean;         // false → INELIGIBLE (no site to review)
  // ── market ──
  marketTier: "secondary" | "tertiary" | "primary" | "micro" | "unknown"; // from market-policy
  recentlyOversaturated: boolean;          // recently-searched oversaturated market/category
  // ── reputation ──
  reviewCount: number;
  rating: number;                          // 0..5
  ownerRepliesToReviews: boolean;
  hasAwardsOrLongHistory: boolean;
  // ── digital underrepresentation (verified website findings) ──
  websiteFindings: TargetingSignal[];      // specific, evidence-backed website opportunities
  hasSupportedConsequence: boolean;        // a finding maps to a plausible business consequence
  strongModernConversionSite: boolean;     // a sophisticated modern site with no material opportunity
  genericFindingOnly: boolean;             // the only finding is generic (shared by many businesses)
  // ── evidence quality ──
  reputationSignals: TargetingSignal[];
  growthSignals: TargetingSignal[];
  // ── decision-maker access ──
  recipient: RecipientResolution;
  ownerNamedOnSite: boolean;
  // ── commercial value ──
  highConsiderationService: boolean;       // one extra customer is meaningfully valuable
  locationsCount: number;                  // 1..5 preferred; >10 (uncontrolled) is a disqualifier upstream
  weakCommercialViability: boolean;        // too small/unstable to justify professional improvement
  lowConfidenceOwnership: boolean;         // ownership/decision-maker is an unverified inference
}

export type PriorityBand = "PRIORITY_A" | "PRIORITY_B" | "REVIEW" | "DO_NOT_PREPARE" | "INELIGIBLE";

export interface ComponentScores {
  reputationStrength: number;      // 0..15
  digitalReputationGap: number;    // 0..25
  evidenceSpecificity: number;     // 0..15
  decisionMakerAccess: number;     // 0..10
  customerValue: number;           // 0..10
  marketFit: number;               // 0..10
  growthTiming: number;            // 0..10
  recipientConfidence: number;     // 0..5
}

export interface TargetingScore {
  version: string;
  leadId: string;
  band: PriorityBand;
  total: number;                   // 0..100 (after penalties, clamped)
  components: ComponentScores;
  penalties: Array<{ code: string; points: number; reason: string }>;
  terminalExclusions: string[];    // reasons the lead is INELIGIBLE (empty → eligible)
  priorityAReady: boolean;         // meets all PRIORITY_A prerequisites
  reasons: string[];               // human-readable component rationale
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const strongestReputation = (i: TargetingInput): boolean =>
  i.reviewCount >= 50 || i.rating >= 4.5 || i.ownerRepliesToReviews || i.hasAwardsOrLongHistory;

// ── COMPONENT SCORERS (observable business conditions only) ─────────────────────
function reputationStrength(i: TargetingInput): number {
  let s = 0;
  if (i.reviewCount >= 200) s += 6; else if (i.reviewCount >= 80) s += 5; else if (i.reviewCount >= 40) s += 3; else if (i.reviewCount >= 15) s += 1;
  if (i.rating >= 4.7) s += 4; else if (i.rating >= 4.3) s += 3; else if (i.rating >= 4.0) s += 2;
  if (i.ownerRepliesToReviews) s += 3;
  if (i.hasAwardsOrLongHistory) s += 2;
  return clamp(s, 0, 15); // high review count ALONE cannot reach the top — needs rating + engagement + history
}
function digitalReputationGap(i: TargetingInput): number {
  // The core thesis: strong reputation NOT carried into the website. Weighted heaviest (0..25).
  if (i.strongModernConversionSite) return 0; // a sophisticated site → no gap → not our persona
  const specific = i.websiteFindings.filter((f) => (f.confidence ?? 0) >= 0.5).length;
  let s = 0;
  s += Math.min(specific, 4) * 4;                 // up to 16 for specific, verified website findings
  if (i.hasSupportedConsequence) s += 6;          // the gap plausibly costs the business customers
  if (strongestReputation(i) && specific > 0) s += 3; // reputation exists AND the site underrepresents it
  return clamp(s, 0, 25);
}
function evidenceSpecificity(i: TargetingInput): number {
  const all = [...i.websiteFindings, ...i.reputationSignals].filter((f) => f.id && (f.observation ?? "").trim());
  const highConf = all.filter((f) => (f.confidence ?? 0) >= 0.6).length;
  let s = Math.min(highConf, 3) * 4 + Math.min(all.length, 3);
  if (i.genericFindingOnly) s = Math.min(s, 4); // generic evidence is capped low
  return clamp(s, 0, 15);
}
function decisionMakerAccess(i: TargetingInput): number {
  let s = 0;
  const r = i.recipient;
  if (r.role === "owner" || r.role === "founder") s += 6;
  else if (r.role === "managing-partner") s += 5;
  else if (r.role === "general-manager" && r.locallyControlled) s += 4;
  else if (r.role === "marketing-leader" && r.locallyControlled) s += 3;
  else if (r.role === "general-inbox") s += 1;
  if (i.ownerNamedOnSite) s += 2;
  if (r.locallyControlled) s += 2;
  return clamp(s, 0, 10);
}
function customerValue(i: TargetingInput): number {
  let s = 0;
  if (i.highConsiderationService) s += 6;
  if (i.locationsCount >= 1 && i.locationsCount <= 5) s += 3; else if (i.locationsCount <= 10) s += 1;
  if (!i.weakCommercialViability) s += 1;
  return clamp(s, 0, 10);
}
function marketFit(i: TargetingInput): number {
  if (i.marketTier === "secondary") return 10;
  if (i.marketTier === "tertiary") return 9;
  if (i.marketTier === "micro") return 4;
  if (i.marketTier === "primary") return 2; // eligible but not preferred
  return 5;
}
function growthTiming(i: TargetingInput): number {
  const g = i.growthSignals.filter((f) => (f.confidence ?? 0) >= 0.5).length;
  return clamp(g * 4, 0, 10);
}
function recipientConfidence(i: TargetingInput): number {
  const r = i.recipient;
  if (!r.verified || r.role === "none") return 0;
  return clamp(Math.round(r.confidence * 5), 0, 5);
}

/** Score a business against the canonical persona. Pure + deterministic. */
export function scoreTarget(i: TargetingInput): TargetingScore {
  // ── Terminal exclusions → INELIGIBLE regardless of component quality ──
  const terminal: string[] = [];
  if (i.isEnterpriseOrPublic) terminal.push("national enterprise or public company");
  if (i.isFranchiseCorporateControlled) terminal.push("corporate-controlled franchise location");
  if (i.isRejected) terminal.push("rejected lead");
  if (i.isSuppressed) terminal.push("suppressed recipient");
  if (i.isDuplicate) terminal.push("duplicate company/domain/recipient");
  if (i.isSynthetic) terminal.push("synthetic/internal-test provenance");
  if (i.policyExhausted) terminal.push("policy-exhausted");
  if (!i.hasFunctioningWebsite) terminal.push("no functioning website");
  if (i.recipient.role === "none" || (!i.recipient.verified && i.recipient.role !== "general-inbox")) {
    // an unverifiable/absent recipient is a terminal exclusion for AUTOMATED preparation
    if (i.recipient.role === "none") terminal.push("no resolvable recipient");
  }

  const components: ComponentScores = {
    reputationStrength: reputationStrength(i),
    digitalReputationGap: digitalReputationGap(i),
    evidenceSpecificity: evidenceSpecificity(i),
    decisionMakerAccess: decisionMakerAccess(i),
    customerValue: customerValue(i),
    marketFit: marketFit(i),
    growthTiming: growthTiming(i),
    recipientConfidence: recipientConfidence(i),
  };
  const rawTotal = Object.values(components).reduce((a, b) => a + b, 0);

  // ── Penalties (never below 0) ──
  const penalties: Array<{ code: string; points: number; reason: string }> = [];
  if (!i.hasSupportedConsequence) penalties.push({ code: "NO_SUPPORTED_CONSEQUENCE", points: -25, reason: "website issue has no supported business consequence" });
  if (i.strongModernConversionSite) penalties.push({ code: "STRONG_MODERN_SITE", points: -25, reason: "sophisticated modern conversion experience — outreach is irrelevant" });
  if (i.weakCommercialViability) penalties.push({ code: "WEAK_VIABILITY", points: -20, reason: "weak commercial viability" });
  if (i.recentlyOversaturated) penalties.push({ code: "OVERSATURATED", points: -10, reason: "recently searched oversaturated market/category" });
  if (i.genericFindingOnly) penalties.push({ code: "GENERIC_EVIDENCE", points: -15, reason: "generic evidence shared by many businesses" });
  if (i.lowConfidenceOwnership) penalties.push({ code: "LOW_CONFIDENCE_OWNERSHIP", points: -10, reason: "low-confidence ownership inference" });
  const penaltyTotal = penalties.reduce((a, p) => a + p.points, 0);

  const total = terminal.length ? 0 : clamp(rawTotal + penaltyTotal, 0, 100);

  // ── PRIORITY_A prerequisites ──
  const priorityAReady =
    terminal.length === 0 &&
    strongestReputation(i) &&
    i.websiteFindings.some((f) => (f.confidence ?? 0) >= 0.5) &&
    i.hasSupportedConsequence &&
    i.recipient.verified &&
    i.recipient.role !== "none";

  let band: PriorityBand;
  if (terminal.length) band = "INELIGIBLE";
  else if (total >= 80 && priorityAReady) band = "PRIORITY_A";
  else if (total >= 70) band = "PRIORITY_B";
  else if (total >= 60) band = "REVIEW";
  else band = "DO_NOT_PREPARE";
  // A score in the A range that misses a PRIORITY_A prerequisite lands in B (never auto-promoted to A).

  const reasons: string[] = terminal.length
    ? terminal.map((t) => `INELIGIBLE: ${t}`)
    : [
        `Reputation ${components.reputationStrength}/15 (${i.reviewCount} reviews, ${i.rating}★${i.ownerRepliesToReviews ? ", owner replies" : ""}).`,
        `Digital reputation gap ${components.digitalReputationGap}/25 (${i.websiteFindings.length} website finding(s)${i.hasSupportedConsequence ? ", supported consequence" : ""}).`,
        `Evidence specificity ${components.evidenceSpecificity}/15; decision-maker access ${components.decisionMakerAccess}/10 (${i.recipient.role}).`,
        `Market fit ${components.marketFit}/10 (${i.marketTier}); growth timing ${components.growthTiming}/10; recipient confidence ${components.recipientConfidence}/5.`,
        penalties.length ? `Penalties: ${penalties.map((p) => `${p.code}(${p.points})`).join(", ")}.` : "No penalties.",
      ];

  return { version: TARGETING_MODEL_VERSION, leadId: i.leadId, band, total, components, penalties, terminalExclusions: terminal, priorityAReady, reasons };
}

/** Only PRIORITY_A and PRIORITY_B may enter automated preparation. */
export function mayAutoPrepare(score: TargetingScore): boolean {
  return score.band === "PRIORITY_A" || score.band === "PRIORITY_B";
}
