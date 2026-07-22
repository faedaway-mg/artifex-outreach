// ─────────────────────────────────────────────────────────────────────────────
// Adaptive phone conversation guides and discovery — guides, never scripts.
//
// The phone call is a continuation of a conversation the email already started.
// It branches on what the other person actually says. It never leads with
// website, marketing, technology, or automation — only the customer experience.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import type { PhoneGuide, DiscoveryPlan, DiscoveryQuestion, DecisionMakerIntelligence } from "./types";
import { openingConversation } from "../conversation-engine";
import { audienceNoun, tradeNoun, addressName, topOpportunities, noticed } from "./voice";

function singular(noun: string): string {
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}

const NEVER_SAY = ["website", "marketing", "technology", "automation", "software", "a sales pitch"];

export function buildPhoneGuide(lead: Lead, profile: BusinessProfile, dm: DecisionMakerIntelligence): PhoneGuide {
  const audience = audienceNoun(lead.industry);
  const one = singular(audience);
  const trade = tradeNoun(lead.industry);
  const convo = openingConversation(profile.conversationInput, profile.presence);
  const dmName = dm.identified ? addressName(dm.primary?.name, lead.industry) : null;

  const whatThisIsAbout = `It's about how new ${audience} experience your ${trade} before they ever become ${audience}. I noticed a couple of small places where that could be smoother — that's really all.`;

  return {
    whatThisIsAbout,
    stages: [
      {
        audience: "receptionist",
        title: "If a receptionist or front desk answers",
        goal: `Find who owns the ${one} experience — warmly, without pitching.`,
        avoid: NEVER_SAY,
        steps: [
          {
            label: "Open with a genuine, small ask",
            say: `Hi! Quick question — I spent about ten minutes walking through ${lead.businessName} online the same way a new ${one} would, and I noticed a couple of places where things get a little harder than they probably need to be. Who's usually responsible for improving that experience?`,
            branches: [
              { when: `If they ask "what is this regarding?"`, say: whatThisIsAbout },
              { when: "If they offer to take a message", say: `That would be great, thank you. Is that person usually easier to reach by email, or is a quick call better?` },
              { when: "If they say the owner handles everything", say: `That makes sense for a ${trade} this size. When's usually a good time to catch them for two minutes?` },
              { when: "If they're protective / screening hard", say: `Totally fair — I'd screen me too. I'm not selling anything; I just noticed a couple of things a new ${one} runs into and thought it was worth mentioning to the right person.` },
            ],
          },
        ],
      },
      {
        audience: "decision-maker",
        title: dmName ? `When you reach ${dmName}` : "When you reach the decision maker",
        goal: "Earn a real conversation — not book a meeting. Curiosity does the work.",
        avoid: NEVER_SAY,
        steps: [
          {
            label: "Open — who you are and what you actually did",
            say: `${dmName ? `Hi ${dmName} — ` : "Hi — "}my name's Jordan, I run Artifex Labs. I spent a little time looking at your ${trade} the way a brand-new ${one} would.`,
            branches: [],
          },
          {
            label: "Bridge — the honest reason you called",
            say: `A couple of things stood out that might be creating a little unnecessary friction. I'm not calling because I think you need a new website — I'm mostly curious.`,
            branches: [
              { when: `If they ask "is this a sales call?"`, say: `Fair question. I'm not calling to sell you anything today. I looked at your ${trade} the way a new ${one} would, a couple of things stood out, and I'd rather be wrong in a two-minute conversation than assume.` },
            ],
          },
          {
            label: "Ask one real question — then stop and listen",
            say: `Can I ask you one thing? ${convo.question}`,
            branches: [
              { when: "If they answer openly and engage", say: `That's exactly the moment I was looking at. Would it be worth fifteen minutes to compare what I noticed with how it actually works for you?` },
              { when: "If they say they're happy with everything", say: `Genuinely glad to hear it — that's the best answer. Can I leave you with one small observation in case it's useful down the road?` },
              { when: "If it's a bad time", say: `Completely understand. Is there a better time this week for two minutes? I'll keep it short.` },
              { when: "If they push back on value", say: `That's fair. Let me send you the one thing I noticed in writing — if it lands, we talk; if not, you've lost nothing.` },
            ],
          },
        ],
      },
      {
        audience: "voicemail",
        title: "If you get voicemail",
        goal: "Leave a reason to call back that is clearly not a pitch.",
        avoid: NEVER_SAY,
        steps: [
          {
            label: "Short, specific, no pitch",
            say: `${dmName ? `Hi ${dmName}, ` : "Hi, "}this is Jordan with Artifex Labs. I spent a few minutes going through ${lead.businessName} the way a new ${one} would and noticed a couple of small things worth a two-minute conversation — no pitch, just observations. I'll follow up with a short email so you have it in writing. Thanks for the time.`,
            branches: [],
          },
        ],
      },
    ],
  };
}

// ── Adaptive discovery ───────────────────────────────────────────────────────
export function buildDiscoveryPlan(lead: Lead, profile: BusinessProfile): DiscoveryPlan {
  const audience = audienceNoun(lead.industry);
  const one = singular(audience);
  const trade = tradeNoun(lead.industry);

  const opening = `This isn't a qualification call. You know your ${trade} better than any outside look ever could — I just want to compare a few things I noticed with how it actually works, and understand what matters most to you.`;

  const questions: DiscoveryQuestion[] = [];

  // A journey-anchored opener everyone can answer.
  questions.push({
    question: `When someone finds you online for the very first time, what's the one thing you hope they do next?`,
    intent: "Understand what a 'win' looks like from their side before offering any opinion.",
    basis: `Presence: ${profile.presence.primaryChannel}`,
  });

  // One curious question per real, top opportunity — grounded, never leading.
  for (const o of topOpportunities(profile, 3)) {
    questions.push({
      question: `I noticed ${noticed(o, audience)}. When a ${one} runs into that, how does it usually play out on your end?`,
      intent: "Confirm or correct an inference — they may already handle it well.",
      basis: `${o.category}: ${o.observation}`,
    });
  }

  // A pride/strengths question — people open up around what's working.
  if (profile.strengths[0]) {
    questions.push({
      question: `What do your best ${audience} consistently tell you they love — the thing you'd never change?`,
      intent: "Anchor the conversation in strength, and hear their own language.",
      basis: `Strength: ${profile.strengths[0]}`,
    });
  }

  // An operations/time question when operations looks strained.
  const ops = profile.dimensions?.operations;
  if (ops && (ops.score == null || ops.score < 60)) {
    questions.push({
      question: `Where does your team spend the most time on things that feel repetitive — the stuff that quietly eats the day?`,
      intent: "Surface operational friction the outside view can't see.",
      basis: `Operations readiness: ${ops.summary}`,
    });
  }

  // Dedup by question text, cap at 6.
  const seen = new Set<string>();
  const unique = questions.filter((q) => (seen.has(q.question) ? false : (seen.add(q.question), true))).slice(0, 6);

  return {
    opening,
    questions: unique,
    listenFor: [
      "Do they already know about the friction you noticed — or is it news to them?",
      "Who else is involved when they decide to change something?",
      "What have they already tried, and why did it stall?",
      `What does "better" actually look like in their own words?`,
    ],
  };
}
