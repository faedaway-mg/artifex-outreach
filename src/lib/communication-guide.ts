// ─────────────────────────────────────────────────────────────────────────────
// THE COMMUNICATION GUIDE — in-repo projection of the approved brand document.
//
// SINGLE SOURCE OF TRUTH for every outbound communication the Acquisition OS
// generates. This module is the machine-readable projection of the approved:
//
//     ~/artifex-labs/docs/ARTIFEX_COMMUNICATION_GUIDE.md   (v1.0, 2026-07-16)
//
// which is itself subordinate to the apex brand constitution:
//
//     ~/artifex-labs/docs/ARTIFEX_BRAND_ARCHITECTURE.md    (§3 canonical language)
//
// RULES OF THIS FILE (so there is exactly one source of truth):
//   1. The OS never invents wording. Every fixed phrase below is transcribed from
//      the guide; only [bracketed] context (a lead's specific friction, a date) is
//      filled at assembly time — exactly as the guide's §6 templates prescribe.
//   2. No other module may hold its own message copy. Generators (sequences.ts,
//      followups.ts, lifecycle emails) import from here and assemble.
//   3. If the guide changes, update THIS file only; every generator inherits it.
//   4. A message that emits a raw "[bracket]" is a failure (guide §6). Every
//      template provides a graceful fallback so a missing field never leaks.
//
// Voice, in one line (guide §5.1): the calm, precise voice of a master craftsman
// who has nothing to prove. Plain over clever, restraint over volume, specific
// over sweeping, honest over eager. No exclamation marks. One idea per message.
// ─────────────────────────────────────────────────────────────────────────────
import type { Settings } from "./types";

/** Provenance of this projection — surfaced in tests and the operator UI. */
export const COMMUNICATION_GUIDE_SOURCE = {
  document: "ARTIFEX_COMMUNICATION_GUIDE.md",
  apex: "ARTIFEX_BRAND_ARCHITECTURE.md",
  version: "1.0",
  approved: "2026-07-16",
} as const;

// ── Banned phrases (guide §3.2 comms clichés + §8 anti-patterns) ─────────────
// Enforced by tests across every generated template. If any appears in output,
// the message is not Artifex. Deprecated fee words (price/cost/quote for our
// investment) are handled by CANONICAL_TERMS, not here, because "the cost of
// friction to the business" is an on-brand idea we deliberately keep.
export const BANNED_PHRASES: readonly string[] = [
  "just checking in",
  "just circling back",
  "circling back",
  "touching base",
  "hop on a quick call",
  "hop on a call",
  "pick your brain",
  "i wanted to reach out",
  "as per my last email",
  "per my last email",
  "reaching out because",
  "quick question", // when it isn't one — banned as an opener crutch
  "spots are limited",
  "before end of month",
  "before the end of the month",
  "act now",
  "limited time",
  "revolutionary",
  "cutting-edge",
  "game-changer",
  "game-changing",
  "synergy",
  "synergies",
  "seamless",
  "unlock",
  "unleash",
  "supercharge",
  "next-level",
  "best-in-class",
  "world-class",
  "take your business to the next level",
  "in today's fast-paced world",
  "now more than ever",
  "we're passionate about",
  "we are passionate about",
] as const;

// ── Canonical terminology (Brand Architecture §3; guide §3.2) ────────────────
// preferred → the word we use; avoid → deprecated variants we correct on sight.
export const CANONICAL_TERMS: ReadonlyArray<{ preferred: string; avoid: readonly string[]; note: string }> = [
  { preferred: "investment", avoid: ["price", "cost of the work", "quote", "our fee", "the deal"], note: "What the client pays. (The cost of friction to their business is a separate, kept idea.)" },
  { preferred: "a conversation", avoid: ["sales call", "discovery call", "demo", "jump on a call"], note: "First meeting is a conversation." },
  { preferred: "an opportunity", avoid: ["a problem", "a gap"], note: "We frame forward." },
  { preferred: "friction", avoid: ["pain points", "inefficiencies"], note: "Ownable to the brand." },
  { preferred: "Technology Maturity", avoid: ["tech debt", "backwardness"], note: "A benchmark to move, not a grade." },
  { preferred: "Business Evolution", avoid: ["digital transformation"], note: "Evolution over a one-leap transformation." },
  { preferred: "the Business Technology Review", avoid: ["audit", "assessment"], note: "Named offering, Title Case." },
  { preferred: "the Business Evolution Plan", avoid: ["proposal (as a one-off sale)", "SOW", "quote"], note: "The roadmap; it is our proposal, never called one." },
  { preferred: "partner / partnership", avoid: ["vendor", "account"], note: "We think in relationships." },
] as const;

// ── Snippet library (guide §7) — reusable, on-brand fragments ────────────────
export const SNIPPETS = {
  /** Openers — about them, never us (guide §3.6, §7). */
  openers: [
    "Most [industry] businesses your size hit the same wall around [area].",
    "Following the map we drew last week —",
    "[Referrer] mentioned you're wrestling with [friction].",
    "No agenda — I was thinking about [company] and wanted to share one thing.",
  ],
  /** Reassurances — the quiet, load-bearing lines (guide §7, §15). */
  reassurances: [
    "A diagnosis before a prescription, always.",
    "It's yours to keep, build with us or not.",
    "If it's not the season, tell me and I'll step back — no follow-up loop.",
    "We build in priority order — one deliberate step at a time.",
    "Everything we build is documented, transferable, and yours.",
    "I'd rather over-explain now than have you say yes with a doubt.",
    "We'll tell you when the answer isn't technology.",
  ],
  /** CTAs — invitations, one per message (guide §3.8). */
  ctas: [
    "Worth a short conversation?",
    "Shall I hold a time this week?",
    "Want me to send the Review overview?",
    "Reply with a sentence about where it's heaviest, and I'll take it from there.",
  ],
  /** Closings — end on weight (guide §3.7). */
  closings: [
    "The friction won't name itself — but it's easy to start.",
    "Either way, glad to be watching the whole board with you.",
    "Let's build.",
    "Talk soon.",
  ],
} as const;

/**
 * Identity line for a first touch (guide §6.1). Plain, partner-not-vendor.
 * Kept here so no generator re-writes who we are.
 */
export const IDENTITY_LINE =
  "I'm Jordan — I run Artifex Labs, a business technology partner. We help businesses find where they lose time to friction, decide what's worth fixing first, and build the systems that remove it.";

/** Named offerings (Title Case — Brand Architecture §3). */
export const OFFERINGS = {
  review: "Business Technology Review",
  plan: "Business Evolution Plan",
} as const;

// ── Assembled message ────────────────────────────────────────────────────────
export interface Msg {
  subject: string;
  body: string;
}

/**
 * Context an assembled message draws from. Every field is optional; each template
 * degrades to guide-approved general phrasing rather than leaking a raw bracket.
 */
export interface CommsContext {
  firstName?: string | null;
  businessName?: string | null;
  /** The specific friction, named plainly (guide's central [bracket]). */
  friction?: string | null;
  /** A specific, honest observation about the business (from intelligence). */
  observation?: string | null;
  referrer?: string | null;
  day?: string | null;
  time?: string | null;
  timezone?: string | null;
  link?: string | null;
  duration?: string | null;
  milestone?: string | null;
  cadence?: string | null;
  systemName?: string | null;
  outcome?: string | null;
  /** Investment — never "price"/"cost" (canonical). */
  investment?: string | null;
  timeline?: string | null;
  scope?: string | null;
  period?: string | null;
  nextPriority?: string | null;
}

// Graceful fallbacks so a template never emits an unfilled bracket.
const who = (c: CommsContext) => (c.firstName?.trim() ? c.firstName.trim() : "there");
const biz = (c: CommsContext) => (c.businessName?.trim() ? c.businessName.trim() : "your business");
const theSystem = (c: CommsContext) => (c.systemName?.trim() ? c.systemName.trim() : "the system we built");
const frictionOr = (c: CommsContext, fallback: string) => (c.friction?.trim() ? c.friction.trim() : fallback);

/** Plain human signature (guide §3.3) — relationship & transactional messages. */
export function signatureBlock(settings: Settings): string {
  return `\n\n— ${settings.signature}`;
}

/**
 * Compliance footer for cold/warm OUTREACH email (guide §3.3 + legal): plain
 * signature, postal address, and an opt-out. Carries the {{unsubscribe}} token
 * the compliance gate requires. Relationship messages use signatureBlock instead.
 */
export function complianceFooter(settings: Settings): string {
  return `\n\n${settings.signature}\n\n${settings.businessAddress}\nNot useful? {{unsubscribe}} and I won't follow up.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE TEMPLATES — one per guide §6 stage. Each returns approved copy with
// context filled. Fixed wording is transcribed from the guide; only [brackets]
// vary. These are the ONLY place message copy lives.
// ─────────────────────────────────────────────────────────────────────────────

/** §6.1 Cold outreach — observation first, ask is a reply. */
export function coldOutreach(c: CommsContext): Msg {
  const hook = frictionOr(c, "everything routes through one person, and their day becomes the bottleneck for everyone else's");
  const obs = c.observation?.trim() ? ` ${c.observation.trim()}` : "";
  return {
    subject: `the friction at ${biz(c)}`,
    body:
      `Hi ${who(c)},\n\n` +
      `Most businesses your size seem to hit the same wall: ${hook}. It's rarely urgent enough to fix, which is exactly why it quietly costs the most.${obs}\n\n` +
      `${IDENTITY_LINE}\n\n` +
      `No pitch here — just a question: is that something you've had to work around at ${biz(c)}?\n\n` +
      `If it's worth a short conversation, I'll bring what we've seen work. If it's not the season, tell me and I'll step back.`,
  };
}

/** §6.2 Warm outreach — open on the shared thread. */
export function warmOutreach(c: CommsContext): Msg {
  const ref = c.referrer?.trim() ? c.referrer.trim() : "A mutual contact";
  const hook = frictionOr(c, "the same knot we've helped others untangle");
  return {
    subject: `${ref} thought we should talk`,
    body:
      `Hi ${who(c)},\n\n` +
      `${ref} mentioned you're dealing with ${hook}. They thought it was worth an introduction, and I trust their read.\n\n` +
      `The short version of how we work: we start by finding where a business actually loses time and money, rank what's worth fixing, and build only what earns its place. No big-bang projects — one deliberate step at a time.\n\n` +
      `Would a short conversation be useful? Happy to just answer questions first — no expectation beyond that.`,
  };
}

/** §6.3 LinkedIn connection — relationship, no ask, no calendar link. */
export function linkedinConnect(c: CommsContext): Msg {
  return {
    subject: "",
    body:
      `Hi ${who(c)} — I lead Artifex, a business technology partner. I keep seeing teams carry the same avoidable friction around [area], and your work at ${biz(c)} caught my eye. No pitch — would be glad to be connected.`
        .replace("[area]", c.friction?.trim() ? c.friction.trim() : "how the work moves"),
  };
}

/** §6.5 Business Technology Review invitation. */
export function reviewInvitation(c: CommsContext): Msg {
  const basis = c.friction?.trim() ? c.friction.trim() : "what you shared";
  const dur = c.duration?.trim() ? c.duration.trim() : "about 45 minutes";
  return {
    subject: `a Review of where ${biz(c)} loses time`,
    body:
      `Hi ${who(c)},\n\n` +
      `Based on ${basis}, I think the right first step is a ${OFFERINGS.review}.\n\n` +
      `It's a structured look at where ${biz(c)} loses time, money, and momentum — and a ranked plan for what to do about it. You'd leave with a clear picture and a roadmap you keep, whether or not you build anything with us. A diagnosis before a prescription, always.\n\n` +
      `It takes ${dur} and there's no obligation attached to it. Shall I hold a time this week?`,
  };
}

/** §6.6 Discovery meeting confirmation. */
export function discoveryConfirmation(c: CommsContext): Msg {
  const when = slot(c);
  const linkLine = c.link?.trim() ? `Here's the link: ${c.link.trim()}.` : "The calendar invite is on its way.";
  return {
    subject: `confirmed — ${when}`,
    body:
      `Hi ${who(c)},\n\n` +
      `We're set for ${when}. ${linkLine}\n\n` +
      `Nothing to prepare. It helps if you come with one thing in mind: where the days feel heaviest right now — what slows down, breaks, or always waits on one person. That's where we'll start.\n\n` +
      `If anything shifts on your end, just reply and we'll move it. Looking forward to it.`,
  };
}

/** §6.7 Calendar confirmation — transactional, short. Mirrors website microcopy. */
export function calendarConfirmation(c: CommsContext): Msg {
  const when = slot(c);
  const linkLine = c.link?.trim() ? `\n${c.link.trim()}` : "";
  return {
    subject: `you're booked — ${when}`,
    body:
      `You're booked, ${who(c)}: ${when}.${linkLine}\n\n` +
      `Before we meet, jot down where ${biz(c)} feels heaviest — that's where we'll begin. Need to move it? Just reply.`,
  };
}

/** §6.8 Meeting reminder. */
export function meetingReminder(c: CommsContext): Msg {
  const t = c.time?.trim() ? c.time.trim() : "our time";
  const linkLine = c.link?.trim() ? ` ${c.link.trim()}` : "";
  return {
    subject: `tomorrow at ${t}`,
    body:
      `A quick reminder, ${who(c)} — we're on for tomorrow at ${t}${c.timezone?.trim() ? ` ${c.timezone.trim()}` : ""}.${linkLine}\n\n` +
      `No prep needed. Just bring the one friction that's been on your mind lately. See you then.`,
  };
}

/** §6.9 Thank-you (after first meeting). Must carry one specific detail. */
export function thankYou(c: CommsContext): Msg {
  const detail = c.observation?.trim() ? c.observation.trim() : "how candidly you walked me through the day-to-day";
  const next = c.outcome?.trim() ? c.outcome.trim() : "pull together the Review overview";
  const by = c.day?.trim() ? ` by ${c.day.trim()}` : " shortly";
  return {
    subject: "thank you — good conversation",
    body:
      `${who(c)},\n\n` +
      `Thank you for the time today, and for being candid about ${detail}. That kind of honesty is what makes the diagnosis actually useful.\n\n` +
      `I'll ${next} and have it to you${by}.\n\n` +
      `Talk soon.`,
  };
}

/** §6.10 Conversation recap. Proves we listened and prioritize. */
export function conversationRecap(c: CommsContext, frictions: string[] = [], firstPriority?: string): Msg {
  const list = frictions.length
    ? frictions.map((f) => `- ${f}`).join("\n")
    : "- the friction we surfaced, named plainly with its rough cost";
  const priority = firstPriority?.trim()
    ? firstPriority.trim()
    : "the smallest change that removes the most friction";
  return {
    subject: "recap — where we landed",
    body:
      `Hi ${who(c)},\n\n` +
      `A short recap so we're working from the same picture.\n\n` +
      `What we heard. ${c.observation?.trim() ? c.observation.trim() : `A clear read on how ${biz(c)} runs today and where it wants to go.`}\n\n` +
      `The friction we surfaced.\n${list}\n\n` +
      `What we'd prioritize first. ${priority}.\n\n` +
      `Next step. I'll send the ${OFFERINGS.plan}${c.day?.trim() ? ` by ${c.day.trim()}` : ""} — no decision needed until you've read it.\n\n` +
      `If any of this doesn't match how you see it, tell me — the map is only useful if it's right.`,
  };
}

/** §6.11 Business Evolution Plan introduction. It IS our proposal — never called one. */
export function evolutionPlanIntro(c: CommsContext): Msg {
  return {
    subject: `your ${OFFERINGS.plan}`,
    body:
      `Hi ${who(c)},\n\n` +
      `Here's your ${OFFERINGS.plan}. It's not a proposal in the usual sense — it's the roadmap we talked about: what we understood about ${biz(c)}, the friction we diagnosed, and the single highest-value improvement we'd make first, in the order that lets each step make the next one easier.\n\n` +
      `A few things worth knowing as you read it:\n` +
      `- It's ranked, not exhaustive. We led with leverage, not with everything possible. The point is what to do first.\n` +
      `- Where we thought the answer isn't more technology, we said so.\n` +
      `- It's yours to keep and act on however you like — with us, at your own pace, or not at all.\n\n` +
      `Read it when you have a clear half hour. Then let's talk it through — no decision needed on the call, just questions. Shall I hold a time next week?`,
  };
}

/** §6.12 The scoped first step (the "proposal" message — never named that). */
export function scopedFirstStep(c: CommsContext): Msg {
  const system = c.systemName?.trim() ? c.systemName.trim() : "the first improvement";
  return {
    subject: "the first step, scoped",
    body:
      `Hi ${who(c)},\n\n` +
      `Here's the scope for the first priority on your ${OFFERINGS.plan}: ${system}.\n\n` +
      `I've kept it deliberately narrow. We build in priority order — one deliberate step that removes the most friction — so this covers ${c.scope?.trim() ? c.scope.trim() : "that first step"}, not everything on the Plan. The rest waits its turn, and each step makes the next one easier.\n\n` +
      `The essentials up front:\n` +
      `- What you get: ${c.outcome?.trim() ? c.outcome.trim() : "the outcome we agreed on, in plain terms"}\n` +
      `- Timeline: ${c.timeline?.trim() ? c.timeline.trim() : "[to confirm]"}, built to ${c.milestone?.trim() ? c.milestone.trim() : "a clear first milestone"}\n` +
      `- Investment: ${c.investment?.trim() ? c.investment.trim() : "[to confirm]"}\n` +
      `- What it removes: ${frictionOr(c, "the friction we named, restated in hours and money returned")}\n` +
      `- What's yours: everything we build — code, design, and assets. No lock-in.\n\n` +
      `No rush on this. Read it, sit with it, and bring me every question — I'd rather over-explain now than have you say yes with a doubt. When you're ready, we start.`,
  };
}

/** §6.15 Project kickoff. */
export function projectKickoff(c: CommsContext): Msg {
  const cadence = c.cadence?.trim() ? c.cadence.trim() : "week";
  const dur = c.duration?.trim() ? c.duration.trim() : "few weeks";
  return {
    subject: "we're starting — here's how this goes",
    body:
      `Hi ${who(c)},\n\n` +
      `We're underway on ${theSystem(c)}. Here's how the next ${dur} will feel, so nothing is a surprise:\n\n` +
      `- What we're building first: ${c.outcome?.trim() ? c.outcome.trim() : "the priority we agreed on"}, because it removes ${frictionOr(c, "the friction that's costing you most")}.\n` +
      `- How you'll hear from us: a short progress note every ${cadence} — what moved, what's next, anything I need from you.\n` +
      `- What I'll need from you: the occasional input, always asked with enough lead time.\n` +
      `- How to reach me: just reply here; during the build I answer quickly.\n\n` +
      `The goal from day one is a system you own — documented, understood, and built to get stronger the longer you run it. Let's build.`,
  };
}

/** §6.16 Progress update. Reliability is the message; bad news reported plainly. */
export function progressUpdate(c: CommsContext, done?: string, next?: string, needed?: string): Msg {
  return {
    subject: `${theSystem(c)} — week of ${c.day?.trim() ? c.day.trim() : "this week"}`,
    body:
      `Hi ${who(c)},\n\n` +
      `This week on ${theSystem(c)}:\n\n` +
      `Done. ${done?.trim() ? done.trim() : "The pieces we planned moved, tied to the outcome."}\n` +
      `Next. ${next?.trim() ? next.trim() : "The next step in priority order."}\n` +
      `Anything from you. ${needed?.trim() ? needed.trim() : "Nothing needed this week."}\n\n` +
      `On track for ${c.milestone?.trim() ? c.milestone.trim() : "the milestone we set"}. Questions welcome anytime.`,
  };
}

/** §6.17 Delivery. */
export function deliveryMessage(c: CommsContext): Msg {
  const outcome = c.outcome?.trim() ? c.outcome.trim() : "the friction it now removes, restated as time and money returned";
  return {
    subject: `it's live — ${theSystem(c)}`,
    body:
      `Hi ${who(c)},\n\n` +
      `${theSystem(c)} is live. Here's what it does for you, in plain terms: ${outcome}.\n\n` +
      `Everything you need:\n` +
      `- How to use it: ${c.link?.trim() ? c.link.trim() : "the short guide attached"}\n` +
      `- The documentation: yours, written so anyone on your team can follow it.\n` +
      `- What to watch for: I'll flag anything that needs a human eye early on.\n\n` +
      `Two things I mean sincerely: this is built to be yours — transferable, documented, no lock-in. And it's built to compound — it should make the next improvement on your ${OFFERINGS.plan} easier to make.\n\n` +
      `I'll check in ${c.day?.trim() ? `on ${c.day.trim()}` : "soon"} to see how it's settling. Until then, tell me the moment anything feels off.`,
  };
}

/** §6.13 Partnership follow-up — invites, never pushes. */
export function partnershipFollowUp(c: CommsContext): Msg {
  const nextP = c.nextPriority?.trim() ? c.nextPriority.trim() : "the next-highest-leverage item on your Plan";
  return {
    subject: `what comes after ${theSystem(c)}`,
    body:
      `Hi ${who(c)},\n\n` +
      `Now that ${theSystem(c)} is running, I've been thinking about what's next on your ${OFFERINGS.plan}.\n\n` +
      `The honest answer: ${nextP} is where I'd go — but only when it's the season for it. There's no advantage to us in rushing the next step, and real advantage to you in letting this one settle and compound first.\n\n` +
      `When you're ready to look at the next priority, I'll re-rank the Plan against where the business is now — things move, and the map should move with them. No pressure, no retainer for busywork. Just a partner keeping an eye on the whole picture.`,
  };
}

/** §6.14 Check-in — value-first, never "just checking in". */
export function checkIn(c: CommsContext): Msg {
  const thought = c.observation?.trim() ? c.observation.trim() : "a small improvement the running system makes possible now that it's settled";
  return {
    subject: `a thought on ${biz(c)}`,
    body:
      `Hi ${who(c)},\n\n` +
      `No agenda — I was thinking about ${biz(c)} and wanted to share one thing.\n\n` +
      `${thought}.\n\n` +
      `If it's useful, let's talk. If not, ignore me entirely — I'll keep watching the whole board either way.`,
  };
}

/** §6.18 Long-term partnership — annual/seasonal re-ranking of the Plan. */
export function longTermPartnership(c: CommsContext): Msg {
  const period = c.period?.trim() ? c.period.trim() : "a while";
  const nextP = c.nextPriority?.trim() ? c.nextPriority.trim() : "the next high-leverage move";
  return {
    subject: "the Plan, re-read for where you are now",
    body:
      `Hi ${who(c)},\n\n` +
      `It's been ${period} of building together, so I re-read your ${OFFERINGS.plan} against where ${biz(c)} is today — because the map should move as the business does.\n\n` +
      `What's compounded. ${c.outcome?.trim() ? c.outcome.trim() : "The systems we've built are still running and now doing more than they were built for."}\n` +
      `What's changed. New friction that's appeared as you've grown, and anything on the old Plan that no longer matters.\n` +
      `Where I'd go next. ${nextP} — with the honest reasoning, including anything I'd now advise against.\n\n` +
      `No decision here — just keeping the whole picture in view, which is my job as your partner. Worth a conversation when the season's right?`,
  };
}

/** Shared: render a scheduled slot from context, gracefully. */
function slot(c: CommsContext): string {
  const parts = [c.day?.trim(), c.time?.trim()].filter(Boolean).join(", ");
  const tz = c.timezone?.trim() ? ` ${c.timezone.trim()}` : "";
  return parts ? `${parts}${tz}` : "our scheduled time";
}

/**
 * The full lifecycle registry — every guide §6 template, keyed by stage. Lets any
 * generator (and the compliance tests) enumerate the one canonical set.
 */
export const LIFECYCLE_TEMPLATES = {
  coldOutreach,
  warmOutreach,
  linkedinConnect,
  reviewInvitation,
  discoveryConfirmation,
  calendarConfirmation,
  meetingReminder,
  thankYou,
  conversationRecap,
  evolutionPlanIntro,
  scopedFirstStep,
  projectKickoff,
  progressUpdate,
  deliveryMessage,
  partnershipFollowUp,
  checkIn,
  longTermPartnership,
} as const;
export type LifecycleStage = keyof typeof LIFECYCLE_TEMPLATES;
