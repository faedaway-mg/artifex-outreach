// ─────────────────────────────────────────────────────────────────────────────
// Artifex Labs positioning — the single source of truth for WHO we are, WHAT we
// sell, what we DON'T sell, and the shared vocabulary the acquisition engine uses
// (method, friction categories, opportunity areas, engagement models, treatment
// categories, outreach angles).
//
// This exists so the outreach engine, deliverables, scoring rationale, and the
// operator UI all tell the same story: Artifex is a Business Technology Partner
// that finds friction and implements the right improvement over time — not a
// website/app/automation vendor selling a predetermined build.
// ─────────────────────────────────────────────────────────────────────────────

/** Primary descriptor. Clear enough for a busy SMB owner to understand instantly. */
export const PRIMARY_DESCRIPTOR = "Business Technology Partner";

/** Supporting tagline. Canonical — see artifex-labs/docs/ARTIFEX_BRAND_ARCHITECTURE.md §3. */
export const TAGLINE = "Find the friction. Build what compounds.";

/** The core promise, in plain business language. */
export const CORE_PROMISE =
  "Artifex Labs helps businesses identify where technology can create the most value, then designs and implements those improvements over time.";

/** How positioning should read internally (the human interpretation). */
export const INTERNAL_PROMISE =
  "We become the trusted technology partner a business can call when something is inefficient, outdated, disconnected, difficult to manage, or ready to evolve.";

/** The Artifex Method — the five steps, in customer language. */
export const METHOD = [
  { step: "Understand", blurb: "Learn how the business attracts customers, serves them, and operates day to day." },
  { step: "Diagnose", blurb: "Find the friction — the lost time, repeated work, and weak paths that hold the business back." },
  { step: "Prioritize", blurb: "Focus on the smallest, highest-impact improvements first, sequenced around budget and capacity." },
  { step: "Implement", blurb: "Build the right improvement well — or recommend a simpler existing solution when that is better." },
  { step: "Improve", blurb: "Keep measuring and evolving the systems as the business grows." },
] as const;

/**
 * What Artifex sells framed as OUTCOMES, not a service menu. Each outcome lists
 * example implementations — but these are methods, not the identity.
 */
export const OUTCOME_AREAS = [
  {
    key: "customer-growth",
    outcome: "Customer Growth & Experience",
    blurb: "Make it easier for customers to find, choose, and buy.",
    examples: ["A clearer customer journey", "A focused landing experience", "Better intake, scheduling, and follow-up"],
  },
  {
    key: "operational-efficiency",
    outcome: "Operational Efficiency",
    blurb: "Remove repetitive, manual work the team should not be doing.",
    examples: ["Automating repetitive processes", "Connecting disconnected tools", "Streamlining intake and communication"],
  },
  {
    key: "visibility",
    outcome: "Business Visibility & Decision-Making",
    blurb: "Give the owner the numbers to make faster, better decisions.",
    examples: ["Internal dashboards", "Better reporting and operational visibility", "Customer or activity tracking"],
  },
  {
    key: "connected-systems",
    outcome: "Connected Systems",
    blurb: "Make the tools the business already owns work together.",
    examples: ["Integrations between existing tools", "Better use of a platform already in place", "Centralized information flow"],
  },
  {
    key: "digital-products",
    outcome: "Digital Products & New Ideas",
    blurb: "Turn a founder's idea into something real and validated.",
    examples: ["Prototyping a software idea", "A phased product build", "Customer or employee portals"],
  },
  {
    key: "continuous-modernization",
    outcome: "Continuous Modernization",
    blurb: "Modernize what holds the business back without rebuilding what already works.",
    examples: ["Improving an existing website", "A sequenced modernization roadmap", "Refreshing outdated experiences"],
  },
] as const;
export type OutcomeAreaKey = (typeof OUTCOME_AREAS)[number]["key"];

/** What Artifex explicitly is NOT — guards against sliding back into vendor framing. */
export const NOT_POSITIONING = [
  "an AI agency",
  "a website agency",
  "an app development shop",
  "an automation agency",
  "an outsourced IT help desk",
  "a generic digital transformation consultancy",
  "a company that sells a menu of disconnected services",
] as const;

// ── Friction categories ──────────────────────────────────────────────────────
// The kinds of friction Artifex looks for. Used to classify observations and to
// choose the strongest outreach angle for a specific business.
export const FRICTION_CATEGORIES = [
  "Customer journey friction",
  "Scheduling or intake friction",
  "Operational complexity",
  "Disconnected systems",
  "Weak visibility or reporting",
  "Growth readiness",
  "Reputation-to-conversion gap",
  "Multi-location complexity",
  "Founder or digital-product opportunity",
  "Website as a doorway to broader improvement",
] as const;
export type FrictionCategory = (typeof FRICTION_CATEGORIES)[number];

// ── Opportunity areas ────────────────────────────────────────────────────────
// NOT prescriptions — possibilities to explore in discovery.
export const OPPORTUNITY_AREAS = [
  "Customer journey improvement",
  "Intake simplification",
  "Scheduling integration",
  "Follow-up automation",
  "Internal dashboard",
  "Centralized information flow",
  "Self-service customer tools",
  "Better use of an existing platform",
  "Custom internal software",
  "Digital product exploration",
] as const;
export type OpportunityArea = (typeof OPPORTUNITY_AREAS)[number];

// ── Lead treatment categories ────────────────────────────────────────────────
// The new business-model framing over the acquisition strategies. These describe
// the RELATIONSHIP we're pursuing, not just how much automation to spend.
export const TREATMENT_CATEGORIES = [
  "Strategic Partnership Prospect",
  "Focused Improvement Prospect",
  "Discovery-First Prospect",
  "Nurture",
  "Low-Confidence Research",
  "Do Not Contact",
] as const;
export type TreatmentCategory = (typeof TREATMENT_CATEGORIES)[number];

/** Map the underlying acquisition strategy to a business-facing treatment category. */
export function treatmentForStrategy(
  strategy: string,
  opts: { relationshipLean?: boolean; lowConfidence?: boolean } = {},
): TreatmentCategory {
  switch (strategy) {
    case "Do Not Contact":
      return "Do Not Contact";
    case "Manual Review":
      return opts.lowConfidence ? "Low-Confidence Research" : "Discovery-First Prospect";
    case "Nurture":
      return "Nurture";
    case "Personal":
      return opts.relationshipLean ? "Strategic Partnership Prospect" : "Focused Improvement Prospect";
    case "Assisted":
      return opts.relationshipLean ? "Strategic Partnership Prospect" : "Focused Improvement Prospect";
    case "Light":
      return "Discovery-First Prospect";
    default:
      return "Discovery-First Prospect";
  }
}

// ── Evidence discipline ──────────────────────────────────────────────────────
// External analysis produces hypotheses and questions, not unsupported claims.
// Every observation is one of these types (mirrors the findings table).
export const OBSERVATION_TYPES = [
  "Directly observed fact",
  "Strong inference",
  "Possible opportunity",
  "Open discovery question",
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

/** Map a finding's confidence/type to an observation discipline label. */
export function observationTypeFor(findingType: string, confidence: string): ObservationType {
  if (findingType === "Verified fact" || confidence === "Verified") return "Directly observed fact";
  if (findingType === "Automated technical finding") return "Directly observed fact";
  if (confidence === "Likely") return "Strong inference";
  return "Possible opportunity";
}
