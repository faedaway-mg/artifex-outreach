// ─────────────────────────────────────────────────────────────────────────────
// Business Technology Snapshot.
//
// The outside-in intelligence artifact that replaces a website-centric "audit".
// From publicly observable information it produces structured, honest intelligence:
// business context, observed strengths, visible friction, impact hypotheses,
// discovery questions, opportunity areas, evidence/confidence, a recommended
// outreach angle, and a human conversation strategy.
//
// Discipline: external analysis produces HYPOTHESES and QUESTIONS, never
// unsupported claims about internal operations. Every observation is tagged with
// an observation type and confidence, and marked safe-for-outreach or internal-only.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Finding, Contact } from "./types";
import {
  observationTypeFor,
  type ObservationType,
  type FrictionCategory,
  type OpportunityArea,
  CORE_PROMISE,
} from "./positioning";
import { businessImprovementPotential, type BusinessImprovementPotential } from "./improvement";
import type { WebsiteSignals } from "./scoring";

export interface SnapshotObservation {
  category: FrictionCategory | string;
  observation: string;
  evidence: string;
  observationType: ObservationType;
  confidence: string; // Verified | Likely | Unknown
  /** Plausible business effect — always hedged ("may…"). */
  potentialImpact: string;
  /** Safe to reference in cold outreach, or hold until discovery. */
  safeForOutreach: boolean;
}

export interface BusinessTechnologySnapshot {
  leadId: string;
  businessName: string;
  generatedAt: string | null; // caller stamps; kept null for determinism in tests
  // A. Business context
  context: {
    industry: string;
    likelyCustomerTypes: string;
    serviceArea: string;
    apparentStage: string;
    reputationSignal: string;
    visibleChannels: string[];
  };
  // B. Observed strengths (acknowledge what's working — never predatory).
  observedStrengths: string[];
  // C/D. Visible friction with hedged impact.
  visibleFriction: SnapshotObservation[];
  // E. Hypotheses to validate (things we suspect but cannot know from outside).
  hypothesesToValidate: string[];
  // F. Discovery questions (business-specific where evidence allows).
  discoveryQuestions: string[];
  // G. Possible opportunity areas (NOT prescriptions).
  opportunityAreas: OpportunityArea[] | string[];
  // H. Confidence & evidence summary.
  evidence: {
    confidence: number; // 0..100
    note: string;
    sources: string[];
  };
  // I. Recommended outreach angle.
  outreachAngle: {
    category: FrictionCategory | string;
    opener: string;
    why: string;
  };
  // J. Human conversation strategy for the closer.
  conversationStrategy: {
    bestOpening: string;
    validateFirst: string[];
    doNotAssume: string[];
    likelyPriorities: string[];
    potentialObjections: string[];
    signsOfBroaderOpportunity: string[];
    goalOfFirstConversation: string;
  };
  improvement: BusinessImprovementPotential;
}

const FRICTION_CATEGORY_MAP: Record<string, FrictionCategory> = {
  "Mobile usability": "Customer journey friction",
  "Conversion journey": "Customer journey friction",
  "Search visibility": "Reputation-to-conversion gap",
  "Page speed": "Customer journey friction",
  Security: "Customer journey friction",
  Intake: "Scheduling or intake friction",
  Scheduling: "Scheduling or intake friction",
};

export function buildSnapshot(
  lead: Lead,
  findings: Finding[],
  contacts: Contact[] = [],
  signals?: WebsiteSignals,
): BusinessTechnologySnapshot {
  const improvement = businessImprovementPotential(lead, signals, {
    hasApprovedFindings: findings.some((f) => f.approved),
  });

  const reviews = lead.reviewCount ?? 0;
  const rating = lead.rating ?? 0;
  const multiLocation = (lead.locationsCount ?? 1) > 1;

  const context = {
    industry: lead.industry,
    likelyCustomerTypes: likelyCustomers(lead),
    serviceArea: multiLocation ? `${lead.city}, ${lead.state} and ${lead.locationsCount} locations` : `${lead.city}, ${lead.state}`,
    apparentStage: reviews >= 150 ? "Established, high-volume" : reviews >= 40 ? "Established" : "Earlier-stage or lower public footprint",
    reputationSignal: rating >= 4.5 ? `Strong (${rating}★, ${reviews} reviews)` : rating >= 4 ? `Solid (${rating}★)` : rating ? `Mixed (${rating}★)` : "No public rating",
    visibleChannels: visibleChannels(lead),
  };

  const observedStrengths = strengths(lead);

  const visibleFriction: SnapshotObservation[] = findings.map((f) => {
    const observationType = observationTypeFor(f.findingType, f.confidence);
    return {
      category: FRICTION_CATEGORY_MAP[f.category] ?? f.category,
      observation: f.observation,
      evidence: f.evidence,
      observationType,
      confidence: f.confidence,
      potentialImpact: hedge(f.businessImpact),
      // Only directly-observed facts are safe to state in cold outreach.
      safeForOutreach: observationType === "Directly observed fact",
    };
  });

  const hypothesesToValidate = buildHypotheses(lead, visibleFriction);
  const discoveryQuestions = buildDiscoveryQuestions(lead, findings);
  const opportunityAreas = deriveOpportunityAreas(lead, findings);
  const outreachAngle = chooseOutreachAngle(lead, visibleFriction, improvement);

  return {
    leadId: lead.id,
    businessName: lead.businessName,
    generatedAt: null,
    context,
    observedStrengths,
    visibleFriction,
    hypothesesToValidate,
    discoveryQuestions,
    opportunityAreas,
    evidence: {
      confidence: improvement.dimensions.evidenceConfidence,
      note:
        improvement.dimensions.evidenceConfidence < 40
          ? "Public evidence is thin. Treat friction items as hypotheses to confirm in conversation."
          : "Based on publicly observable information only; internal operations must be validated in conversation.",
      sources: ["Google Places", lead.website ? "Website signals" : null, findings.length ? "Automated technical analysis" : null].filter(Boolean) as string[],
    },
    outreachAngle,
    conversationStrategy: buildConversationStrategy(lead, outreachAngle, improvement),
    improvement,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function likelyCustomers(lead: Lead): string {
  const i = lead.industry.toLowerCase();
  if (i.includes("dental") || i.includes("medical") || i.includes("clinic")) return "Local patients seeking care, often on mobile, high-consideration";
  if (i.includes("law") || i.includes("account")) return "Individuals and businesses with a specific, urgent need";
  if (i.includes("home") || i.includes("hvac") || i.includes("roof")) return "Homeowners needing timely, trusted service";
  if (i.includes("retail")) return "Local shoppers and repeat customers";
  return "Local customers in the surrounding service area";
}

function visibleChannels(lead: Lead): string[] {
  const out: string[] = [];
  if (lead.website) out.push("Website");
  if (lead.publicEmail) out.push("Public email");
  if (lead.phone) out.push("Phone");
  if (lead.contactFormUrl) out.push("Contact form");
  if (lead.socialLinks?.length) out.push(`${lead.socialLinks.length} social profile(s)`);
  if (lead.googleMapsUrl) out.push("Google Business Profile");
  return out;
}

function strengths(lead: Lead): string[] {
  const out: string[] = [];
  if ((lead.rating ?? 0) >= 4.5 && (lead.reviewCount ?? 0) > 40)
    out.push(`Excellent reputation (${lead.rating}★ across ${lead.reviewCount} reviews) — a real asset to build on.`);
  else if ((lead.rating ?? 0) >= 4) out.push(`Solid public reputation (${lead.rating}★).`);
  out.push(`Established presence in ${lead.city}, ${lead.state}.`);
  out.push(`Clear specialization as a ${lead.industry.toLowerCase()}.`);
  if (lead.website) out.push("Already invests in a web presence to build from.");
  return out.slice(0, 4);
}

function hedge(impact: string): string {
  if (!impact) return "May affect how easily customers engage.";
  const t = impact.trim();
  if (/^(may|might|could|can|likely)/i.test(t)) return t;
  return `May ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

function buildHypotheses(lead: Lead, friction: SnapshotObservation[]): string[] {
  const out: string[] = [];
  const inferred = friction.filter((f) => f.observationType !== "Directly observed fact");
  for (const f of inferred.slice(0, 3)) out.push(`We suspect but cannot confirm: ${f.observation.toLowerCase()}`);
  out.push("Whether follow-up and intake after first contact are handled manually.");
  if ((lead.locationsCount ?? 1) > 1) out.push("How customer requests are routed across locations internally.");
  out.push("Which internal tasks currently depend on spreadsheets, texts, or repeated data entry.");
  return dedupe(out).slice(0, 5);
}

function buildDiscoveryQuestions(lead: Lead, findings: Finding[]): string[] {
  const specific: string[] = [];
  const cats = new Set(findings.map((f) => f.category));
  if (cats.has("Conversion journey") || cats.has("Mobile usability"))
    specific.push("When someone lands on your site from their phone, what do you want them to do first — and does that happen?");
  if (cats.has("Intake") || cats.has("Scheduling"))
    specific.push("How does your team manage appointment or inquiry requests after they come in?");
  if ((lead.locationsCount ?? 1) > 1)
    specific.push("You appear to serve multiple locations — how are customer requests routed internally?");
  const generic = [
    "How do new customers usually find and first contact you today?",
    "Where does your team spend the most time on repetitive work?",
    "Are there parts of the day-to-day that depend on spreadsheets, texts, or repeated data entry?",
    "What have you wanted to improve but kept postponing?",
  ];
  return [...specific, ...generic].slice(0, 6);
}

function deriveOpportunityAreas(lead: Lead, findings: Finding[]): string[] {
  const out = new Set<string>();
  const cats = findings.map((f) => f.category);
  if (cats.includes("Conversion journey") || cats.includes("Mobile usability")) out.add("Customer journey improvement");
  if (cats.includes("Intake")) out.add("Intake simplification");
  if (cats.includes("Scheduling")) out.add("Scheduling integration");
  out.add("Follow-up automation");
  if ((lead.locationsCount ?? 1) > 1) out.add("Centralized information flow");
  if ((lead.scoreBreakdown?.automationOpportunity ?? 0) >= 12) out.add("Better use of an existing platform");
  return Array.from(out).slice(0, 5);
}

export function chooseOutreachAngle(
  lead: Lead,
  friction: SnapshotObservation[],
  improvement: BusinessImprovementPotential,
): BusinessTechnologySnapshot["outreachAngle"] {
  const d = improvement.dimensions;
  const name = lead.businessName;

  // Prefer a directly-observed, safe friction item as the concrete hook.
  const safe = friction.find((f) => f.safeForOutreach);

  if ((lead.locationsCount ?? 1) > 1 && d.operationalComplexity >= 55)
    return {
      category: "Multi-location complexity",
      opener: `Serving several locations usually means customer requests get routed and re-entered in ways that add quiet overhead.`,
      why: "Multi-location signal + operational complexity is the strongest, most specific angle.",
    };
  if (d.operationalComplexity >= d.customerExperience && d.operationalComplexity >= 55)
    return {
      category: "Operational complexity",
      opener: `From the outside it looks like ${name} may be carrying manual, repeatable work behind the scenes — the kind that quietly costs time.`,
      why: "Operational complexity outranks visible customer-facing friction.",
    };
  if (safe)
    return {
      category: safe.category,
      opener: `While looking at ${name}, I noticed ${safe.observation.toLowerCase()}`,
      why: "A directly-observed, safe-to-state fact makes the most honest, specific opener.",
    };
  if (d.growthSignals >= 55)
    return {
      category: "Growth readiness",
      opener: `${name} looks like it's growing — which is usually when systems that worked at a smaller size start to strain.`,
      why: "Growth signals are strong and non-critical (not implying anything is 'broken').",
    };
  return {
    category: "Website as a doorway to broader improvement",
    opener: `I had a look at how ${name} shows up online and had a couple of small, specific observations worth comparing with your own experience.`,
    why: "No single strong signal — lead with humility and a low-pressure, specific opener.",
  };
}

function buildConversationStrategy(
  lead: Lead,
  angle: BusinessTechnologySnapshot["outreachAngle"],
  improvement: BusinessImprovementPotential,
): BusinessTechnologySnapshot["conversationStrategy"] {
  return {
    bestOpening: `Lead with the ${String(angle.category).toLowerCase()} angle, and frame it as comparing notes — not a diagnosis.`,
    validateFirst: [
      "Whether the friction we observed is actually a problem for them",
      "How new inquiries are handled from first contact to booked customer",
      "What the owner already knows is inefficient",
    ],
    doNotAssume: [
      "That they need custom software — a simpler existing tool may be the right answer",
      "That the visible issue is the real bottleneck",
      "Anything about internal operations we could not see from outside",
    ],
    likelyPriorities: [
      "More of the right customers, with less effort",
      "Less time lost to manual/repetitive work",
      improvement.relationship.partnershipLikelihood >= 0.5 ? "A partner who can keep improving things over time" : "A specific, high-impact fix",
    ],
    potentialObjections: ["We're busy enough already", "We've tried agencies before", "Concerned about cost and time"],
    signsOfBroaderOpportunity: [
      "Mentions of spreadsheets, texts, or double data entry",
      "Frustration with tools that don't talk to each other",
      "A software or product idea they've never had time to pursue",
    ],
    goalOfFirstConversation: `Understand how ${lead.businessName} actually works, confirm whether the opportunity is real, and agree on the smallest useful next step. ${CORE_PROMISE}`,
  };
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
