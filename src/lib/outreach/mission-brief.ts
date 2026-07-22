// ─────────────────────────────────────────────────────────────────────────────
// The Discovery Mission Brief.
//
// A one-page briefing prepared like a thoughtful chief of staff would: who this
// business is, why the conversation matters, how to open, what to ask, what NOT
// to assume, likely priorities (only where the evidence supports them), and what
// would make the meeting a success. Deterministic; grounded in the profile.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Settings, Contact } from "../types";
import type { BusinessProfile, OpportunityCategory } from "../business-intelligence/types";
import { buildOutreachKit } from "./kit";
import { audienceNoun, tradeNoun, addressName, cleanObservation } from "./voice";

export interface LikelyPriority {
  label: string;
  /** 0..100, only surfaced when observations support it. */
  confidence: number;
  basis: string;
}
export interface MissionBrief {
  executiveSummary: string;
  meetingGoal: string;
  recommendedOpening: string;
  firstQuestions: string[];
  assumptionsToAvoid: string[];
  likelyPriorities: LikelyPriority[];
  successCriteria: string;
}

const PRIORITY_FROM_CATEGORY: Record<OpportunityCategory, string> = {
  "Customer Acquisition": "Growth — reaching more of the right customers",
  "Customer Retention": "Retention — keeping customers coming back",
  Scheduling: "Scheduling & booking",
  Communication: "Customer communication & follow-up",
  Automation: "Automating manual, repetitive work",
  Reporting: "Visibility into what's working",
  Operations: "Smoothing day-to-day operations",
  "Brand Experience": "First impression & online presence",
  Analytics: "Understanding what drives new business",
  "Internal Workflow": "Reducing repeat work for the team",
};

function singular(n: string): string {
  return n.endsWith("s") ? n.slice(0, -1) : n;
}

export function buildMissionBrief(input: { lead: Lead; profile: BusinessProfile; settings: Settings; contacts?: Contact[]; meetingAt?: string | null }): MissionBrief {
  const { lead, profile, settings, contacts = [], meetingAt } = input;
  const kit = buildOutreachKit({ lead, profile, settings, contacts });
  const audience = audienceNoun(lead.industry);
  const one = singular(audience);
  const trade = tradeNoun(lead.industry);
  const where = [lead.city, lead.state].filter(Boolean).join(", ");
  const dmName = kit.decisionMaker.identified ? addressName(kit.decisionMaker.primary?.name, lead.industry) : null;

  const topOpp = profile.opportunities[0];

  // ── Executive summary — one grounded paragraph ────────────────────────────
  const executiveSummary =
    `${lead.businessName} is a ${trade}${where ? ` in ${where}` : ""} that has clearly earned real trust with its ${audience}. ` +
    `We reached out because a few small moments in how a new ${one} first reaches them looked harder than they probably need to be` +
    `${topOpp ? ` — most notably ${cleanObservation(topOpp).toLowerCase()}` : ""}. ` +
    `This conversation is about understanding how it actually works from the inside, not pitching anything.`;

  // ── Meeting goal — never "sell" ────────────────────────────────────────────
  const meetingGoal =
    `Learn how new ${audience} actually find, choose, and reach ${lead.businessName} today — and which of the small friction points we noticed genuinely matters to ${dmName ?? "them"}. ` +
    `Success is understanding and trust, not a commitment.`;

  // ── Recommended opening — a starter, not a script ─────────────────────────
  const recommendedOpening =
    `${dmName ? `Thanks for making the time, ${dmName}. ` : "Thanks for making the time. "}` +
    `Before I say anything about what I noticed — I'd genuinely like to hear, in your words, what a great first experience looks like for a new ${one} with ${lead.businessName}.`;

  // ── First five questions that build on each other ─────────────────────────
  const firstQuestions = kit.discovery.questions.map((q) => q.question).slice(0, 5);
  while (firstQuestions.length < 5) {
    const extras = [
      `When something does go wrong for a new ${one}, how do you usually hear about it?`,
      `If you could wave a wand and fix one part of the day, what would it be?`,
      `Who else would need to be part of a decision to change how any of this works?`,
    ];
    const next = extras[firstQuestions.length % extras.length];
    if (!firstQuestions.includes(next)) firstQuestions.push(next);
    else break;
  }

  // ── Assumptions to avoid — say what we DON'T know ─────────────────────────
  const assumptionsToAvoid: string[] = [
    "Everything here is inferred from public information only — we have not seen their internal tools, numbers, or day-to-day. Confirm, don't assume.",
  ];
  const inferSeen = new Set<string>();
  for (const o of profile.opportunities.slice(0, 3)) {
    if (o.confidence.label !== "Observed") {
      const c = cleanObservation(o);
      if (inferSeen.has(c.toLowerCase())) continue;
      inferSeen.add(c.toLowerCase());
      assumptionsToAvoid.push(`We're inferring "${c}" (${o.confidence.label.toLowerCase()} confidence) — ask before treating it as fact.`);
    }
  }
  if (!kit.decisionMaker.identified) {
    assumptionsToAvoid.push("We're not certain who actually owns this decision — confirm early who else should be in the room.");
  }
  if (assumptionsToAvoid.length === 1) {
    assumptionsToAvoid.push("Don't assume the friction we noticed is news to them — they may already handle it well.");
  }

  // ── Likely priorities — only where observations support them ──────────────
  const seen = new Set<string>();
  const likelyPriorities: LikelyPriority[] = [];
  for (const o of profile.opportunities.slice(0, 5)) {
    const label = PRIORITY_FROM_CATEGORY[o.category] ?? o.category;
    if (seen.has(label)) continue;
    seen.add(label);
    likelyPriorities.push({
      label,
      confidence: Math.round(o.confidence.score * 100),
      basis: cleanObservation(o),
    });
  }

  // ── Success criteria ───────────────────────────────────────────────────────
  const primary = topOpp ? PRIORITY_FROM_CATEGORY[topOpp.category].toLowerCase() : "how new customers reach them";
  const successCriteria =
    `If we leave today knowing how a new ${one} actually experiences ${lead.businessName} today — and whether ${primary} is genuinely worth their attention right now — then this conversation was a success.`;

  return { executiveSummary, meetingGoal, recommendedOpening, firstQuestions, assumptionsToAvoid, likelyPriorities, successCriteria };
}
