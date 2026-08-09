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
import { audienceNoun, tradeNoun, addressName, topOpportunities, noticed, trimNoticed, uniqueNoticed, pick, estimateSpeakingSeconds } from "./voice";
import { scoreAuthenticity } from "./authenticity";

function singular(noun: string): string {
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// The business as it presents itself publicly — never the internal, industry-prefixed
// record name ("Los Angeles Dentist - Studio Smiles" → "Studio Smiles"). Uses the
// lead's own city + trade words to detect and strip a descriptor prefix; otherwise
// leaves the name untouched, so a genuinely hyphenated brand is never mangled.
function publicBusinessName(lead: Lead): string {
  const name = (lead.businessName || "").trim();
  const segs = name.split(/\s*[-–—|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return name;
  const descriptors = new Set<string>([
    ...(lead.city || "").toLowerCase().split(/\s+/).filter(Boolean),
    ...`${tradeNoun(lead.industry)} ${audienceNoun(lead.industry)}`.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    "dentist", "dental", "clinic", "practice", "hvac", "heating", "cooling", "plumbing", "plumber", "salon", "spa", "law", "clinic", "care",
  ]);
  const head = segs[0].toLowerCase().split(/\s+/).filter(Boolean);
  const hits = head.filter((w) => [...descriptors].some((d) => w.includes(d) || d.includes(w))).length;
  return head.length > 0 && hits / head.length >= 0.5 ? segs.slice(1).join(" - ") : name;
}

function greeting(lead: Lead, dm: DecisionMakerIntelligence): string {
  const name = dm.identified ? addressName(dm.primary?.name, lead.industry) : null;
  return name ? `Hi ${name},` : "Hi there,";
}

// ── Subject lines ────────────────────────────────────────────────────────────
// Grounded and conversational — the kind a real person types. Never clickbait.
export function buildSubjectLines(lead: Lead, profile: BusinessProfile): string[] {
  const name = publicBusinessName(lead);
  const templates = [
    `A quick question about ${name}`,
    `Was looking through ${name} earlier`,
    `One small thing I noticed`,
    `Something on your website`,
    `A note about ${name}`,
  ];
  // Deterministically rotate which line leads, keep the rest as alternatives.
  const lead0 = pick(templates, name, 1);
  const rest = templates.filter((t) => t !== lead0);
  return [lead0, ...rest].slice(0, 4);
}

// ── First-touch email ────────────────────────────────────────────────────────
export function buildOutreachEmail(lead: Lead, profile: BusinessProfile, dm: DecisionMakerIntelligence, settings: Settings, callHandoff?: string | null): OutreachEmail {
  const audience = audienceNoun(lead.industry);
  const subjects = buildSubjectLines(lead, profile);
  const name = publicBusinessName(lead);
  const one = singular(audience);
  const hasWebsite = profile.presence?.hasWebsite ?? Boolean(lead.websiteDomain);
  // Observations that aren't "you have no website" (that case is handled separately).
  const phrases = uniqueNoticed(topOpportunities(profile, 3).map((o) => trimNoticed(noticed(o, audience))))
    .filter((p) => !/\bno\b[^.]*\bwebsite\b|owned website/i.test(p));

  // The observation drives the email — the opener is chosen by what actually caught
  // attention (no website / strong reviews / something on the site), never a fixed
  // template. The opener must be true: never claim to have browsed a site that isn't there.
  const observation = phrases[0] ? lowerFirst(phrases[0]) : `how a new ${one} gets in touch after the first visit`;
  const strongReviews = (lead.rating ?? 0) >= 4.5 && (lead.reviewCount ?? 0) >= 40;
  const opener: string[] = !hasWebsite
    ? [`I came across ${name} earlier and went looking for your website.`, `I couldn't really find one, just a listing. Not sure if that's on purpose, but it's usually the first thing a new ${one} checks.`]
    : strongReviews
      ? [`I was reading through ${name}'s reviews earlier, and they're genuinely good.`, `One thing I wasn't sure about, though: ${observation}.`]
      : [`I was looking through ${name}'s website earlier and, honestly, most of it looked good.`, `One thing I wasn't sure about: ${observation}.`];

  // Always Jordan, always uncertain from the outside — the line that invites a reply.
  const identity = `I'm Jordan, I run Artifex Labs, a small studio here in LA. I could be wrong from the outside, so mostly I wanted to ask if that lines up with what you see.`;

  // Endings vary naturally — some offer, some just ask. Never forced toward one CTA.
  const endings = [
    `Happy to send over the couple of things I noticed if it's useful. No pressure either way.`,
    `I was curious if that's something you've run into too.`,
    `No pressure, I just thought I'd mention it.`,
    `If it's useful, I'm happy to show you what I found.`,
  ];
  const seededFirst = pick(endings, `${lead.id}:${name}`, 3);
  const candidateEndings = [seededFirst, ...endings.filter((e) => e !== seededFirst)];

  // Generate → evaluate → keep the most authentic. The seeded ending leads, so two
  // different businesses vary; the evaluator guards against anything that reads generated.
  const assemble = (end: string): OutreachEmail => {
    // When permission was earned on a call, open as a continuation of that conversation
    // and drop the cold-discovery first line (we didn't "come across" them — we spoke).
    const leadIn = callHandoff ? [callHandoff, ...opener.slice(1)] : opener;
    const paragraphs = [greeting(lead, dm), ...leadIn, identity, end];
    const body = [...paragraphs, complianceFooter(settings)].join("\n\n");
    return { subject: subjects[0], subjectAlternatives: subjects.slice(1), body, paragraphs, wordCount: body.split(/\s+/).filter(Boolean).length };
  };
  let best: OutreachEmail | null = null;
  let bestScore = -1;
  for (const end of candidateEndings) {
    const candidate = assemble(end);
    const s = scoreAuthenticity(candidate);
    if (s.pass && s.score > bestScore) { best = candidate; bestScore = s.score; }
  }
  return best ?? assemble(seededFirst);
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
  const name = publicBusinessName(lead);
  const subjects = [`Following up on ${name}`, `One more note`, `No rush`];
  // Pick the thread back up. If we've confirmed something they said, lead with it —
  // a continuing conversation, never "our system detected…".
  const continuity = memoryLines && memoryLines.length > 0
    ? `${memoryLines[0]} Didn't want to let that slip by.`
    : `I sent a note last week and figured it might've slipped past in a busy week.`;
  const paragraphs = [
    greeting(lead, dm),
    continuity,
    `If it's helpful I can send over what I found. If not, no worries at all.`,
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
  const one = singular(audience);
  const name = publicBusinessName(lead);
  const convo = openingConversation(profile.conversationInput, profile.presence);

  const opening = `Hi, I'm Jordan. I was looking through ${name}'s website and recorded a couple of quick thoughts.`;

  // Three distinct observations: real ones first, padded with grounded fallbacks.
  const real = uniqueNoticed(topOpportunities(profile, 5).map((o) => noticed(o, audience)));
  const fallbacks = [
    `I wasn't totally sure how a new ${one} takes the next step after landing on the site`,
    `I clicked around a little before I found how to get in touch`,
    `I wasn't sure how a ${one} gets back in touch after a first visit`,
  ];
  const three = uniqueNoticed([...real, ...fallbacks]).slice(0, 3);
  const observations = three.map((p) => `One thing: ${lowerFirst(p)}.`);

  const question = convo.question;
  const close = `I could be wrong on any of this. If it's useful, happy to talk. Either way, thanks for the minute.`;

  const emailVariant = `I recorded a quick video, about forty-five seconds, on a couple of things I noticed on ${name}'s site. No pitch. [video link]`;
  const phoneVariant = `I sent a short video earlier with a couple of thoughts on ${name}'s site. Did you get a chance to look?`;

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
