// ─────────────────────────────────────────────────────────────────────────────
// Modernization opportunities — categorized, evidence-backed, modular.
//
// Instead of generic recommendations, each opportunity is CLASSIFIED into a
// category and carries an observation, why it matters, an estimated impact, a
// confidence, and its provenance. Rules are modular: each reads the context and
// the dimension readings and emits at most one opportunity. Adding a category or
// a rule never touches existing rules or the assembler.
//
// A rule NEVER invents a gap. Every opportunity traces back to a reading that was
// itself built from real evidence — so `basis` is always non-empty and honest.
// ─────────────────────────────────────────────────────────────────────────────
import type { OpportunityRule, ModernizationOpportunity, SignalReading, ProfileContext, ImpactLevel, ReadingStatus } from "./types";
import type { Confidence } from "./confidence";

// ── helpers ──────────────────────────────────────────────────────────────────
function find(readings: SignalReading[], key: string): SignalReading | undefined {
  return readings.find((r) => r.key === key);
}
function isWeak(r: SignalReading | undefined): r is SignalReading {
  return !!r && (r.status === "weak" || r.status === "absent");
}
function statusIn(r: SignalReading | undefined, ...s: ReadingStatus[]): r is SignalReading {
  return !!r && s.includes(r.status);
}
function opp(
  id: string,
  category: ModernizationOpportunity["category"],
  observation: string,
  whyItMatters: string,
  level: ImpactLevel,
  rationale: string,
  confidence: Confidence,
  basis: string[],
): ModernizationOpportunity {
  return { id, category, observation, whyItMatters, estimatedImpact: { level, rationale }, confidence, basis };
}

// ── rules ───────────────────────────────────────────────────────────────────
// Discovery / acquisition ------------------------------------------------------
const ownedPresence: OpportunityRule = {
  id: "owned-presence",
  category: "Customer Acquisition",
  evaluate(ctx, readings) {
    if (ctx.presence.hasWebsite) return null;
    const site = find(readings, "website-quality");
    if (!site) return null;
    const strongRep = ctx.presence.reviews.strength === "strong" || ctx.presence.reviews.strength === "solid";
    return opp(
      this.id, this.category,
      `The business has no owned website — it's represented online only by ${ctx.presence.primaryChannel}.`,
      strongRep ? "A strong reputation is being built on ground the business doesn't control; an owned home base converts that attention on its own terms." : "Without a home base they control, the business is dependent on platforms that decide who sees it.",
      "Foundational",
      "An owned presence is the foundation most other improvements build on.",
      site.confidence,
      site.basis,
    );
  },
};

const googleBusiness: OpportunityRule = {
  id: "google-business",
  category: "Customer Acquisition",
  evaluate(_ctx, readings) {
    const r = find(readings, "google-business-completeness");
    if (!isWeak(r)) return null;
    return opp(this.id, this.category, r.summary, "The Google Business Profile is the first thing most local customers see; an incomplete one quietly sends them to a competitor.", r.status === "absent" ? "High" : "Moderate", "Completing a listing is low-effort and directly affects how many people call.", r.confidence, r.basis);
  },
};

const mobileExperience: OpportunityRule = {
  id: "mobile-experience",
  category: "Customer Acquisition",
  evaluate(_ctx, readings) {
    const r = find(readings, "mobile-friendliness");
    if (!isWeak(r)) return null;
    return opp(this.id, this.category, r.summary, "Most first visits happen on a phone; a site that struggles there loses customers before they ever make contact.", "High", "Mobile experience directly gates how many visitors convert.", r.confidence, r.basis);
  },
};

const pageSpeedOpp: OpportunityRule = {
  id: "page-speed",
  category: "Customer Acquisition",
  evaluate(_ctx, readings) {
    const r = find(readings, "page-speed");
    if (!isWeak(r)) return null;
    return opp(this.id, this.category, r.summary, "Every extra second of load time measurably drops the share of visitors who stay.", "Moderate", "Speed is a direct, measurable conversion lever.", r.confidence, r.basis);
  },
};

const conversionPath: OpportunityRule = {
  id: "conversion-path",
  category: "Customer Acquisition",
  evaluate(_ctx, readings) {
    const cta = find(readings, "calls-to-action");
    const nav = find(readings, "navigation-quality");
    const r = isWeak(cta) ? cta : isWeak(nav) ? nav : undefined;
    if (!r) return null;
    return opp(this.id, this.category, r.summary, "A ready customer who can't tell what to do next is a customer lost at the last step.", "High", "Clarifying the primary action is one of the highest-return changes possible.", r.confidence, r.basis);
  },
};

// Retention / brand ------------------------------------------------------------
const reviewGeneration: OpportunityRule = {
  id: "review-generation",
  category: "Customer Retention",
  evaluate(_ctx, readings) {
    const r = find(readings, "review-quality");
    if (!statusIn(r, "absent", "weak")) return null;
    return opp(this.id, this.category, r.summary, "Reviews are what a stranger trusts before they trust the business; a steady stream of them compounds into acquisition too.", r.status === "absent" ? "High" : "Moderate", "A simple, automated review request turns satisfied customers into proof.", r.confidence, r.basis);
  },
};

const brandTrust: OpportunityRule = {
  id: "brand-trust",
  category: "Brand Experience",
  evaluate(_ctx, readings) {
    const trust = find(readings, "trust-signals");
    const impression = find(readings, "first-impression");
    const r = isWeak(trust) ? trust : isWeak(impression) ? impression : undefined;
    if (!r) return null;
    return opp(this.id, this.category, r.summary, "The moments before a customer decides are carried by trust; thin trust signals slow every decision down.", "Moderate", "Surfacing credentials, testimonials, and guarantees lifts conversion without new traffic.", r.confidence, r.basis);
  },
};

// Scheduling / communication ---------------------------------------------------
const onlineBooking: OpportunityRule = {
  id: "online-booking",
  category: "Scheduling",
  evaluate(_ctx, readings) {
    const r = find(readings, "booking-friction") ?? find(readings, "appointment-workflow");
    if (!isWeak(r)) return null;
    return opp(this.id, this.category, r.summary, "Every booking that requires a phone call during business hours is a booking lost from the customers who'd rather do it at 10pm.", "High", "Online booking captures demand that currently slips away after hours.", r.confidence, r.basis);
  },
};

const responsiveness: OpportunityRule = {
  id: "responsiveness",
  category: "Communication",
  evaluate(_ctx, readings) {
    const resp = find(readings, "response-activity");
    const comm = find(readings, "communication-maturity");
    const r = isWeak(resp) ? resp : isWeak(comm) ? comm : undefined;
    if (!r) return null;
    return opp(this.id, this.category, r.summary, "Customers go with whoever answers first; slow or manual follow-up hands deals to faster competitors.", "High", "Automated confirmations and reminders close the response gap without adding staff.", r.confidence, r.basis);
  },
};

const followUpAutomation: OpportunityRule = {
  id: "follow-up-automation",
  category: "Automation",
  evaluate(ctx, readings) {
    const comm = find(readings, "communication-maturity");
    // Only when communication looks manual AND there's no booking automation to lean on.
    if (!isWeak(comm) || ctx.presence.hasOnlineBooking) return null;
    return opp(this.id, this.category, comm.summary, "Repetitive follow-up done by hand is time the team shouldn't be spending and messages that inevitably get missed.", "Moderate", "Automating the most repeated touchpoints returns hours every week.", comm.confidence, comm.basis);
  },
};

// Operations / workflow --------------------------------------------------------
const multiLocationCoordination: OpportunityRule = {
  id: "multi-location-coordination",
  category: "Operations",
  evaluate(ctx, readings) {
    if (!ctx.presence.multipleLocations) return null;
    const r = find(readings, "multiple-locations");
    if (!r) return null;
    return opp(this.id, this.category, r.summary, "Across locations, information and requests kept in step by hand is where quiet overhead and inconsistency accumulate.", "Moderate", "Centralizing the flow removes duplicated work and keeps every location consistent.", r.confidence, r.basis);
  },
};

const internalWorkflow: OpportunityRule = {
  id: "internal-workflow",
  category: "Internal Workflow",
  evaluate(_ctx, readings) {
    const r = find(readings, "operational-maturity");
    if (!isWeak(r)) return null;
    return opp(this.id, this.category, r.summary, "Manual, repetitive internal processes are both a time cost today and the thing that breaks first as the business grows.", "Moderate", "A system of record for the most repetitive process removes rework and errors.", r.confidence, r.basis);
  },
};

// Reporting / analytics --------------------------------------------------------
const operationalVisibility: OpportunityRule = {
  id: "operational-visibility",
  category: "Reporting",
  evaluate(ctx, readings) {
    const r = find(readings, "technology-maturity");
    if (!isWeak(r)) return null;
    // Reporting is rarely visible externally — keep this an explicit, low-confidence prompt.
    return opp(this.id, this.category, "From the outside there's little sign of operational reporting or dashboards.", "Owners who can see their numbers weekly make faster, better decisions than those working from memory.", "Incremental", "A simple dashboard on the few numbers that matter pays for itself in decisions.", r.confidence, [...r.basis, "reporting not externally visible — inferred"]);
  },
};

const measurement: OpportunityRule = {
  id: "measurement",
  category: "Analytics",
  evaluate(ctx, _readings) {
    // Only worth raising when they already invest online (a site to measure).
    if (!ctx.presence.hasWebsite) return null;
    if (!ctx.evidence.has("services") && !ctx.evidence.has("blog")) return null;
    return opp(this.id, this.category, "The business invests in its online presence, but there's no external sign of measuring what that presence actually returns.", "Knowing which pages and channels bring customers turns guesswork into a repeatable acquisition engine.", "Incremental", "Basic analytics reveal where to double down and where effort is wasted.", { label: "Inferred", score: 0.4 }, ["presence.hasWebsite=true", "measurement not externally visible — inferred"]);
  },
};

/** The registry — order here is only a tiebreaker; the assembler sorts by impact. */
export const OPPORTUNITY_RULES: OpportunityRule[] = [
  ownedPresence,
  googleBusiness,
  mobileExperience,
  pageSpeedOpp,
  conversionPath,
  reviewGeneration,
  brandTrust,
  onlineBooking,
  responsiveness,
  followUpAutomation,
  multiLocationCoordination,
  internalWorkflow,
  operationalVisibility,
  measurement,
];

const IMPACT_ORDER: Record<ImpactLevel, number> = { Foundational: 0, High: 1, Moderate: 2, Incremental: 3 };

/** Run every rule, then order strongest-first (impact, then confidence, then id). */
export function deriveOpportunities(ctx: ProfileContext, readings: SignalReading[]): ModernizationOpportunity[] {
  const out: ModernizationOpportunity[] = [];
  for (const rule of OPPORTUNITY_RULES) {
    const o = rule.evaluate(ctx, readings);
    if (o) out.push(o);
  }
  return out.sort((a, b) => {
    const byImpact = IMPACT_ORDER[a.estimatedImpact.level] - IMPACT_ORDER[b.estimatedImpact.level];
    if (byImpact !== 0) return byImpact;
    const byConf = b.confidence.score - a.confidence.score;
    if (byConf !== 0) return byConf;
    return a.id.localeCompare(b.id);
  });
}
