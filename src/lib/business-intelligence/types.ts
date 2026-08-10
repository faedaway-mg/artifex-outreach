// ─────────────────────────────────────────────────────────────────────────────
// Business Intelligence Profile — type model.
//
// The Profile is the single, structured understanding of a business that every
// other system consumes: the Conversation Engine, the Business Technology Review,
// investment recommendations, the partnership roadmap, the CRM, and follow-ups.
//
// It does NOT re-analyze anything. It ORGANIZES analysis the engine already
// produced (presence, normalized Evidence, technology maturity, improvement
// potential) into four dimensions of structured, confidence-scored readings plus
// categorized modernization opportunities and an executive summary.
//
// Two invariants hold everywhere:
//   1. Determinism — pure functions, no clocks, no randomness. `generatedAt` is
//      null until a caller stamps it.
//   2. No fabrication — a reading exists only when something real supports it.
//      Every reading and opportunity carries `basis`: the provenance behind it.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { WebsiteSignals } from "../scoring";
import type { DigitalPresence } from "../presence";
import type { Evidence } from "../intelligence/evidence";
import type { MaturityAssessment } from "../intelligence/maturity";
import type { BusinessImprovementPotential } from "../improvement";
import type { ConversationInput } from "../conversation-engine";
import type { Confidence } from "./confidence";

// ── Dimensions ────────────────────────────────────────────────────────────────
export const DIMENSIONS = ["digital-presence", "discovery", "customer-experience", "operations"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  "digital-presence": "Digital Presence",
  discovery: "Discovery",
  "customer-experience": "Customer Experience",
  operations: "Operations",
};

/** A normalized rating for a single reading — comparable across signals. */
export const READING_STATUSES = ["strong", "adequate", "weak", "absent", "unknown"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

/** How healthy a status is, 0..1 — used to roll a dimension up into a score. */
export const STATUS_HEALTH: Record<ReadingStatus, number | null> = {
  strong: 1,
  adequate: 0.66,
  weak: 0.33,
  absent: 0,
  unknown: null, // unknown does not drag a score down; it simply isn't counted
};

// ── A single signal reading ─────────────────────────────────────────────────────
export interface SignalReading {
  /** Stable key, e.g. "website-quality". Unique within a dimension. */
  key: string;
  dimension: Dimension;
  /** Human label, e.g. "Website quality". */
  label: string;
  status: ReadingStatus;
  /** One honest sentence an operator can read aloud. */
  summary: string;
  confidence: Confidence;
  /** Provenance — what this reading is built from. NEVER empty for a real reading. */
  basis: string[];
}

export interface DimensionReport {
  dimension: Dimension;
  label: string;
  readings: SignalReading[];
  /** 0..100 health of measured readings (unknowns excluded). Null if nothing measured. */
  score: number | null;
  confidence: Confidence;
  /** A short, deterministic roll-up of the dimension. */
  summary: string;
  /** How many of the dimension's signals produced a measurable (non-unknown) reading. */
  measured: number;
  total: number;
}

// ── Modernization opportunities ─────────────────────────────────────────────────
export const OPPORTUNITY_CATEGORIES = [
  "Customer Acquisition",
  "Customer Retention",
  "Scheduling",
  "Communication",
  "Automation",
  "Reporting",
  "Operations",
  "Brand Experience",
  "Analytics",
  "Internal Workflow",
] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

/** Coarse business impact for an opportunity — deterministic, never a dollar promise. */
export const IMPACT_LEVELS = ["Foundational", "High", "Moderate", "Incremental"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export interface ModernizationOpportunity {
  id: string;
  category: OpportunityCategory;
  /** What we saw (the observation). */
  observation: string;
  /** Why it matters to the business. */
  whyItMatters: string;
  /** Estimated impact — a level plus a plain-language rationale. */
  estimatedImpact: { level: ImpactLevel; rationale: string };
  confidence: Confidence;
  basis: string[];
}

// ── The executive profile ───────────────────────────────────────────────────────
export interface BusinessProfile {
  leadId: string;
  businessName: string;
  industry: string;
  /** Null for determinism; a caller stamps it when persisting. */
  generatedAt: string | null;

  /** What the business actually has online (reused from the Presence system). */
  presence: DigitalPresence;

  /** The four structured dimensions, always present in a fixed order. */
  dimensions: Record<Dimension, DimensionReport>;

  /** Directly-observed things worth acknowledging first. */
  strengths: string[];

  /** Categorized, confidence-scored opportunities, strongest first. */
  opportunities: ModernizationOpportunity[];

  /** One-line executive headline. */
  headline: string;
  /** A short, deterministic executive summary drawn only from the readings. */
  executiveSummary: string;

  /** 0..100 — overall confidence in the picture (breadth + strength of evidence). */
  evidenceConfidence: number;

  /** The canonical input for the Conversation Engine — one analytical source. */
  conversationInput: ConversationInput;

  /** Which sources contributed to this profile (audit + "how sure are we"). */
  provenance: string[];

  /** Per-dimension measured/total coverage — surfaces what we could and couldn't see. */
  coverage: Array<{ dimension: Dimension; measured: number; total: number }>;

  /** Cached business logo for the Quick Review (resolved once via the logo extractor).
   *  `undefined` = not yet resolved; `null` = resolved, none trustworthy. jsonb — no migration. */
  resolvedBrand?: { logoUrl: string; sourceType: string; confidence: number } | null;
}

// ── Inputs the profile is built from ────────────────────────────────────────────
/**
 * Everything a profile can draw on. Only `lead` is required; the profile degrades
 * gracefully (and honestly) as inputs are absent — thin input yields Unknown
 * readings, never invented facts.
 */
export interface ProfileInput {
  lead: Lead;
  presence?: DigitalPresence;
  evidence?: Evidence[];
  websiteSignals?: WebsiteSignals | null;
  maturity?: MaturityAssessment | null;
  improvement?: BusinessImprovementPotential | null;
}

/** A fast, read-only index over evidence, handed to every signal. */
export interface EvidenceIndex {
  get(field: string): Evidence | undefined;
  has(field: string): boolean;
  /** Value for a field, or null. */
  value<T extends string | number | boolean>(field: string): T | null;
  /** All friction-kind evidence (fields prefixed "friction:"). */
  friction(): Evidence[];
  /** Fields present that start with a prefix, e.g. "strength:review:". */
  withPrefix(prefix: string): Evidence[];
  all(): Evidence[];
}

/** The read-only context every signal and opportunity rule evaluates against. */
export interface ProfileContext {
  lead: Lead;
  presence: DigitalPresence;
  evidence: EvidenceIndex;
  websiteSignals: WebsiteSignals | null;
  maturity: MaturityAssessment | null;
  improvement: BusinessImprovementPotential | null;
}

/** A modular signal — the unit of extensibility. Add one, register it, done. */
export interface ProfileSignal {
  key: string;
  dimension: Dimension;
  label: string;
  /** Return a reading, or null when there is NO basis to say anything. */
  evaluate(ctx: ProfileContext): SignalReading | null;
}

/** A modular opportunity rule. Reads context + readings, emits a categorized opp or null. */
export interface OpportunityRule {
  id: string;
  category: OpportunityCategory;
  evaluate(ctx: ProfileContext, readings: SignalReading[]): ModernizationOpportunity | null;
}
