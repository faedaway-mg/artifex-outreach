// ─────────────────────────────────────────────────────────────────────────────
// EXPERIENCE FRAME — the ONE source of the "attempted use / observed friction"
// framing shared by the first-touch EMAIL opener, the OFFER PAGE hero, and the
// diagnostic PDF's opening section. "One evidence truth, many presentations": all
// three derive their opening claim from HERE, from the same canonical defect the
// subject line and offer are built on. Breakbot (attempted-use QA) enforces that
// every surface's opener matches this frame — so this module is the arbiter of
// what we are allowed to claim.
//
// TRUTH RULE (mandate: "Only use 'I tried X' if evidence supports an attempted
// action; otherwise use an honest observational frame"):
//   • booking / contact families imply a real functional action a visitor (and we,
//     during review) would attempt → attempted-use phrasing is allowed. The VERB is
//     chosen from the defect: a MISSING path → "…couldn't find a way…"; a BROKEN
//     path → "…it didn't go through." We never say "I tried to submit your form and
//     it failed" for a MISSING form (you can't submit a form that isn't there).
//   • readability / search / analytics / generic are DIAGNOSTIC observations, not
//     user-goal actions → attemptSupported = false, never "I tried", honest
//     observational opener instead.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { classifyDefectFamily, type SubjectFamily } from "./subject-engine";

/** Bump when the framing rules/phrasing change so surfaces + Breakbot stay aligned. */
export const EXPERIENCE_FRAME_VERSION = "experience.v1";

export interface ExperienceFrame {
  family: SubjectFamily;
  /** Plain operational topic label ("online booking"), for headings. */
  topic: string;
  /** True ONLY when the defect genuinely implies a functional action was attempted. */
  attemptSupported: boolean;
  /** The customer action ("book online", "send an inquiry") — null when observational. */
  attemptedAction: string | null;
  /** Whether the underlying defect is a BROKEN path (vs a MISSING one). */
  broken: boolean;
  /** Full first-touch EMAIL opening sentence (attempted-use OR honest observation). */
  emailOpener: string;
  /** Short OFFER hero title ("I tried to book online." / "Here's what we found."). */
  offerHeroTitle: string;
  /** OFFER hero sub-line ("Here's where I got stuck." / the plain friction). */
  offerHeroSubline: string;
  /** Short friction clause reused by the PDF §1 ("couldn't find a way to book"). */
  friction: string;
  version: string;
}

// Families where a functional attempt is genuinely implied by the defect class.
// `find` = phrasing when the path is MISSING; `broke` = phrasing when it's BROKEN.
const ACTION_FAMILIES: Partial<
  Record<SubjectFamily, { action: string; topic: string; findFriction: string; brokeFriction: string }>
> = {
  booking: {
    action: "book online",
    topic: "online booking",
    findFriction: "couldn't find a way to do it from the pages I checked",
    brokeFriction: "the booking step didn't work on the pages I checked",
  },
  mobile_booking: {
    action: "book from my phone",
    topic: "mobile booking",
    findFriction: "had trouble finding where to do it",
    brokeFriction: "the booking step was hard to use",
  },
  contact: {
    action: "send an inquiry through your website",
    topic: "website inquiry",
    findFriction: "couldn't find a form to submit",
    brokeFriction: "the form didn't go through",
  },
  mobile_contact: {
    action: "get in touch from my phone",
    topic: "mobile contact",
    findFriction: "had trouble finding how to do it",
    brokeFriction: "the contact step was hard to use",
  },
};

// Observational frames — no "I tried"; an honest description of what we saw.
const OBSERVATION_FAMILIES: Record<
  "readability" | "search" | "analytics" | "generic",
  { topic: string; friction: string; opener: string; heroSub: string }
> = {
  readability: {
    topic: "website readability",
    friction: "some text was hard to read",
    opener: "When I looked at your website, some of the text was hard to read on the pages I checked.",
    heroSub: "Some of the text was hard to read on the pages we checked.",
  },
  search: {
    topic: "search listing",
    friction: "the search description looked incomplete",
    opener:
      "When I looked at how your website shows up in search results, the information describing your pages looked incomplete.",
    heroSub: "The information describing your pages in search looked incomplete.",
  },
  analytics: {
    topic: "website tracking",
    friction: "visitor actions weren't being recorded",
    opener:
      "When I looked at your website, it didn't appear to be recording the visitor actions you'd probably want to see.",
    heroSub: "Your website didn't appear to be recording key visitor actions.",
  },
  generic: {
    topic: "website note",
    friction: "something worth a closer look",
    opener: "When I looked at your website, I found something on the pages I checked that's worth a closer look.",
    heroSub: "We found something on the pages we checked worth a closer look.",
  },
};

const BROKEN_SIGNAL =
  /\bfail(s|ed|ing)?\b|\berror\b|\bdoesn'?t (work|submit|go through|send)\b|\bnot (working|delivering|submitting|sending)\b|\bbroken\b|\breturns? an error\b|\bwon'?t (submit|send|work)\b/i;

function looksBroken(text: string): boolean {
  return BROKEN_SIGNAL.test(text);
}

/**
 * Derive the shared experience frame from the canonical defect text. Deterministic
 * and truthful: attempted-use phrasing only for action families, verb matched to
 * missing-vs-broken.
 */
export function experienceFrameFor(input: { observation: string; context?: string; category?: string }): ExperienceFrame {
  const family = classifyDefectFamily(input);
  const text = `${input.observation} ${input.context ?? ""}`;
  const broken = looksBroken(text);

  const action = ACTION_FAMILIES[family];
  if (action) {
    const friction = broken ? action.brokeFriction : action.findFriction;
    return {
      family,
      topic: action.topic,
      attemptSupported: true,
      attemptedAction: action.action,
      broken,
      emailOpener: `I tried to ${action.action} and ${friction}.`,
      offerHeroTitle: `I tried to ${action.action}.`,
      offerHeroSubline: "Here's where I got stuck.",
      friction,
      version: EXPERIENCE_FRAME_VERSION,
    };
  }

  const obs =
    OBSERVATION_FAMILIES[(family as "readability" | "search" | "analytics") ?? "generic"] ??
    OBSERVATION_FAMILIES.generic;
  return {
    family,
    topic: obs.topic,
    attemptSupported: false,
    attemptedAction: null,
    broken,
    emailOpener: obs.opener,
    offerHeroTitle: "Here's what we found on your website.",
    offerHeroSubline: obs.heroSub,
    friction: obs.friction,
    version: EXPERIENCE_FRAME_VERSION,
  };
}

/** Build the frame from an offer's canonical, evidence-graded problem statement. */
export function experienceFrameForOffer(offer: QuickFixOffer): ExperienceFrame {
  return experienceFrameFor({
    observation: offer.scope.problemBeingSolved,
    context: offer.scope.proposedSolution,
  });
}
