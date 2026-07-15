// ─────────────────────────────────────────────────────────────────────────────
// Acquisition strategy engine. Recommends how much automation/personalization a
// lead warrants — separate from lead-quality tier. RATING IS ONE INPUT ONLY (a
// fraction of one of six factors); a low rating never forces automation and a
// high rating never forces it either. Fully transparent breakdown.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, AcquisitionStrategy, AcquisitionScoreBreakdown } from "../types";

const REGULATED = ["Dental", "Orthodont", "Physical therapy", "Chiropractic", "Med spa", "Wellness clinic", "Law", "Accounting", "Tax", "Financial"];

export interface StrategyInput {
  suppressed?: boolean;
  optedOut?: boolean;
  hasApprovedFindings?: boolean;
}

export interface StrategyResult {
  strategy: AcquisitionStrategy;
  score: number;
  breakdown: AcquisitionScoreBreakdown;
  reason: string;
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function computeAcquisitionStrategy(lead: Lead, input: StrategyInput = {}): StrategyResult {
  const estHigh = lead.estimatedValueHigh ?? 0;
  const rating = lead.rating ?? 0;
  const reviews = lead.reviewCount ?? 0;
  const b = lead.scoreBreakdown;

  // Opportunity value (/25)
  const opportunityValue = clamp(estHigh >= 20000 ? 25 : estHigh >= 12000 ? 20 : estHigh >= 8000 ? 16 : estHigh >= 4000 ? 11 : estHigh > 0 ? 7 : 5, 25);
  // Need (/20) — from website + automation opportunity if analyzed, else moderate
  const need = b ? clamp(((b.websiteOpportunity + b.automationOpportunity) / 40) * 20, 20) : 10;
  // Contactability (/20)
  let contact = 0;
  if (lead.phone) contact += 6;
  if (lead.publicEmail) contact += 8;
  if (lead.contactFormUrl) contact += 3;
  if (lead.website) contact += 3;
  const contactability = clamp(contact, 20);
  // Trust & stability (/15) — rating is only ~7 of 15 (never decisive)
  const trustStability = clamp((rating / 5) * 7 + Math.min(1, reviews / 200) * 5 + (lead.businessStatus === "OPERATIONAL" ? 3 : 0), 15);
  // Personalization requirement (/10)
  let pers = 0;
  if (estHigh >= 12000) pers += 4;
  if ((lead.locationsCount ?? 1) > 1) pers += 3;
  if (REGULATED.some((r) => lead.industry.toLowerCase().includes(r.toLowerCase()))) pers += 3;
  const personalization = clamp(pers, 10);
  // Cost to pursue (/10) — higher = cheaper to pursue (good contact + analysis ready)
  const costToPursue = clamp((contactability / 20) * 6 + (input.hasApprovedFindings ? 4 : 2), 10);

  const breakdown: AcquisitionScoreBreakdown = { opportunityValue, need, contactability, trustStability, personalization, costToPursue };
  const score = opportunityValue + need + contactability + trustStability + personalization + costToPursue;

  // ── Hard overrides ─────────────────────────────────────────────────────────
  if (input.suppressed || input.optedOut || lead.businessStatus === "CLOSED_PERMANENTLY") {
    return { strategy: "Do Not Contact", score, breakdown, reason: overrideReason(lead, input) };
  }
  if (contactability < 4 || (!lead.publicEmail && !lead.phone && !lead.website)) {
    return { strategy: "Manual Review", score, breakdown, reason: "Contact route is unreliable or unclear — needs manual review before any outreach." };
  }

  // ── Tiering (rating is not part of the gate) ───────────────────────────────
  let strategy: AcquisitionStrategy;
  if (score >= 68 && opportunityValue >= 16 && contactability >= 10 && personalization >= 6) strategy = "Personal";
  else if (score >= 50 && contactability >= 8) strategy = "Assisted";
  else if (score >= 32 && contactability >= 6) strategy = "Light";
  else strategy = "Manual Review";

  return { strategy, score, breakdown, reason: explainStrategy(strategy, breakdown, lead) };
}

function overrideReason(lead: Lead, input: StrategyInput): string {
  if (lead.businessStatus === "CLOSED_PERMANENTLY") return "Business appears permanently closed — do not contact.";
  if (input.optedOut) return "Contact opted out — suppressed from all outreach.";
  return "Contact is on the suppression list — do not contact.";
}

// Human-readable, per-strategy explanation. Jordan should never wonder why.
export function explainStrategy(strategy: AcquisitionStrategy, b: AcquisitionScoreBreakdown, lead: Lead): string {
  const drivers: string[] = [];
  if (b.opportunityValue >= 16) drivers.push("high potential project value");
  else if (b.opportunityValue <= 7) drivers.push("modest potential value");
  if (b.need >= 14) drivers.push("clear, visible modernization opportunities");
  else if (b.need <= 8) drivers.push("limited visible modernization need");
  if (b.contactability >= 12) drivers.push("reliable contact information");
  else if (b.contactability < 8) drivers.push("thin or uncertain contact routes");
  if (b.personalization >= 6) drivers.push("factors that justify a personal touch (value, multi-location, or a regulated category)");
  const driverText = drivers.length ? drivers.join(", ") : "a balanced mix of signals";

  const rating = `Its rating (${lead.rating ?? "n/a"}) is only one small input and did not by itself decide this.`;

  switch (strategy) {
    case "Personal":
      return `This business received Personal because it shows ${driverText}, and there is enough context to justify investing premium assets and a hands-on first contact. ${rating}`;
    case "Assisted":
      return `This business received Assisted because it is a credible opportunity with ${driverText} — worth a controlled, evidence-based sequence, but not yet a full custom package. ${rating}`;
    case "Light":
      return `This business received Light because it is credible but lower-potential (${driverText}). A concise, low-cost first touch fits; no paid assets are warranted yet. ${rating}`;
    case "Nurture":
      return `This business is set to Nurture — appropriate only where a consented or existing relationship supports staying useful over time rather than cold outreach.`;
    case "Manual Review":
      return `This business needs Manual Review because ${b.contactability < 4 ? "the contact route is unreliable or unclear" : "the system could not confidently choose a treatment"}. No contact happens until you review it.`;
    case "Do Not Contact":
      return overrideReason(lead, { suppressed: true });
  }
}
