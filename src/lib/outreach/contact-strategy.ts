// ─────────────────────────────────────────────────────────────────────────────
// Contact Strategy — choose the best FIRST touch before generating any outreach.
//
// The old assumption was research → email → send. Businesses don't all work that
// way: some have no public email but a live phone and an active Instagram. This is
// a small, deterministic recommender — not an AI system. It reads the signals a
// lead already carries and names the channel to begin the relationship on, plus a
// short sequence so the operator never has to ask "what do I do now?".
// ─────────────────────────────────────────────────────────────────────────────

export type ContactStrategyKind =
  | "email-first"
  | "call-first"
  | "contact-form-first"
  | "instagram-dm-first"
  // No verified, actionable contact channel exists yet. The one action a lead in
  // this state supports is finding a real contact route — NOT a call, email, or DM
  // that can't currently be performed. A preferred strategy (e.g. "phone would suit
  // this business") must never render an action the evidence can't support.
  | "no-channel";

export type SignalTone = "good" | "warn" | "muted";
export interface ContactSignal {
  label: string;
  value: string;
  tone: SignalTone;
}

export type StrategyIcon = "phone" | "mail" | "form" | "instagram" | "search";

// ── Channel eligibility ───────────────────────────────────────────────────────
// A channel is actionable only when the evidence for it is real and well-formed.
// Presence of a field is NOT enough — an empty string, a stray fragment, or a
// malformed URL must never be treated as a usable contact route.

/** A phone is callable only if it carries a plausible number of real digits. */
export function isCallablePhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  // 10 (US local) to 15 (E.164 max). Fewer digits isn't a dialable number.
  return digits.length >= 10 && digits.length <= 15;
}

/** A structurally valid email address. */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

/** A usable http(s) URL — for a website, contact form, or booking link. */
export function isUsableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** A usable Instagram profile URL associated with the business. */
export function hasUsableInstagram(socialLinks: string[]): boolean {
  const ig = findInstagram(socialLinks);
  return !!ig && isUsableUrl(ig);
}

export interface ContactStrategy {
  kind: ContactStrategyKind;
  /** Short human label for the recommended first touch, e.g. "Phone Call". */
  primaryLabel: string;
  icon: StrategyIcon;
  reason: string;
  signals: ContactSignal[];
  sequence: string[];
}

/** A conversation starter for a call — NOT a sales script. */
export interface CallBrief {
  opening: string;
  observation: string;
  transition: string;
  permissionQuestion: string;
}

/** One skimmable, spoken response for a situation that comes up on the call. */
export interface CallBranch {
  /** The situation, e.g. "A receptionist or employee answers". */
  situation: string;
  /** A practical spoken line — read aloud, not sales copy. */
  line: string;
}

/**
 * The full call guide for a call-first lead — everything the operator needs
 * visible while holding the phone: the objective, the opening line, a private
 * purpose note, the few questions to ask, and short branches for common turns.
 * Deterministic templates tailored to what we actually know — never a pitch.
 */
export interface CallScript {
  /** One short objective for the call. */
  objective: string;
  /** The natural opening line, tailored to the business. */
  opening: string;
  /** A one-sentence private operator note — the goal of the call. */
  purpose: string;
  /** Only the few questions this call needs to resolve. */
  questions: string[];
  /** Short spoken responses for the common situations. */
  branches: CallBranch[];
}

/** The minimal lead shape this engine reads — structurally satisfied by Lead. */
export interface StrategyLead {
  businessName: string;
  publicEmail: string | null;
  phone: string | null;
  website: string | null;
  contactFormUrl: string | null;
  socialLinks: string[];
  businessStatus: string | null;
  rating: number | null;
  reviewCount: number | null;
}

/** The lead's Instagram profile URL, if any — exported for the DM channel UI. */
export function findInstagram(socialLinks: string[]): string | null {
  return (socialLinks ?? []).find((u) => /instagram\.com/i.test(u)) ?? null;
}
function instagramUrl(lead: StrategyLead): string | null {
  return findInstagram(lead.socialLinks);
}
function looksLikeGoogleForm(lead: StrategyLead): boolean {
  const url = lead.contactFormUrl ?? "";
  return /forms\.gle|docs\.google\.com\/forms/i.test(url);
}

/** Operational activity from the signals we have, never invented. */
function activityLevel(lead: StrategyLead): SignalTone {
  const open = (lead.businessStatus ?? "").toUpperCase() === "OPERATIONAL";
  const reviews = lead.reviewCount ?? 0;
  if (open && reviews >= 50) return "good";
  if (open || reviews >= 15) return "warn";
  return "muted";
}
function socialLevel(lead: StrategyLead): SignalTone {
  if (instagramUrl(lead)) return "good";
  if ((lead.socialLinks ?? []).length > 0) return "warn";
  return "muted";
}

/**
 * The best first touch, given what we actually know. Preference order when a
 * channel is missing: a real email route → phone → contact form → Instagram DM.
 * (walk-in / referral are future strategies, deliberately not implemented.)
 */
export function determineContactStrategy(
  lead: StrategyLead,
  opts: { decisionMakerEmail?: string | null } = {},
): ContactStrategy {
  // A channel counts only if its evidence is real and actionable — a stray value or
  // malformed URL is NOT a contact route. A preferred strategy must never render an
  // action the evidence can't support (there is no "call" without a callable number).
  const hasEmailRoute = isValidEmail(lead.publicEmail) || isValidEmail(opts.decisionMakerEmail);
  const hasPhone = isCallablePhone(lead.phone);
  const igUrl = instagramUrl(lead);
  const ig = hasUsableInstagram(lead.socialLinks) ? igUrl : null;
  const hasForm = isUsableUrl(lead.contactFormUrl);
  const hasWebsite = isUsableUrl(lead.website);
  const activity = activityLevel(lead);
  const social = socialLevel(lead);

  // How this business appears to take inquiries — reported, not guessed.
  const bookingParts: string[] = [];
  if (ig) bookingParts.push("Instagram");
  if (looksLikeGoogleForm(lead)) bookingParts.push("Google Form");
  else if (hasForm) bookingParts.push("Contact form");
  if (hasWebsite) bookingParts.push("Website");
  if (hasPhone && bookingParts.length === 0) bookingParts.push("Phone");
  const booking = bookingParts.length ? bookingParts.join(" + ") : "Unknown";

  // Reachability: a live phone + an active business = you can get to a person.
  const reachability: SignalTone = hasPhone && activity !== "muted" ? "good" : hasPhone ? "warn" : "muted";

  const signals = (kind: ContactStrategyKind): ContactSignal[] => [
    { label: "Website", value: hasWebsite ? lead.website!.replace(/^https?:\/\//, "") : "None detected", tone: hasWebsite ? "good" : "warn" },
    { label: "Business activity", value: activity === "good" ? "High" : activity === "warn" ? "Moderate" : "Low", tone: activity },
    { label: "Social presence", value: social === "good" ? "Strong" : social === "warn" ? "Some" : "None", tone: social },
    { label: "Primary booking", value: booking, tone: booking === "Unknown" ? "muted" : "good" },
    { label: "Decision-maker reachability", value: reachability === "good" ? "High" : reachability === "warn" ? "Moderate" : "Low", tone: reachability },
    { label: "Recommended first contact", value: LABEL[kind], tone: "good" },
  ];

  const build = (kind: ContactStrategyKind, reason: string): ContactStrategy => ({
    kind,
    primaryLabel: LABEL[kind],
    icon: ICON[kind],
    reason,
    signals: signals(kind),
    sequence: SEQUENCE[kind],
  });

  if (hasEmailRoute) {
    return build("email-first", "A verified email route was found — the personalized introduction can go out directly.");
  }
  if (hasPhone) {
    const via = [ig ? "Instagram" : null, looksLikeGoogleForm(lead) ? "Google Forms" : hasForm ? "a contact form" : null]
      .filter(Boolean)
      .join(", ");
    return build(
      "call-first",
      `No verified public email was found. This business appears to operate primarily through phone${via ? `, ${via}` : ""} — a short, friendly call is the right first touch.`,
    );
  }
  if (hasForm) {
    return build("contact-form-first", "No email or phone was found, but there's a contact form — send a short, warm note through it.");
  }
  if (ig) {
    return build("instagram-dm-first", "No email, phone, or form was found. Instagram is the live channel — open with a brief, human DM.");
  }
  // Nothing actionable exists. This is NOT a call-first lead — there is no number to
  // dial. The only performable action is finding a real contact route first.
  return build(
    "no-channel",
    "No verified phone, email, website, contact form, or social account has been found for this business yet — find a reliable contact route before preparing outreach.",
  );
}

/** The work-queue channel a strategy belongs to — so the queue groups by action. */
export function strategyToWorkKind(
  kind: ContactStrategyKind,
): "email" | "call" | "contact-form" | "instagram-dm" | "understand" {
  switch (kind) {
    case "email-first": return "email";
    case "call-first": return "call";
    case "contact-form-first": return "contact-form";
    case "instagram-dm-first": return "instagram-dm";
    // No channel yet → the lead needs research, not an outreach batch.
    case "no-channel": return "understand";
  }
}

const LABEL: Record<ContactStrategyKind, string> = {
  "email-first": "Email",
  "call-first": "Phone Call",
  "contact-form-first": "Contact Form",
  "instagram-dm-first": "Instagram DM",
  "no-channel": "Find Contact Route",
};
const ICON: Record<ContactStrategyKind, StrategyIcon> = {
  "email-first": "mail",
  "call-first": "phone",
  "contact-form-first": "form",
  "instagram-dm-first": "instagram",
  "no-channel": "search",
};
const SEQUENCE: Record<ContactStrategyKind, string[]> = {
  "email-first": ["Review the drafted introduction", "Send it", "Give it a few days to breathe", "Send one brief follow-up if needed"],
  "call-first": [
    "Call the business",
    "Ask for the owner or decision-maker",
    "Ask for the best email address",
    "Send the personalized review afterward",
    "Schedule a conversation if they're interested",
  ],
  "contact-form-first": ["Open their contact form", "Paste the short introduction", "Submit it", "Watch for a reply, then send the review"],
  "instagram-dm-first": ["Open their Instagram", "Send a short, warm DM", "Ask for the best email address", "Send the review afterward"],
  "no-channel": ["Search public sources for a contact route", "Verify what's found against its source", "Save the channel", "Then begin outreach on the channel that fits"],
};

/**
 * A conversation starter for a call-first lead — opening, one honest observation,
 * a soft transition, and a permission question. Never a pitch.
 */
export function buildCallBrief(
  lead: StrategyLead,
  opts: { strongestObservation?: string | null } = {},
): CallBrief {
  const ig = instagramUrl(lead);
  const noWebsite = !lead.website;
  const via = looksLikeGoogleForm(lead) ? "just the Google Form through Instagram" : ig ? "mostly Instagram" : "no dedicated website";

  const opening = ig
    ? `I was looking through your Instagram and ${lead.businessName} looks incredible.`
    : `I came across ${lead.businessName} and what you're doing looks genuinely impressive.`;

  const observation = opts.strongestObservation?.trim()
    ? opts.strongestObservation.trim()
    : noWebsite
      ? `One thing I noticed was that I couldn't find a dedicated website — it looks like it's ${via}.`
      : `One thing I noticed was that the booking flow felt a little harder to find than it could be.`;

  return {
    opening,
    observation,
    transition: "I might be completely wrong from the outside,",
    permissionQuestion: noWebsite
      ? "but has that ever become a limitation when people are trying to book with you?"
      : "but has that ever come up as a friction point for the people trying to reach you?",
  };
}

/**
 * The complete, readable call guide for a call-first lead. Unlike buildCallBrief
 * (a single conversation-starter paragraph), this is the whole workspace script:
 * objective, opening, purpose, the few questions, and the common branches — all
 * shaped to be read aloud while on the phone. Pure + deterministic so it's testable.
 */
export function buildCallScript(
  lead: StrategyLead,
  opts: { strongestObservation?: string | null } = {},
): CallScript {
  const name = lead.businessName;
  const ig = instagramUrl(lead);
  const brief = buildCallBrief(lead, opts);

  // VALUE FIRST. The old opening asked "who would be the best person to speak with
  // about the customer experience" — a qualifying question that costs the caller
  // something before offering anything, which is exactly how a cold call gets
  // handled as a nuisance. Whoever picked up has no reason to route a stranger who
  // hasn't said what they want.
  //
  // So the opening leads with the thing we actually prepared and asks for the one
  // piece of information that lets us deliver it. Reception can say yes to that;
  // reception cannot say yes to being interrogated. Finding the decision-maker is a
  // path to the goal, not the goal.
  //
  // These are the same words the conversation assistant opens with (see
  // call-conversation.ts) — one script, whichever surface the operator is on.
  const opening = ig
    ? `Hi, I'll keep this quick — I was looking through ${name}'s Instagram and put together a short review with a few observations that might be useful. I was hoping to send it over. What's the best email for that?`
    : `Hi, I'll keep this quick — I put together a short review for ${name} with a few observations that might be useful. I was hoping to send it over. What's the best email for that?`;

  return {
    objective: `Offer the review, get the best email, and earn a yes to send it.`,
    opening,
    purpose:
      "Offer something genuinely useful first, then earn permission to send it. The decision-maker is the ideal person to reach — but the address, freely given, is the win.",
    questions: [
      "What's the best email to send the review to?",
      "Is it alright if I send it to that address?",
      "Is there someone in particular who'd want to see it?",
      "When's usually a good time to reach them?",
    ],
    branches: [
      {
        situation: "The decision-maker answers",
        line: `Great — I'll keep this short. ${brief.observation} ${brief.transition.replace(/,$/, "")}, and I could be wrong from the outside. Can I send the review over so you can judge for yourself? What's the best email?`,
      },
      {
        situation: "A receptionist or employee answers",
        line: `No problem at all — is there a good email I could send the review to, or is there someone who'd want to see it?`,
      },
      {
        situation: "The decision-maker is unavailable",
        line: `No problem at all. Is there an email I could send the review to in the meantime — and when's usually a good time to reach them?`,
      },
      {
        situation: "They ask what the call is about",
        line: `Of course — I run a small studio here in LA and I put together a short review of ${name} with a couple of specific observations. There's no cost and nothing to sign; I just thought it might be useful. Can I send it over?`,
      },
      {
        situation: "They give you an email",
        line: `Perfect, thank you — let me read that back to make sure I have it right. Is it alright if I send the review to that address?`,
      },
      {
        situation: "They say yes",
        line: `Perfect, thank you. I'll send it over today. If anything in it is useful we can talk it through, and if not, no hard feelings at all.`,
      },
      {
        situation: "They're not interested",
        line: `Completely fair — I appreciate you taking the call. I'll leave it there. Have a good rest of your day.`,
      },
      {
        situation: "Voicemail",
        line: `Hi, this is Jordan — I put together a short review for ${name} with a few observations that might be useful, and I wanted to send it over. If you'd like it, the easiest thing is to reply to this number with an email address. No cost, nothing to sign. Thanks very much.`,
      },
    ],
  };
}
