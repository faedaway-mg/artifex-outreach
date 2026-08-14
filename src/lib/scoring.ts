// ─────────────────────────────────────────────────────────────────────────────
// Deterministic lead scoring. Transparent rules, always with a breakdown.
// The AI layer may *explain* a score but never invents the number.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, ScoreBreakdown, Tier } from "./types";
import { receptivityPoints } from "./geo-market";

// Industry fit for Artifex Labs' positioning (0–1 multipliers).
const INDUSTRY_FIT: Record<string, number> = {
  "Dental practice": 0.95,
  "Law firm": 0.9,
  "Home-service company": 0.85,
  "Fitness studio": 0.7,
  "Professional consultant": 0.75,
  "Specialty retailer": 0.8,
  "Financial services": 0.2,
};

const AUTOMATION_FIT: Record<string, number> = {
  "Home-service company": 0.95,
  "Law firm": 0.9,
  "Dental practice": 0.8,
  "Professional consultant": 0.7,
  "Specialty retailer": 0.65,
  "Fitness studio": 0.6,
  "Financial services": 0.3,
};

export interface WebsiteSignals {
  hasWebsite: boolean;
  mobileFriendly: boolean;
  slowLoad: boolean;
  hasOnlineBooking: boolean;
  hasLeadForm: boolean;
}

export interface ScoreResult {
  breakdown: ScoreBreakdown;
  total: number;
  tier: Tier;
  rationale: string;
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function computeScore(lead: Lead, signals?: WebsiteSignals): ScoreResult {
  const industryFit = INDUSTRY_FIT[lead.industry] ?? 0.6;
  const automationFit = AUTOMATION_FIT[lead.industry] ?? 0.55;
  const rating = lead.rating ?? 0;
  const reviews = lead.reviewCount ?? 0;

  // Business fit — mostly industry alignment.
  const businessFit = clamp(industryFit * 20, 20);

  // Website opportunity — no site is maximum opportunity; a weak site is high.
  let websiteOpportunity: number;
  if (!lead.website && !signals?.hasWebsite) {
    websiteOpportunity = 20;
  } else if (signals) {
    let s = 6;
    if (!signals.mobileFriendly) s += 6;
    if (signals.slowLoad) s += 4;
    if (!signals.hasOnlineBooking) s += 2;
    if (!signals.hasLeadForm) s += 2;
    websiteOpportunity = clamp(s, 20);
  } else {
    websiteOpportunity = 12; // has a site, not yet analyzed
  }

  // Automation opportunity — industry-driven until analysis refines it.
  const automationOpportunity = clamp(automationFit * 20, 20);

  // Ability to pay — established (many reviews) + fit as a proxy.
  const reviewSignal = Math.min(1, reviews / 200);
  const abilityToPay = clamp((0.5 * reviewSignal + 0.5 * industryFit) * 15, 15);

  // Public reputation — rating driven.
  const publicReputation = clamp((rating / 5) * 10, 10);

  // Contactability — phone + email + form.
  let contact = 0;
  if (lead.phone) contact += 4;
  if (lead.publicEmail) contact += 4;
  if (lead.contactFormUrl) contact += 2;
  const contactability = clamp(contact, 10);

  // Trigger / urgency — light signal (recent low-rating churn, growth, etc.).
  const triggerUrgency = clamp(rating >= 4.5 && reviews > 150 ? 4 : 2, 5);

  const breakdown: ScoreBreakdown = {
    businessFit,
    websiteOpportunity,
    automationOpportunity,
    abilityToPay,
    publicReputation,
    contactability,
    triggerUrgency,
  };
  // Market receptivity — a SMALL capped tie-breaker (max 4) that modestly favors an ESTABLISHED
  // business in a less-saturated regional market. It can nudge a borderline lead but never
  // override fundamentals, and is 0 for tiny businesses and for high-saturation primary metros.
  const marketReceptivity = receptivityPoints(lead);

  const total =
    businessFit +
    websiteOpportunity +
    automationOpportunity +
    abilityToPay +
    publicReputation +
    contactability +
    triggerUrgency +
    marketReceptivity;

  const tier: Tier = total >= 70 ? "A" : total >= 45 ? "B" : "C";

  const rationale = buildRationale(lead, breakdown, tier);
  return { breakdown, total, tier, rationale };
}

function buildRationale(lead: Lead, b: ScoreBreakdown, tier: Tier): string {
  const parts: string[] = [];
  parts.push(
    `${lead.businessName} scores ${tier === "A" ? "highly" : tier === "B" ? "moderately" : "low"} overall (Tier ${tier}).`,
  );
  if (b.businessFit >= 16) parts.push("Its industry aligns well with Artifex Labs' services.");
  if (b.websiteOpportunity >= 14) parts.push("There is clear website modernization opportunity.");
  if (b.publicReputation >= 8) parts.push("Its public reputation is strong, signaling an established, credible business.");
  if (b.contactability <= 4) parts.push("Contact information is thin, which lowers reachability.");
  if (b.abilityToPay <= 8) parts.push("Ability-to-pay signals are modest.");
  return parts.join(" ");
}

export function tierFromScore(total: number): Tier {
  return total >= 70 ? "A" : total >= 45 ? "B" : "C";
}
