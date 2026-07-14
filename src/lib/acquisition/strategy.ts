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

  return { strategy, score, breakdown, reason: buildReason(strategy, breakdown, lead) };
}

function overrideReason(lead: Lead, input: StrategyInput): string {
  if (lead.businessStatus === "CLOSED_PERMANENTLY") return "Business appears permanently closed — do not contact.";
  if (input.optedOut) return "Contact opted out — suppressed from all outreach.";
  return "Contact is on the suppression list — do not contact.";
}

function buildReason(strategy: AcquisitionStrategy, b: AcquisitionScoreBreakdown, lead: Lead): string {
  const parts: string[] = [`Recommended treatment: ${strategy}.`];
  if (b.opportunityValue >= 16) parts.push("High potential project value.");
  else if (b.opportunityValue <= 7) parts.push("Modest potential value.");
  if (b.need >= 14) parts.push("Clear, visible modernization need.");
  if (b.contactability >= 12) parts.push("Strong contactability.");
  else if (b.contactability < 8) parts.push("Limited contact routes.");
  if (b.personalization >= 6) parts.push("Warrants personal handling (value/regulated/multi-location).");
  parts.push(`Rating (${lead.rating ?? "n/a"}) is only one small input and did not by itself set this treatment.`);
  return parts.join(" ");
}
