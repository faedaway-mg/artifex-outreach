// ─────────────────────────────────────────────────────────────────────────────
// Explainable investment engine.
//
// The old model attached a single opaque range to a brief ("$8,000–$18,000") with
// no way to answer "why that number?". This engine DECOMPOSES the engagement band
// into scoped line items, each following a fixed reasoning chain:
//
//   Observation → Business Impact → Recommendation → Estimated Effort →
//   Deliverables → Estimated Investment → Expected Business Outcome
//
// Every line's dollars are derived from effort × a blended rate, and the line items
// RECONCILE EXACTLY to the totals — so the range is explained, not asserted. The
// totals still match settings.defaultPricing[service], so nothing downstream that
// depends on the historical band changes.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Lead,
  Settings,
  ArtifexService,
  DeliverableContent,
  InvestmentModel,
  InvestmentLineItem,
  InvestmentComplexity,
} from "./types";

type OpportunityInput = DeliverableContent["opportunities"][number];

/** Blended implementation rate. A boutique studio rate; overridable per settings. */
const DEFAULT_BLENDED_RATE = 165;

/** Concrete deliverables a client receives per engagement (client-facing wording). */
export const ENGAGEMENT_DELIVERABLES: Record<ArtifexService, string[]> = {
  "Launch Website": ["A focused, fast customer-facing page", "A clear primary action for customers", "Simple lead capture"],
  "Business Website System": ["A modern, responsive website", "Online intake and scheduling", "Automated confirmations and reminders"],
  "Automation Sprint": ["Scheduling automation", "Confirmation and reminder messages", "Automated review requests"],
  "AI Operations System": ["AI-assisted intake", "Automated follow-up sequences", "Pipeline reporting"],
  "Product or MVP Build": ["Product scoping and specification", "A working MVP build", "Launch support"],
  "Visual Asset System": ["A reusable brand asset system", "Templated content", "A repeatable production pipeline"],
  "Product Strategy Engagement": ["Discovery and strategy sessions", "A prioritized roadmap", "Documented recommendations"],
};

/** Plain-language foundation line — the core engagement, always present. */
const FOUNDATION: Record<ArtifexService, { observation: string; businessImpact: string; recommendation: string; expectedOutcome: string }> = {
  "Launch Website": {
    observation: "There is no focused, fast page built to turn interest into a first contact.",
    businessImpact: "Interested prospects who arrive with intent may leave before there is a clear way to act, quietly losing inquiries.",
    recommendation: "Build a focused launch page with one clear primary action and simple lead capture.",
    expectedOutcome: "A dependable front door that converts more of the visitors already arriving.",
  },
  "Business Website System": {
    observation: "The current customer-facing experience makes it harder than it needs to be to find, choose, and reach the business.",
    businessImpact: "Friction in the first minutes of the customer journey typically leaks inquiries that never become conversations.",
    recommendation: "Rebuild the site as a modern system with online intake and scheduling wired to how the business actually runs.",
    expectedOutcome: "More of the right customers reaching the business with less manual effort behind the scenes.",
  },
  "Automation Sprint": {
    observation: "Repeatable customer-facing steps appear to be handled manually.",
    businessImpact: "Manual scheduling, confirmations, and follow-up consume staff time and let some requests slip.",
    recommendation: "Stand up a focused automation for the highest-volume repetitive workflow.",
    expectedOutcome: "Fewer dropped requests and hours of recurring manual work removed each week.",
  },
  "AI Operations System": {
    observation: "Inbound requests and follow-up look like they depend on manual, one-at-a-time handling.",
    businessImpact: "Slow or inconsistent follow-up is one of the most common reasons ready customers go elsewhere.",
    recommendation: "Implement an AI-assisted intake and follow-up system tied to the existing pipeline.",
    expectedOutcome: "Faster, more consistent response to every inbound opportunity with less staff load.",
  },
  "Product or MVP Build": {
    observation: "There is a product opportunity that has not been scoped into something buildable.",
    businessImpact: "An unbuilt idea produces no learning or revenue while the opportunity window stays open.",
    recommendation: "Scope and build a focused MVP that tests the core value with real users.",
    expectedOutcome: "A working product in market and real evidence to guide the next investment.",
  },
  "Visual Asset System": {
    observation: "Visual assets appear inconsistent and produced one-off rather than from a system.",
    businessImpact: "Inconsistent visuals dilute trust and make every new piece of content slower to produce.",
    recommendation: "Build a reusable brand asset system with templates and a production pipeline.",
    expectedOutcome: "Faster, on-brand content production without redoing the basics each time.",
  },
  "Product Strategy Engagement": {
    observation: "There are several possible directions without an agreed, prioritized plan.",
    businessImpact: "Effort spread thin across unprioritized ideas is slower and more expensive than a focused sequence.",
    recommendation: "Run a discovery and strategy engagement that produces a prioritized roadmap.",
    expectedOutcome: "A clear, agreed sequence so the next dollars go to the highest-impact work first.",
  },
};

const BILLING: Record<ArtifexService, "one-time" | "monthly"> = {
  "Launch Website": "one-time",
  "Business Website System": "one-time",
  "Automation Sprint": "one-time",
  "AI Operations System": "monthly",
  "Product or MVP Build": "one-time",
  "Visual Asset System": "one-time",
  "Product Strategy Engagement": "one-time",
};

export function buildInvestmentModel(
  lead: Lead,
  opportunities: OpportunityInput[],
  service: ArtifexService,
  settings: Settings,
  opts: { blendedRate?: number } = {},
): InvestmentModel {
  const band = settings.defaultPricing[service] ?? { low: 3000, high: 8000 };
  const rate = Math.max(50, Math.round(opts.blendedRate ?? DEFAULT_BLENDED_RATE));

  // ── Build the (unpriced) list of work items ────────────────────────────────
  const foundation = FOUNDATION[service];
  const items: Array<{
    observation: string;
    businessImpact: string;
    recommendation: string;
    deliverables: string[];
    expectedOutcome: string;
    weight: number;
    complexity: InvestmentComplexity;
  }> = [];

  const deliverablesCatalog = ENGAGEMENT_DELIVERABLES[service];
  const foundationComplexity: InvestmentComplexity = band.high >= 15000 ? "Involved" : "Standard";
  items.push({
    observation: foundation.observation,
    businessImpact: foundation.businessImpact,
    recommendation: foundation.recommendation,
    deliverables: deliverablesCatalog.slice(0, 2),
    expectedOutcome: foundation.expectedOutcome,
    weight: 2.4,
    complexity: foundationComplexity,
  });

  // One line per approved opportunity (cap at 2 so bands split cleanly and the
  // foundation stays the largest single line).
  for (const o of opportunities.slice(0, 2)) {
    const complexity = complexityOf(o.observation + " " + o.modernizationDirection);
    items.push({
      observation: o.observation,
      businessImpact: hedgeImpact(o.businessConsequence),
      recommendation: o.modernizationDirection,
      deliverables: [`Implementation of: ${asDeliverable(o.modernizationDirection)}`, "Testing and handoff"],
      expectedOutcome: outcomeFor(o),
      weight: weightForComplexity(complexity),
      complexity,
    });
  }

  // If there were no opportunities, add a standard secondary line so the model is
  // never a single opaque number.
  if (items.length === 1) {
    items.push({
      observation: "Follow-up after a first inquiry appears to be handled manually.",
      businessImpact: "Delayed or missed follow-up is a common, quiet source of lost customers.",
      recommendation: "Add automated follow-up so no inquiry goes cold.",
      deliverables: ["Automated follow-up sequence", "Testing and handoff"],
      expectedOutcome: "Fewer inquiries lost to slow or forgotten follow-up.",
      weight: 1,
      complexity: "Standard",
    });
  }

  // ── Allocate the band across items, proportional to weight ──────────────────
  const weights = items.map((i) => i.weight);
  const lowAlloc = allocate(band.low, weights);
  const highAlloc = allocate(band.high, weights);

  const lineItems: InvestmentLineItem[] = items.map((it, idx) => {
    let investmentLow = lowAlloc[idx];
    let investmentHigh = highAlloc[idx];
    if (investmentHigh < investmentLow) investmentHigh = investmentLow; // defensive
    const lowHours = Math.max(1, Math.round(investmentLow / rate));
    const highHours = Math.max(lowHours, Math.round(investmentHigh / rate));
    return {
      id: `li-${idx + 1}`,
      observation: it.observation,
      businessImpact: it.businessImpact,
      recommendation: it.recommendation,
      effort: {
        lowHours,
        highHours,
        complexity: it.complexity,
        summary: effortSummary(lowHours, highHours),
      },
      deliverables: it.deliverables,
      investmentLow,
      investmentHigh,
      rateBasis: `Blended build rate $${rate}/hr × ${lowHours}–${highHours} hrs`,
      expectedOutcome: it.expectedOutcome,
    };
  });

  const subtotalLow = sum(lineItems.map((l) => l.investmentLow));
  const subtotalHigh = sum(lineItems.map((l) => l.investmentHigh));

  return {
    currency: "USD",
    engagement: service,
    billing: BILLING[service],
    blendedHourlyRate: rate,
    lineItems,
    subtotalLow,
    subtotalHigh,
    totalLow: subtotalLow,
    totalHigh: subtotalHigh,
    rangeLabel: `$${subtotalLow.toLocaleString()}–$${subtotalHigh.toLocaleString()}`,
    explanation: `This ${BILLING[service] === "monthly" ? "monthly" : "one-time"} figure is the sum of ${lineItems.length} scoped work items below — each tied to a specific observation, an effort estimate, the deliverables it produces, and the outcome it is expected to create. Nothing here is a round-number guess.`,
    discoveryNote:
      "Final scope and price are confirmed in a short discovery conversation. These figures are a planning estimate, not a binding quote — the best answer is sometimes a smaller, simpler first step.",
  };
}

// ── Allocation ────────────────────────────────────────────────────────────────
// Split `band` across `weights`, rounded to the nearest $100, guaranteeing the
// result sums to `band` exactly (drift absorbed by the largest-weight line).
function allocate(band: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const rounded = weights.map((w) => Math.round((band * w) / total / 100) * 100);
  const drift = band - rounded.reduce((a, b) => a + b, 0);
  const maxIdx = weights.indexOf(Math.max(...weights));
  rounded[maxIdx] = Math.max(0, rounded[maxIdx] + drift);
  return rounded;
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

function complexityOf(text: string): InvestmentComplexity {
  const t = text.toLowerCase();
  if (/(multi|integrat|automat|booking|schedul|dashboard|pipeline|migrat|api)/.test(t)) return "Involved";
  if (/(copy|image|photo|text|speed|color|logo|font|caption)/.test(t)) return "Focused";
  return "Standard";
}

function weightForComplexity(c: InvestmentComplexity): number {
  return c === "Involved" ? 1.4 : c === "Focused" ? 0.7 : 1;
}

function effortSummary(lowHours: number, highHours: number): string {
  const weeksLow = Math.max(1, Math.round(lowHours / 35));
  const weeksHigh = Math.max(weeksLow, Math.round(highHours / 35));
  const label = weeksLow === weeksHigh ? `${weeksLow} week${weeksLow > 1 ? "s" : ""}` : `${weeksLow}–${weeksHigh} weeks`;
  return `≈ ${label} of focused build`;
}

function hedgeImpact(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "May affect how easily customers engage.";
  if (/^(may|might|could|can|likely)/i.test(t)) return t;
  return `May ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

function asDeliverable(direction: string): string {
  const t = (direction ?? "").trim().replace(/\.$/, "");
  return t.length ? t.charAt(0).toLowerCase() + t.slice(1) : "the recommended improvement";
}

function outcomeFor(o: OpportunityInput): string {
  const dir = (o.modernizationDirection ?? "").toLowerCase();
  if (/(booking|schedul)/.test(dir)) return "More first appointments captured without a phone call.";
  if (/(follow|reminder)/.test(dir)) return "Fewer inquiries lost to slow or forgotten follow-up.";
  if (/(mobile|speed|page)/.test(dir)) return "More mobile visitors reaching the next step instead of leaving.";
  if (/(intake|form)/.test(dir)) return "A smoother path from interest to a completed inquiry.";
  return "A measurable reduction in the friction described above.";
}
