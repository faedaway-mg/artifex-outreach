// ─────────────────────────────────────────────────────────────────────────────
// Human outreach content: email, subject lines, and the personalized video script.
//
// Every line is one experienced consultant writing to another professional —
// curiosity, not selling. Technology is never named as the point. The reader
// should think "this person actually looked at my business."
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Settings } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import type { OutreachEmail, VideoScript, DecisionMakerIntelligence } from "./types";
import { complianceFooter } from "../communication-guide";
import { openingConversation } from "../conversation-engine";
import { audienceNoun, tradeNoun, addressName, humanStrength, topOpportunities, noticed, trimNoticed, uniqueNoticed, naturalList, pick, estimateSpeakingSeconds } from "./voice";

function singular(noun: string): string {
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}

function greeting(lead: Lead, dm: DecisionMakerIntelligence): string {
  const name = dm.identified ? addressName(dm.primary?.name, lead.industry) : null;
  return name ? `Hi ${name},` : "Hi there,";
}

// ── Subject lines ────────────────────────────────────────────────────────────
// Grounded and conversational — the kind a real person types. Never clickbait.
export function buildSubjectLines(lead: Lead, profile: BusinessProfile): string[] {
  const name = lead.businessName;
  const trade = tradeNoun(lead.industry);
  const audience = audienceNoun(lead.industry);
  const templates = [
    `A few observations about ${name}`,
    `A question after looking through your ${trade}`,
    `Something I noticed about your ${singular(audience)} experience`,
    `An outside look at ${name}`,
    `Thought this might be useful`,
  ];
  // Deterministically rotate which grounded line leads, keep the rest as alternatives.
  const lead0 = pick(templates, name, 1);
  const rest = templates.filter((t) => t !== lead0);
  return [lead0, ...rest].slice(0, 4);
}

// ── First-touch email ────────────────────────────────────────────────────────
export function buildOutreachEmail(lead: Lead, profile: BusinessProfile, dm: DecisionMakerIntelligence, settings: Settings): OutreachEmail {
  const trade = tradeNoun(lead.industry);
  const audience = audienceNoun(lead.industry);
  const subjects = buildSubjectLines(lead, profile);

  const one = singular(audience);
  const strength = humanStrength(lead.rating, lead.reviewCount, profile.strengths.length > 0, lead.businessName);
  const phrases = uniqueNoticed(topOpportunities(profile, 3).map((o) => trimNoticed(noticed(o, audience)))).slice(0, 2);

  const openers = [
    `I spent a little time looking at ${lead.businessName} the way a new ${one} would, and a couple of small things stood out.`,
    `I went through ${lead.businessName} the way a new ${one} might — before ever calling — and a few small things caught my eye.`,
  ];
  const opener = pick(openers, lead.businessName, 7);

  const paras: string[] = [];
  paras.push(greeting(lead, dm));
  paras.push(`I'm Jordan — I run Artifex Labs. ${opener}`);

  const lead2 = strength ? `${strength} — so this isn't a "you have a problem" note. ` : "";
  if (phrases.length >= 1) {
    paras.push(`${lead2}A few moments just felt harder than they probably need to be: ${naturalList(phrases)}. Little things, but they sit right where a new ${one} is deciding whether to reach out.`);
  } else {
    paras.push(`${lead2}A couple of small things in how a new ${one} first reaches you felt harder than they probably need to be — easy to miss from the inside.`);
  }

  paras.push(`I could be wrong — I'm only seeing part of the picture from outside. I mostly wanted to check whether it lines up with what you're seeing day to day.`);
  paras.push(`If it's useful, I'd genuinely enjoy a short conversation — no pressure either way.`);

  const paragraphs = [...paras];
  const body = [...paragraphs, complianceFooter(settings)].join("\n\n");
  return {
    subject: subjects[0],
    subjectAlternatives: subjects.slice(1),
    body,
    paragraphs,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}

// ── Follow-up email — brief, human, respectful. Never "just checking in". ────
export function buildFollowUpEmail(
  lead: Lead,
  profile: BusinessProfile,
  dm: DecisionMakerIntelligence,
  settings: Settings,
  /** Voice-clean, memory-grounded openers ("You mentioned…") from confirmed Relationship Memory. */
  memoryLines?: string[],
): OutreachEmail {
  const subjects = [
    `Making sure this didn't get buried — ${lead.businessName}`,
    `One quick note for ${lead.businessName}`,
    `No pressure — ${lead.businessName}`,
  ];
  // If we've actually learned something and confirmed it, pick that thread back up —
  // a continuing relationship, never "our system detected…".
  const continuity = memoryLines && memoryLines.length > 0
    ? `${memoryLines[0]} I didn't want to let that thread go cold.`
    : `I sent a short note last week and wanted to make sure it didn't get buried — I know how full a week gets.`;
  const paragraphs = [
    greeting(lead, dm),
    continuity,
    `No pressure at all. If it's not the right time, I completely understand and won't keep knocking.`,
    `Either way, I appreciate what you're building at ${lead.businessName}.`,
  ];
  const body = [...paragraphs, complianceFooter(settings)].join("\n\n");
  return {
    subject: subjects[0],
    subjectAlternatives: subjects.slice(1),
    body,
    paragraphs,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}

// ── Personalized video script (for Jordan to record — never AI-generated) ────
export function buildVideoScript(lead: Lead, profile: BusinessProfile): VideoScript {
  const audience = audienceNoun(lead.industry);
  const trade = tradeNoun(lead.industry);
  const one = singular(audience);
  const convo = openingConversation(profile.conversationInput, profile.presence);

  const opening = `Hi — my name's Jordan, I run Artifex Labs. I spent a little time going through ${lead.businessName} the way a brand-new ${one} would, and recorded a few of the things that stood out.`;

  // Three distinct observations: real ones first, padded with grounded fallbacks.
  const real = uniqueNoticed(topOpportunities(profile, 5).map((o) => noticed(o, audience)));
  const fallbacks = [
    `the very first step a new ${one} takes is a little harder than the rest of your ${trade}`,
    `how someone reaches you for the first time isn't quite as effortless as it could be`,
    `a couple of small moments where a ${one} has to work to take the next step`,
  ];
  const three = uniqueNoticed([...real, ...fallbacks]).slice(0, 3);
  const observations = three.map((p) => `Here's one: ${p}.`);

  const question = convo.question;
  const close = `I want to be clear — I'm not selling anything in this video. I'm just genuinely curious whether these match what you see day to day. If they do, I'd love a short conversation. Either way, thanks for the time.`;

  const emailVariant = `I recorded a short video — about forty-five seconds — walking through a couple of things I noticed while going through ${lead.businessName}. No pitch, just observations. [video link]`;
  const phoneVariant = `I sent over a short video earlier with a couple of observations about ${lead.businessName} — did you get a chance to look at it?`;

  const script = [opening, ...observations, question, close].join("\n\n");
  return {
    opening,
    observations: observations.slice(0, 3),
    question,
    close,
    emailVariant,
    phoneVariant,
    estimatedSeconds: Math.max(30, Math.min(60, estimateSpeakingSeconds(script))),
    script,
  };
}

export { singular };
