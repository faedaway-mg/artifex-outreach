// ─────────────────────────────────────────────────────────────────────────────
// Decision-Maker Intelligence.
//
// We identify who actually decides — Owner, Practice Owner, Office Manager, etc.
// only from real, public data (Contact records + the lead's public routes). We
// NEVER invent a person. When we can't be confident, we say so plainly.
//
// Live public-source enrichment (corporate registries, LinkedIn, licensing
// boards) plugs in behind `EnrichmentSource`; until a source is wired, inference
// is limited to what is already known, and low-confidence stays low.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Contact, Confidence } from "../types";
import type { DecisionMaker, DecisionMakerIntelligence, DecisionMakerRole, ContactChannel } from "./types";

const CONFIDENCE_SCORE: Record<Confidence, number> = { Verified: 90, Likely: 60, Unknown: 25 };

// Recognized authority, best-first. "Contact" means a real person of unclear authority.
const ROLE_WEIGHT: Record<DecisionMakerRole, number> = {
  Owner: 100,
  Founder: 98,
  "Practice Owner": 96,
  "Managing Partner": 94,
  "Executive Director": 88,
  "General Manager": 80,
  "Operations Manager": 74,
  "Practice Administrator": 70,
  "Office Manager": 66,
  Contact: 30,
};

/** Interface for a future public-source enrichment provider. Not yet wired. */
export interface EnrichmentSource {
  /** Returns real, publicly-sourced candidates — or [] when nothing is confidently found. */
  find(lead: Lead): Promise<Array<Partial<DecisionMaker> & { name: string; source: string }>>;
}

function classifyRole(title: string): DecisionMakerRole {
  const t = (title || "").toLowerCase();
  if (/practice owner/.test(t)) return "Practice Owner";
  if (/managing partner|manag.*partner/.test(t)) return "Managing Partner";
  if (/founder|principal/.test(t)) return "Founder";
  if (/\bowner\b|proprietor/.test(t)) return "Owner";
  if (/executive director|\bed\b/.test(t)) return "Executive Director";
  if (/general manager|\bgm\b/.test(t)) return "General Manager";
  if (/practice admin/.test(t)) return "Practice Administrator";
  if (/operations|ops manager|\bcoo\b/.test(t)) return "Operations Manager";
  if (/office manager/.test(t)) return "Office Manager";
  return "Contact";
}

function looksPersonal(email: string | null): boolean {
  if (!email) return false;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  // Role inboxes are office, not personal.
  return !/^(info|hello|contact|admin|office|team|support|sales|booking|appointments|frontdesk|reception|help|hi)$/.test(local);
}

function preferredOrder(dm: {
  directEmail: string | null;
  officeEmail: string | null;
  linkedinUrl: string | null;
  officePhone: string | null;
  contactForm: string | null;
}): ContactChannel[] {
  const order: ContactChannel[] = [];
  if (dm.directEmail) order.push("direct-email");
  if (dm.officeEmail) order.push("office-email");
  if (dm.linkedinUrl) order.push("linkedin");
  if (dm.officePhone) order.push("office-phone");
  if (dm.contactForm) order.push("contact-form");
  return order;
}

function contactToDecisionMaker(c: Contact, lead: Lead): DecisionMaker {
  const role = classifyRole(c.title);
  const directEmail = looksPersonal(c.email) ? c.email : null;
  const officeEmail = !directEmail ? c.email ?? lead.publicEmail ?? null : lead.publicEmail ?? null;
  const linkedinUrl = c.linkedinUrl ?? null;
  const officePhone = c.phone ?? lead.phone ?? null;
  const contactForm = lead.contactFormUrl ?? null;
  return {
    name: c.name,
    role,
    roleConfidence: c.confidence,
    source: c.source || "Contact record",
    officeEmail,
    directEmail,
    linkedinUrl,
    officePhone,
    preferredContactOrder: preferredOrder({ directEmail, officeEmail, linkedinUrl, officePhone, contactForm }),
  };
}

function candidateScore(dm: DecisionMaker): number {
  const conf = CONFIDENCE_SCORE[dm.roleConfidence];
  const weight = ROLE_WEIGHT[dm.role];
  const reachable = dm.directEmail || dm.officeEmail || dm.linkedinUrl || dm.officePhone ? 12 : 0;
  // Authority and confidence both matter; reachability breaks ties.
  return Math.round(weight * 0.5 + conf * 0.5 + reachable);
}

/**
 * Identify decision-makers from what is genuinely known. `enriched` may carry
 * publicly-sourced candidates from a wired EnrichmentSource; without one, this
 * uses Contact records only and stays honest about low confidence.
 */
export function inferDecisionMakers(
  lead: Lead,
  contacts: Contact[],
  enriched: DecisionMaker[] = [],
): DecisionMakerIntelligence {
  const fromContacts = (contacts || []).filter((c) => !c.optedOut && c.name?.trim()).map((c) => contactToDecisionMaker(c, lead));
  const candidates = [...fromContacts, ...enriched].sort((a, b) => candidateScore(b) - candidateScore(a));

  const primary = candidates[0] ?? null;

  // "Identified" requires a real name, a recognized role, and non-Unknown confidence.
  const identified =
    !!primary && !!primary.name && primary.role !== "Contact" && primary.roleConfidence !== "Unknown";

  let confidence = 0;
  if (primary) confidence = Math.min(100, candidateScore(primary));
  if (!identified) confidence = Math.min(confidence, 45); // never overstate an uncertain pick

  const note = identified
    ? `${primary!.role} identified${primary!.name ? ` (${primary!.name})` : ""} — ${primary!.roleConfidence.toLowerCase()} confidence, via ${primary!.source}.`
    : candidates.length > 0
      ? "A contact exists, but the true decision maker could not be confidently identified. Confirm on the first call."
      : "Decision maker could not be confidently identified. Use the receptionist call to find who'd want to see it.";

  return { identified, primary, candidates, confidence, note };
}
