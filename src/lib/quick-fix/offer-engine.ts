// ─────────────────────────────────────────────────────────────────────────────
// OFFER ENGINE — the hybrid assembler.
//
//   evidence → validated finding → validated capability → deterministic
//   scope/complexity classification → approved pricing → AI-personalized packaging
//   → operator-visible offer.
//
// AI (or a caller) may personalize the NAME and one-line SOLUTION wording only —
// via the injected `copy` override, which is fabrication-checked. Price, tier,
// scope items, delivery window, and economics are all deterministic. The engine
// knows when NOT to productize (returns a book-a-conversation decision instead of
// an artificial package).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type {
  QuickFixOffer,
  OfferFinding,
  OfferScope,
  MaintenanceRecommendation,
  AutomationLevel,
} from "./types";
import { assessEvidence, gradedProblemStatement, containsFabricatedClaim } from "./evidence-gate";
import { matchCapability, capabilityByKey, type Capability } from "./capabilities";
import { classifyPricing, type ComplexityInput } from "./pricing";
import { computeEconomics, DEFAULT_THRESHOLD, type EconomicsThreshold } from "./economics";
import { maintenancePlanByKey } from "./maintenance";
import { DEFAULT_AUTOMATION_LEVEL } from "./automation-policy";

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

export interface GenerateOfferInput {
  leadId: string;
  companyName: string;
  findings: OfferFinding[];
  /** Optional caller/LLM copy personalization — fabrication-checked, never price. */
  copy?: { offerName?: string; proposedSolution?: string };
  automationLevel?: AutomationLevel;
  threshold?: EconomicsThreshold;
  /**
   * Whether the business has a functioning website. Defaults true. Every current
   * capability edits an existing site, so a business with NO website cannot be
   * sold a quick fix — a website build is not a low-ticket productized offer.
   */
  hasWebsite?: boolean;
  /** Injected for determinism; stamped onto the offer. */
  generatedAt?: string | null;
}

/** Non-productizable outcome (evidence too weak, or needs a conversation). */
function nonEligibleOffer(
  input: GenerateOfferInput,
  reason: string,
  confidence: number,
  grade: QuickFixOffer["evidenceGrade"],
): QuickFixOffer {
  return {
    offerId: "",
    leadId: input.leadId,
    companyName: input.companyName,
    findingIds: input.findings.map((f) => f.id),
    capabilityKeys: [],
    band: "ENTRY",
    priceCents: 0,
    currency: "usd",
    scope: {
      offerName: "",
      problemBeingSolved: "",
      proposedSolution: "",
      includedItems: [],
      excludedItems: [],
      customerInputsRequired: [],
      deliveryWindow: "",
      revisionPolicy: "",
    },
    evidenceGrade: grade,
    confidence,
    rationale: reason,
    economics: computeEconomics({ priceCents: 0, estimatedHours: 0.25, externalCostCents: 0, deliveryRisk: "low", supportBurden: "low" }),
    maintenance: null,
    quickFixEligible: false,
    notEligibleReason: reason,
    automationLevel: input.automationLevel ?? DEFAULT_AUTOMATION_LEVEL,
    offerVersion: "",
    state: "DRAFT",
    generatedAt: input.generatedAt ?? null,
  };
}

function deliveryFor(hours: number): { label: string; window: string } {
  if (hours <= 2) return { label: "24-Hour", window: "Delivered within 24 hours of receiving the required access." };
  if (hours <= 5) return { label: "48-Hour", window: "Delivered within 48 hours of receiving the required access." };
  return { label: "5-Day", window: "Delivered within 5 business days of receiving the required access." };
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// The CUSTOMER-FACING offer noun. Single-capability offers use the capability's
// plain-language `customerTitle` (never `.name`, which may contain acronyms like
// "CTA"). Bundles keep the umbrella-by-dominant-category logic but the umbrella
// names are plain-language too — no acronym or jargon ever leaks to a prospect.
function offerNounFor(caps: Capability[]): string {
  if (caps.length === 1) return caps[0].customerTitle;
  // Multi-capability bundle → a cohesive plain-language umbrella by dominant category.
  const cats = caps.flatMap((c) => c.addressesCategories);
  if (cats.includes("Customer Acquisition")) return "Get More Website Contacts";
  if (cats.includes("Brand Experience")) return "Website Improvements";
  return "Website Fix";
}

/**
 * Generate a quick-fix offer for a lead's findings. Pure + deterministic given
 * the same inputs (offerVersion is a stable hash of the price-relevant fields).
 */
export function generateOffer(input: GenerateOfferInput): QuickFixOffer {
  const automationLevel = input.automationLevel ?? DEFAULT_AUTOMATION_LEVEL;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;

  // 0) NO-WEBSITE HARD DISQUALIFIER — you cannot fix a site that doesn't exist.
  const hasWebsite = input.hasWebsite ?? true;
  if (!hasWebsite) {
    const ev0 = assessEvidence(input.findings);
    return nonEligibleOffer(input, "the business has no functioning website — a quick fix edits an existing site, so this is a conversation (a website build is not a low-ticket quick fix)", ev0.confidence, ev0.grade);
  }

  // 1) EVIDENCE GATE
  const ev = assessEvidence(input.findings);
  if (!ev.sufficientForOffer) {
    return nonEligibleOffer(input, ev.reason, ev.confidence, ev.grade);
  }

  // 2) CAPABILITY MATCH — only sellable capabilities; keep finding↔capability map.
  const matched: Array<{ finding: OfferFinding; cap: Capability }> = [];
  for (const f of ev.qualifyingFindings) {
    const cap = matchCapability(f);
    if (cap) matched.push({ finding: f, cap });
  }
  if (matched.length === 0) {
    return nonEligibleOffer(input, "no sellable capability matches the evidence — route to a conversation", ev.confidence, ev.grade);
  }

  // De-dupe capabilities (one capability may cover several findings).
  const capByKey = new Map<string, Capability>();
  const findingIdsByCap = new Map<string, string[]>();
  for (const m of matched) {
    capByKey.set(m.cap.key, m.cap);
    findingIdsByCap.set(m.cap.key, uniq([...(findingIdsByCap.get(m.cap.key) ?? []), m.finding.id]));
  }
  const caps = Array.from(capByKey.values());

  // 3) COMPLEXITY (deterministic) — never trust the LLM here.
  const estimatedHours = caps.reduce((s, c) => s + (c.minHours + c.maxHours) / 2, 0);
  const changeCount = caps.length;
  const maxRisk = caps.reduce<Capability["risk"]>((r, c) => (RISK_RANK[c.risk] > RISK_RANK[r] ? c.risk : r), "low");
  const maxSupport = caps.reduce<Capability["supportBurden"]>((r, c) => (RISK_RANK[c.supportBurden] > RISK_RANK[r] ? c.supportBurden : r), "low");
  const requiresDiscovery = caps.some((c) => c.requiresDiscovery);
  // A broad bundle built only on INFERRED evidence is too uncertain to fix a price.
  const scopeUncertain = ev.grade === "INFERRED" && caps.length >= 3;

  const complexity: ComplexityInput = { estimatedHours, changeCount, maxRisk, requiresDiscovery, scopeUncertain };
  const pricing = classifyPricing(complexity);
  if (!pricing.quickFixEligible || pricing.band == null || pricing.priceCents == null) {
    return nonEligibleOffer(input, `not a fixed-price quick fix — ${pricing.reason}; book a conversation`, ev.confidence, ev.grade);
  }

  // 4) ECONOMICS + MARGIN GUARDRAIL
  const externalCostCents = caps.reduce((s, c) => s + c.externalCostCents, 0);
  const economics = computeEconomics(
    { priceCents: pricing.priceCents, estimatedHours, externalCostCents, deliveryRisk: maxRisk, supportBurden: maxSupport },
    threshold,
  );
  if (!economics.clearsMarginGate) {
    const off = nonEligibleOffer(input, `fails the economics guardrail (${economics.marginReasons.join("; ")}) — escalate / book a conversation`, ev.confidence, ev.grade);
    off.economics = economics;
    off.capabilityKeys = caps.map((c) => c.key);
    off.band = pricing.band;
    off.priceCents = pricing.priceCents;
    return off;
  }

  // 5) SCOPE (customer-facing) — deterministic assembly.
  const primary = caps[0];
  const delivery = deliveryFor(estimatedHours);
  // Anchor the problem statement on the finding that produced the PRIMARY
  // capability — not just the first qualifying finding (which may be unrelated).
  const primaryFindingId = (findingIdsByCap.get(primary.key) ?? [])[0];
  const topFinding = matched.find((m) => m.finding.id === primaryFindingId)?.finding ?? ev.qualifyingFindings[0];

  // AI-personalizable NAME + one-line SOLUTION (fabrication-checked). Never price.
  const deterministicName = `${delivery.label} ${offerNounFor(caps)}`;
  const offerName = input.copy?.offerName && !containsFabricatedClaim(input.copy.offerName) ? input.copy.offerName : deterministicName;
  const deterministicSolution =
    caps.length === 1 ? primary.solutionSummary : `${primary.solutionSummary} We also address ${caps.slice(1).map((c) => c.customerTitle.toLowerCase()).join(", ")}.`;
  const proposedSolution = input.copy?.proposedSolution && !containsFabricatedClaim(input.copy.proposedSolution) ? input.copy.proposedSolution : deterministicSolution;

  const includedItems = uniq(caps.flatMap((c) => c.includedItems)).slice(0, 8);
  const excludedItems = uniq(caps.flatMap((c) => c.excludedItems));
  const customerInputsRequired = uniq(caps.flatMap((c) => c.accessRequirements.map((a) => a.label)));
  // Longest revision window among bundled capabilities.
  const revisionPolicy = caps.map((c) => c.revisionPolicy).sort((a, b) => b.length - a.length)[0];

  const scope: OfferScope = {
    offerName,
    problemBeingSolved: gradedProblemStatement(topFinding),
    proposedSolution,
    includedItems,
    excludedItems,
    customerInputsRequired,
    deliveryWindow: delivery.window,
    revisionPolicy,
  };

  // 6) MAINTENANCE recommendation (optional, from the primary capability).
  const plan = maintenancePlanByKey(primary.maintenancePlanKey);
  const maintenance: MaintenanceRecommendation | null = plan
    ? { planKey: plan.key, planName: plan.name, monthlyCents: plan.monthlyCents, rationale: `Keeps the ${primary.customerTitle.toLowerCase()} healthy after delivery.` }
    : null;

  // 7) VERSION — stable hash of everything that affects price or what's delivered.
  const capKeys = caps.map((c) => c.key).sort();
  const findingIds = uniq(matched.map((m) => m.finding.id)).sort();
  const offerVersion = createHash("sha256")
    .update(JSON.stringify({ leadId: input.leadId, capKeys, band: pricing.band, priceCents: pricing.priceCents, findingIds, includedItems }))
    .digest("hex")
    .slice(0, 16);

  const rationale = `Anchored on ${ev.qualifyingFindings.length} ${ev.grade.toLowerCase()} finding(s) (conf ${ev.confidence.toFixed(2)}). ${pricing.reason}. Effective $${(economics.effectiveHourlyCents / 100).toFixed(0)}/hr.`;

  return {
    offerId: "",
    leadId: input.leadId,
    companyName: input.companyName,
    findingIds,
    capabilityKeys: capKeys,
    band: pricing.band,
    priceCents: pricing.priceCents,
    currency: "usd",
    scope,
    evidenceGrade: ev.grade,
    confidence: ev.confidence,
    rationale,
    economics,
    maintenance,
    quickFixEligible: true,
    notEligibleReason: null,
    automationLevel,
    offerVersion,
    state: "DRAFT",
    generatedAt: input.generatedAt ?? null,
  };
}
