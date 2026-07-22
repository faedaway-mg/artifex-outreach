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
import { audienceNoun, tradeNoun, addressName, leadStrength, topOpportunities, noticed, uniqueNoticed, naturalList, pick, estimateSpeakingSeconds } from "./voice";

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

  const strength = leadStrength(profile);
  const phrases = uniqueNoticed(topOpportunities(profile, 3).map((o) => noticed(o, audience))).slice(0, 2);

  const openers = [
    `I spent about ten minutes experiencing your ${trade} the same way one of your ${audience} would — starting from a phone, the way most people do now.`,
    `I spent a little time going through ${lead.businessName} the way a new ${singular(audience)} would, before ever picking up the phone.`,
  ];
  const opener = pick(openers, lead.businessName, 7);

  const paras: string[] = [];
  paras.push(greeting(lead, dm));
  paras.push(`I'm Jordan with Artifex Labs. ${opener}`);

  if (strength) {
    paras.push(`First, the obvious: ${strength.charAt(0).toLowerCase() + strength.slice(1)}. That is not a small thing, and it is clearly earned.`);
  }

  if (phrases.length >= 2) {
    paras.push(
      `A couple of moments stood out where things get a little harder than they probably need to be — ${naturalList(phrases)}. Small things, but they sit right in the path a new ${singular(audience)} takes.`,
    );
  } else if (phrases.length === 1) {
    paras.push(
      `One moment stood out where things get a little harder than they probably need to be — ${phrases[0]}. A small thing, but it sits right in the path a new ${singular(audience)} takes.`,
    );
  } else {
    paras.push(
      `A couple of small moments stood out in how a new ${singular(audience)} first reaches you — the kind of thing that is easy to miss from the inside.`,
    );
  }

  paras.push(
    `I am not writing because I think you need a new website, or software, or anything in particular. Honestly, I might be wrong — public information only shows part of the picture. I am mostly curious whether what I noticed matches your experience.`,
  );
  const invite = settings.calendarLink
    ? ` If you'd like to talk it through, you're welcome to grab whatever time works best for you: ${settings.calendarLink}.`
    : "";
  paras.push(`If it is useful, would a short, low-pressure conversation be worth fifteen minutes?${invite} And if not, no hard feelings at all.`);
  paras.push(complianceFooter(settings));

  const body = paras.join("\n\n");
  return {
    subject: subjects[0],
    subjectAlternatives: subjects.slice(1),
    body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}

// ── Follow-up email — brief, human, respectful. Never "just checking in". ────
export function buildFollowUpEmail(lead: Lead, profile: BusinessProfile, dm: DecisionMakerIntelligence, settings: Settings): OutreachEmail {
  const subjects = [
    `Making sure this didn't get buried — ${lead.businessName}`,
    `One quick note for ${lead.businessName}`,
    `No pressure — ${lead.businessName}`,
  ];
  const invite = settings.calendarLink ? ` If they are, you can grab a time whenever suits you: ${settings.calendarLink}.` : "";
  const paras = [
    greeting(lead, dm),
    `I know how these weeks go — a note like mine is easy to miss. I just wanted to make sure it didn't get buried.`,
    `No pressure at all. If the couple of things I noticed aren't worth a conversation right now, I completely understand — I'll leave it there and won't send another.${invite}`,
    `Either way, thanks for the time you put into ${lead.businessName}.`,
    complianceFooter(settings),
  ];
  const body = paras.join("\n\n");
  return {
    subject: subjects[0],
    subjectAlternatives: subjects.slice(1),
    body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
}

// ── Personalized video script (for Jordan to record — never AI-generated) ────
export function buildVideoScript(lead: Lead, profile: BusinessProfile): VideoScript {
  const audience = audienceNoun(lead.industry);
  const trade = tradeNoun(lead.industry);
  const one = singular(audience);
  const convo = openingConversation(profile.conversationInput, profile.presence);

  const opening = `Hi — I'm Jordan with Artifex Labs. I spent about ten minutes going through ${lead.businessName} the way a brand-new ${one} would, and I recorded a few of the things I noticed.`;

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
