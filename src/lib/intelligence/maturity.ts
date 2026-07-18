// ─────────────────────────────────────────────────────────────────────────────
// Technology Maturity Model.
//
// A repeatable benchmark — NOT a grade. It describes where a business sits today
// across technology dimensions, in human language, with the evidence behind it and
// the single next step that would move it forward. Designed so the same business
// can be re-assessed quarterly as a long-term client and see real movement.
// ─────────────────────────────────────────────────────────────────────────────

export const MATURITY_DIMENSIONS = [
  "Customer Experience",
  "Customer Communication",
  "Operational Systems",
  "Automation",
  "Reporting",
  "Decision Support",
  "Integration",
  "Growth Readiness",
  "Digital Presence",
  "Innovation Readiness",
] as const;
export type MaturityDimension = (typeof MATURITY_DIMENSIONS)[number];

// Ordered levels. Human language first; the ordinal is internal only.
export const MATURITY_LEVELS = ["Emerging", "Developing", "Established", "Advanced", "Strategic"] as const;
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];
export function levelOrdinal(l: MaturityLevel): number {
  return MATURITY_LEVELS.indexOf(l) + 1; // 1..5
}

export interface DimensionAssessment {
  dimension: MaturityDimension;
  current: MaturityLevel;
  confidence: "Verified" | "Likely" | "Unknown";
  evidence: string[];
  /** 0..100 — how much headroom there is, weighted by relevance to this business. */
  improvementPotential: number;
  nextStep: string;
}

export interface MaturityAssessment {
  dimensions: DimensionAssessment[];
  overall: MaturityLevel;
  /** Dimensions with the most improvement potential, highest first. */
  priorityDimensions: MaturityDimension[];
  summary: string;
}

/** Normalized signals the assessment consumes — provider-agnostic. */
export interface MaturitySignals {
  hasWebsite: boolean;
  mobileFriendly: boolean | null;
  hasBooking: boolean | null;
  hasLeadForm: boolean | null;
  hasPublicContact: boolean;
  rating: number | null;
  reviewCount: number | null;
  locationsCount: number;
  /** Friction domains observed (drives which dimensions look weak). */
  frictionDomains: string[];
  /** Whether the business has been analyzed at all (affects confidence). */
  analyzed: boolean;
}

function lvl(ordinal: number): MaturityLevel {
  return MATURITY_LEVELS[Math.max(0, Math.min(4, ordinal - 1))];
}

export function assessMaturity(s: MaturitySignals): MaturityAssessment {
  const fr = new Set(s.frictionDomains);
  const conf = (): DimensionAssessment["confidence"] => (s.analyzed ? "Likely" : "Unknown");

  const dims: DimensionAssessment[] = [];
  const add = (dimension: MaturityDimension, ordinal: number, evidence: string[], nextStep: string, confidence: DimensionAssessment["confidence"] = conf()) => {
    const improvementPotential = Math.round(((5 - ordinal) / 4) * 100);
    dims.push({ dimension, current: lvl(ordinal), confidence, evidence, improvementPotential, nextStep });
  };

  // Digital Presence — most directly observable.
  add(
    "Digital Presence",
    !s.hasWebsite ? 1 : s.mobileFriendly === false ? 2 : s.mobileFriendly ? 3 : 2,
    [s.hasWebsite ? "Has a website" : "No website found", s.mobileFriendly == null ? "Mobile-friendliness not yet analyzed" : s.mobileFriendly ? "Mobile-friendly" : "Not mobile-friendly"],
    s.hasWebsite ? "Tighten the primary customer journey on mobile." : "Establish a fast, mobile-first presence.",
    s.hasWebsite ? "Verified" : "Verified",
  );

  // Customer Experience
  add(
    "Customer Experience",
    fr.has("Customer Journey") || fr.has("Customer Experience") ? 2 : s.hasBooking ? 3 : 2,
    [fr.has("Customer Journey") ? "Journey friction observed" : "No blocking journey friction observed", s.hasBooking ? "Online booking present" : "No online booking"],
    "Give customers one clear, fast primary action.",
  );

  // Customer Communication
  add(
    "Customer Communication",
    fr.has("Customer Communication") ? 2 : s.hasLeadForm ? 3 : 2,
    [fr.has("Customer Communication") ? "Manual follow-up likely" : "No obvious communication gap", s.hasLeadForm ? "Lead form present" : "No lead form"],
    "Automate confirmations and follow-up so nothing is chased by hand.",
  );

  // Operational Systems
  add(
    "Operational Systems",
    fr.has("Operations") || fr.has("Internal Workflow") ? 2 : 3,
    [fr.has("Operations") ? "Manual/operational friction observed" : "No operational friction visible from outside"],
    "Introduce a system of record for the most repetitive process.",
    "Unknown",
  );

  // Automation
  add("Automation", fr.has("Automation") || fr.has("Customer Communication") ? 1 : 2, ["Automation cannot be fully seen externally"], "Automate the single most repetitive weekly task.", "Unknown");

  // Reporting
  add("Reporting", fr.has("Reporting") ? 1 : 2, ["Reporting maturity is rarely visible externally"], "Stand up a simple operational dashboard.", "Unknown");

  // Decision Support
  add("Decision Support", fr.has("Decision Making") ? 1 : 2, ["Decision support inferred, not observed"], "Surface the few metrics leadership decides on weekly.", "Unknown");

  // Integration
  add("Integration", fr.has("Data Flow") || fr.has("Technology Integration") ? 1 : 2, [fr.has("Data Flow") ? "Signs of double data entry / disconnected tools" : "Integration state unknown"], "Connect the two tools that currently require manual bridging.", "Unknown");

  // Growth Readiness
  add(
    "Growth Readiness",
    fr.has("Growth Readiness") || fr.has("Scalability") ? 2 : s.locationsCount > 1 ? 2 : 3,
    [s.locationsCount > 1 ? `${s.locationsCount} locations to coordinate` : "Single location", (s.reviewCount ?? 0) >= 150 ? "High volume of public activity" : "Moderate public activity"],
    "Sequence a modernization roadmap before volume forces it.",
  );

  // Innovation Readiness
  add("Innovation Readiness", fr.has("Innovation Opportunity") ? 2 : 2, ["Innovation appetite is discovered in conversation, not observed"], "Ask whether there's a product idea never had time to build.", "Unknown");

  const overallOrdinal = Math.round(dims.reduce((sum, d) => sum + levelOrdinal(d.current), 0) / dims.length);
  const priorityDimensions = [...dims].sort((a, b) => b.improvementPotential - a.improvementPotential).slice(0, 3).map((d) => d.dimension);

  return {
    dimensions: dims,
    overall: lvl(overallOrdinal),
    priorityDimensions,
    summary: `Overall technology maturity looks ${lvl(overallOrdinal)}. The clearest room to improve is in ${priorityDimensions.join(", ")}. Most operational dimensions can only be confirmed in conversation.`,
  };
}
