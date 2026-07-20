// ─────────────────────────────────────────────────────────────────────────────
// Conversation Engine — handcrafted opening conversations, not scripts.
//
// Given what a business ACTUALLY has online (from presence.ts), this builds the
// first thirty seconds of a real phone conversation: the opener, the bridge to
// why you're calling, and the open question that hands them the floor. The whole
// point is that a business with only a Facebook page hears a completely different
// opening than one with a slow website, a multi-location operation, or a Yelp
// profile carrying its reputation.
//
// Two disciplines make it not sound generated:
//   1. Every line references the real channel. We never say "your website" to a
//      business that doesn't have one. We never assume.
//   2. Variety is combinatorial and deterministic. Opener, bridge, and question
//      are each chosen from a pool by a hash of the business name, so two
//      businesses almost never get the same wording, yet the same business is
//      stable across runs. The result is then passed through the style checker
//      (style-checker.ts) and re-rolled until it reads like a person wrote it.
//
// Voice: an experienced business consultant who has nothing to prove — curious,
// specific, unhurried, never selling on the first call.
// ─────────────────────────────────────────────────────────────────────────────

import type { DigitalPresence, PresenceProfile } from "./presence";
import { rewriteUntilNatural, analyzeStyle, type StyleReport } from "./style-checker";

export interface OpeningConversation {
  profile: PresenceProfile;
  /** The first thing you say. */
  opener: string;
  /** The bridge: honest reason you're calling, tied to what you saw. */
  bridge: string;
  /** The open question that ends your turn and starts theirs. */
  question: string;
  /** opener + bridge + question, assembled to read as one natural turn. */
  full: string;
  /** Internal: why this framing fits this business. */
  rationale: string;
  /** Internal: what NOT to say for this presence (guards against assumptions). */
  avoid: string[];
  /** The style report for the assembled opening. */
  style: StyleReport;
}

export interface ConversationInput {
  businessName: string;
  industry: string;
  city?: string | null;
  /** A directly-observed, safe-to-state friction (already lowercased), if any. */
  observedFriction?: string | null;
}

interface Ctx {
  name: string;
  trade: string;
  city: string;
  presence: DigitalPresence;
  friction: string | null;
}

type Line = (c: Ctx) => string;

// ── small deterministic hash so the same business is stable, different ones vary ─
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick<T>(pool: T[], seed: string, salt: number): T {
  return pool[hash(`${seed}#${salt}`) % pool.length];
}

// Turn "Dental practice" / "HVAC contractor" into a natural spoken noun phrase.
function tradePhrase(industry: string): string {
  const i = (industry || "business").trim().toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/dental|dentist/, "dental practice"],
    [/medical|clinic|physician|doctor/, "practice"],
    [/salon|hair|barber/, "shop"],
    [/spa|massage|wellness/, "studio"],
    [/gym|fitness|crossfit|yoga|pilates/, "gym"],
    [/law|attorney|legal/, "firm"],
    [/account|cpa|bookkeep/, "firm"],
    [/restaurant|cafe|coffee|bakery|dining|bar\b/, "spot"],
    [/hvac|plumb|electric|roof|contractor|landscap/, "business"],
    [/auto|mechanic|repair/, "shop"],
    [/retail|boutique|store/, "shop"],
    [/cigar|lounge|tobacc/, "lounge"],
    [/real estate|realtor|broker/, "practice"],
  ];
  for (const [re, phrase] of map) if (re.test(i)) return phrase;
  return "business";
}

// ─────────────────────────────────────────────────────────────────────────────
// Line pools, per presence profile. Each opener/bridge/question is self-contained
// and composes with any other in its group — that's the combinatorial variety.
// ─────────────────────────────────────────────────────────────────────────────

const openersByProfile: Record<PresenceProfile, Line[]> = {
  website: [
    (c) => `Hi, is this ${c.name}? I spent a few minutes looking at how you show up online before I called.`,
    (c) => `Morning — I run a small technology practice, and I was going through ${c.name}'s site earlier.`,
    (c) => `Hi there. I look at how ${c.trade}s like yours run day to day, and ${c.name} came up while I was doing that.`,
    (c) => `Hi — I'll keep this short. I was on your site this week and one thing stuck with me.`,
  ],
  "facebook-only": [
    (c) => `Hi, is this ${c.name}? I found you through your Facebook page, which is doing more work than most people realize.`,
    (c) => `Morning — I came across ${c.name} on Facebook. It's clearly where your customers are talking to you.`,
    (c) => `Hi there. I went looking for ${c.name} online and what I found was an active Facebook page and not much else.`,
    (c) => `Hi — your Facebook page is how I found you, and it told me a fair bit about the ${c.trade}.`,
  ],
  "instagram-only": [
    (c) => `Hi, is this ${c.name}? Your Instagram is what I found first, and it's carrying the whole brand right now.`,
    (c) => `Morning — I came across ${c.name} on Instagram and the audience you've built there caught my eye.`,
    (c) => `Hi there. I went looking for ${c.name} and landed on your Instagram, which is where all the attention seems to live.`,
    (c) => `Hi — Instagram is how I found the ${c.trade}, and it's doing a lot of quiet lifting for you.`,
  ],
  "yelp-only": [
    (c) => `Hi, is this ${c.name}? I found you on Yelp, where your reputation is frankly stronger than most.`,
    (c) => `Morning — ${c.name} came up on Yelp, and the reviews there tell a good story.`,
    (c) => `Hi there. I went looking for ${c.name} and the clearest place you show up is Yelp.`,
    (c) => `Hi — Yelp is how I found the ${c.trade}, and the reputation there is an asset most owners underuse.`,
  ],
  "google-only": [
    (c) => `Hi, is this ${c.name}? I found you through your Google listing — a phone number, some reviews, and not a lot else online.`,
    (c) => `Morning — ${c.name} came up on Google Maps, which right now is doing the job a full presence usually does.`,
    (c) => `Hi there. When I went looking for ${c.name}, the Google listing was really the only place you turned up.`,
    (c) => `Hi — your Google Business profile is how I found the ${c.trade}, and it's carrying more than its share.`,
  ],
  "social-only": [
    (c) => `Hi, is this ${c.name}? I found you across a couple of social profiles, which is where all your presence lives right now.`,
    (c) => `Morning — I came across ${c.name} on social, and that's clearly where the ${c.trade} meets its customers.`,
    (c) => `Hi there. I went looking for ${c.name} and everything I found was on social channels.`,
    (c) => `Hi — social is how I found you, and it's doing the whole job of a home base at the moment.`,
  ],
  invisible: [
    (c) => `Hi, is this ${c.name}? I'll be straight with you — you were hard to find online, which is usually a sign of a busy ${c.trade}.`,
    (c) => `Morning — I went looking for ${c.name} and came up with a phone number and little else, so I picked up the phone.`,
    (c) => `Hi there. Honestly, there's almost nothing about ${c.name} online, and that's exactly why I called.`,
    (c) => `Hi — the ${c.trade} is nearly invisible online, and for a place people clearly rely on, that stood out.`,
  ],
};

const bridgesByProfile: Record<PresenceProfile, Line[]> = {
  website: [
    (c) => c.friction ? `The thing I noticed was ${c.friction} — small on its own, but it's the kind of detail that quietly costs you.` : `Nothing was wrong with it, but I had a couple of specific observations worth comparing against how things actually run.`,
    (c) => `I'm not calling to sell you a new site. I help ${c.trade}s find where they lose time and fix the one thing that matters most first.`,
    (c) => `What I do is look for the friction a business can't see from the inside, then help sort what's worth doing before anything else.`,
  ],
  "facebook-only": [
    (c) => `Here's the honest read: the page works, but you're building an audience on ground you don't own, and Facebook decides who sees you.`,
    (c) => `I'm not here to talk you into a website for its own sake. I help ${c.trade}s turn attention they already have into something they control.`,
    (c) => `The reason I called is that a strong page with no home base of its own is a common, fixable gap — and usually the cheapest thing to fix.`,
  ],
  "instagram-only": [
    (c) => `The honest read is that you've earned real attention there, but a booking or a sale still means someone messaging you and waiting for a reply.`,
    (c) => `I'm not calling about posting more. I help ${c.trade}s turn the audience they've built into bookings without adding work.`,
    (c) => `A following that lives entirely on one app is a strength and a risk at once — and it's usually straightforward to give it a home you own.`,
  ],
  "yelp-only": [
    (c) => `The honest read is that Yelp owns that reputation, not you — they can put a competitor's ad right on top of it, and you can't stop them.`,
    (c) => `I'm not calling about your reviews themselves. I help ${c.trade}s turn a reputation like yours into customers who came straight to you.`,
    (c) => `A reputation that strong sitting on a platform you don't control is the most common gap I see, and one of the more rewarding to close.`,
  ],
  "google-only": [
    (c) => `The honest read is that the listing gets people to call, but everything after that — booking, questions, follow-up — is riding on you and the phone.`,
    (c) => `I'm not calling to sell you a website you don't need. I help ${c.trade}s decide whether a simple home base would actually earn its keep.`,
    (c) => `A listing doing all the work is fine until the phone becomes the bottleneck — and that's usually the first thing worth a look.`,
  ],
  "social-only": [
    (c) => `The honest read is your presence is spread across apps that each own a slice of it, with nothing tying it together that's yours.`,
    (c) => `I'm not calling about posting more often. I help ${c.trade}s pull a scattered presence into one place they actually control.`,
    (c) => `Presence split across platforms is common and fixable — usually the win is one simple home base, not more accounts.`,
  ],
  invisible: [
    (c) => `The honest read is that people who already know you find you fine, but anyone searching cold probably lands on a competitor first.`,
    (c) => `I'm not calling to sell you a big project. I help ${c.trade}s get findable in the few ways that actually bring in customers.`,
    (c) => `Being this hard to find usually means the work speaks for itself — which is exactly the kind of business a small, right-sized fix helps most.`,
  ],
};

const questionsByProfile: Record<PresenceProfile, Line[]> = {
  website: [
    () => `Before I say anything else — when someone new finds you online, what do you actually want them to do first?`,
    (c) => `Can I ask how most new customers find the ${c.trade} today?`,
    () => `Where does the day feel heaviest for you right now — what always seems to wait on one person?`,
  ],
  "facebook-only": [
    () => `Out of curiosity, when someone wants to book or buy off your page, how does that actually happen today?`,
    () => `Has not having a site of your own ever cost you a customer that you noticed?`,
    (c) => `How do most people find the ${c.trade} — is it the page, word of mouth, or something else?`,
  ],
  "instagram-only": [
    () => `When someone sees a post and wants to book, what happens next — do they DM you and wait?`,
    (c) => `How much of the new business at the ${c.trade} comes straight off Instagram right now?`,
    () => `Has all of it living on one app ever made you a little nervous?`,
  ],
  "yelp-only": [
    () => `When a new customer finds you on Yelp and wants to book, what's the very next step for them?`,
    (c) => `Do you feel like the ${c.trade} gets full credit for a reputation that strong, or does some of it leak away?`,
    () => `How are you turning those reviews into people who actually walk in?`,
  ],
  "google-only": [
    () => `When the phone rings from your Google listing and you're busy, what happens to that call?`,
    (c) => `How does booking work at the ${c.trade} today — is it all by phone during the day?`,
    () => `Have you ever wanted people to book or ask a question after hours, without it landing on you?`,
  ],
  "social-only": [
    (c) => `When someone new wants to reach the ${c.trade}, which channel do they usually land on?`,
    () => `Does keeping all these profiles in step ever feel like more work than it's worth?`,
    () => `If someone's ready to buy, how do they actually do that today?`,
  ],
  invisible: [
    (c) => `How do new customers usually find the ${c.trade} — is it mostly word of mouth?`,
    () => `When someone hears about you and goes looking online, what do you think they find?`,
    () => `Have you turned business away simply because you're already busy enough?`,
  ],
};

const avoidByProfile: Record<PresenceProfile, string[]> = {
  website: ["Don't assume the site is bad — lead with a specific, small observation.", "Don't pitch a rebuild; the site is a doorway, not the diagnosis."],
  "facebook-only": ["Never say \"your website\" — there isn't one.", "Don't imply the Facebook page is a mistake; it's working. Frame ownership, not replacement."],
  "instagram-only": ["Never reference a website they don't have.", "Don't disparage Instagram; it's their strength. Talk about turning attention into bookings."],
  "yelp-only": ["Never assume a website.", "Don't criticize the reviews; the reputation is the asset. Frame control and conversion."],
  "google-only": ["Never say \"your website\".", "Don't assume they need a full site; a simple home base may be enough, or the answer may just be booking."],
  "social-only": ["Never assume a website.", "Don't push more posting; the win is consolidation into something they own."],
  invisible: ["Never assume any web presence.", "Don't shame the owner for being hard to find; frame it as a busy business with an easy, high-return fix."],
};

const rationaleByProfile: Record<PresenceProfile, string> = {
  website: "Has a real website — lead with a specific observation and frame the site as a doorway to broader improvement, not the whole story.",
  "facebook-only": "No website; Facebook is the storefront. The honest, high-value angle is owning the audience they're renting from an algorithm.",
  "instagram-only": "No website; Instagram carries the brand. Angle: convert earned attention into bookings on ground they control.",
  "yelp-only": "No website; Yelp carries the reputation. Angle: reputation-to-conversion gap on a platform they don't control.",
  "google-only": "Only a Google Business Profile. Angle: the listing drives calls but the phone is the bottleneck — booking/after-hours is the wedge.",
  "social-only": "Scattered social presence, no owned home base. Angle: consolidate into one place they control.",
  invisible: "Almost no findable presence. Angle: a busy business that's hard to find cold — a small, right-sized fix to become findable.",
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the opening conversation for a business, given its detected presence.
 * Deterministic per business name; varied across businesses; style-checked and
 * re-rolled until it reads naturally.
 */
export function openingConversation(input: ConversationInput, presence: DigitalPresence): OpeningConversation {
  const c: Ctx = {
    name: input.businessName,
    trade: tradePhrase(input.industry),
    city: input.city?.trim() || "",
    presence,
    friction: input.observedFriction?.trim() ? input.observedFriction.trim().toLowerCase() : null,
  };
  const profile = presence.profile;
  const seed = input.businessName || profile;

  const openers = openersByProfile[profile];
  const bridges = bridgesByProfile[profile];
  const questions = questionsByProfile[profile];

  // Each attempt rotates the three independent selections, so a re-roll produces
  // a genuinely different combination — not a reshuffle of the same words.
  const build = (attempt: number): string => {
    const o = pick(openers, seed, attempt)(c);
    const b = pick(bridges, seed, attempt * 7 + 1)(c);
    const q = pick(questions, seed, attempt * 13 + 2)(c);
    return `${o} ${b} ${q}`;
  };

  const result = rewriteUntilNatural(build, { maxAttempts: 8 });

  // Recover the three parts from the winning attempt for structured display.
  const winning = result.attempts - 1;
  const opener = pick(openers, seed, winning)(c);
  const bridge = pick(bridges, seed, winning * 7 + 1)(c);
  const question = pick(questions, seed, winning * 13 + 2)(c);

  return {
    profile,
    opener,
    bridge,
    question,
    full: result.text,
    rationale: rationaleByProfile[profile],
    avoid: avoidByProfile[profile],
    style: result.report,
  };
}

/** Re-export for callers that only need the check without generating. */
export { analyzeStyle };
