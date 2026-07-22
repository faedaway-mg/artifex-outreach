// ─────────────────────────────────────────────────────────────────────────────
// The consulting read — judgment, not data.
//
// A calm co-pilot layer for the discovery conversation: the three things that
// actually matter, the single biggest unknown to validate early, a one-sentence
// meeting objective, and the one risk worth naming. It reduces cognitive load so
// Jordan can stay present and lead. Deterministic; grounded in the profile;
// voice-clean. It never presents an inference as a fact.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile, OpportunityCategory } from "../business-intelligence/types";
import { audienceNoun, tradeNoun, cleanObservation } from "./voice";

export interface ConsultingRead {
  /** Exactly three — judgment, prioritized. */
  threeThingsThatMatter: string[];
  biggestUnknown: string;
  meetingObjective: string;
  biggestRisk: string;
}

function singular(n: string): string {
  return n.endsWith("s") ? n.slice(0, -1) : n;
}

// Category → the judgment to hold about that kind of friction in the room.
const MATTER_BY_CATEGORY: Partial<Record<OpportunityCategory, (one: string, trade: string) => string>> = {
  Scheduling: (one) => `How a ${one} books looks central to the whole experience. Learn whether that's a deliberate choice or just how it evolved — before suggesting anything.`,
  Communication: (one) => `How they stay in touch with a ${one} after first contact matters here. Find out if it's intentional or simply a gap they've never had time to close.`,
  Automation: () => `A lot may still run by hand. Understand whether that's a values choice — the personal touch — or a genuine bottleneck, before calling it a problem.`,
  "Internal Workflow": () => `The day likely carries repeat work. Hear how the team feels about it before assuming it needs fixing.`,
  Operations: () => `The day-to-day is where the truth is. Listen for where it actually snags, not where you'd expect it to.`,
  "Customer Acquisition": (one) => `How a new ${one} first finds them is the pressure point. Hear their side of it before offering any view.`,
  "Brand Experience": (one) => `The first impression a ${one} forms online is doing quiet work. Ask how they think about it rather than assuming.`,
};

const OBJECTIVE_BY_CATEGORY: Partial<Record<OpportunityCategory, (one: string, name: string) => string>> = {
  Scheduling: (one, name) => `Understand why booking at ${name} currently works the way it does — from their side.`,
  Communication: (one) => `Learn how they actually keep a ${one} in the loop today, and whether they'd change it.`,
  Automation: (one, name) => `Learn what at ${name} they'd never want automated away — and what quietly drains the day.`,
  "Customer Acquisition": (one, name) => `Leave knowing how a new ${one} really experiences ${name} today.`,
};

export function buildConsultingRead(lead: Lead, profile: BusinessProfile): ConsultingRead {
  const audience = audienceNoun(lead.industry);
  const one = singular(audience);
  const trade = tradeNoun(lead.industry);
  const name = lead.businessName;
  const topOpp = profile.opportunities[0];
  const strongReputation = (lead.rating ?? 0) >= 4.5 && (lead.reviewCount ?? 0) >= 40;

  // ── Three things that matter (judgment, exactly 3, prioritized) ───────────
  const three: string[] = [];
  three.push(
    strongReputation
      ? `They've already earned real trust. Don't spend a minute convincing them they have problems — start from respect for what's working.`
      : `Lead with curiosity, not a critique. You're here to understand how it works, not to point at what's missing.`,
  );
  const middle = topOpp ? MATTER_BY_CATEGORY[topOpp.category]?.(one, trade) : undefined;
  three.push(middle ?? `The most useful thing you can do is understand how a new ${one} actually moves through this business today.`);
  three.push(`For a ${trade} of this size and reputation, personal relationships almost certainly matter more than any technology. Build trust before a single word about modernization.`);
  const threeThingsThatMatter = three.slice(0, 3);

  // ── Biggest unknown — the one thing to validate early ─────────────────────
  let biggestUnknown: string;
  if (!profile.presence.hasWebsite) {
    biggestUnknown = `We haven't confirmed whether not having a real website is a deliberate choice or simply historical — validate that before anything else.`;
  } else {
    const inferred = profile.opportunities.find((o) => o.confidence.label !== "Observed") ?? topOpp;
    biggestUnknown = inferred
      ? `We're inferring, not certain: whether "${cleanObservation(inferred)}" is intentional or just how things evolved. Confirm it early.`
      : `We don't yet know which of the small frictions we noticed actually costs them the most — that's the thing to find out first.`;
  }

  // ── Meeting objective — one sentence ──────────────────────────────────────
  const meetingObjective =
    (topOpp && OBJECTIVE_BY_CATEGORY[topOpp.category]?.(one, name)) || `Leave knowing how a new ${one} really experiences ${name} today.`;

  // ── Biggest risk — one calm warning, judgment not fear ────────────────────
  const opsHeavy = topOpp && ["Automation", "Operations", "Internal Workflow"].includes(topOpp.category);
  const biggestRisk = opsHeavy
    ? `Assuming technology is the bottleneck before you understand how the team and their relationships actually carry the work.`
    : `Talking about solutions before you truly understand their priorities. Stay in questions longer than feels comfortable.`;

  return { threeThingsThatMatter, biggestUnknown, meetingObjective, biggestRisk };
}
