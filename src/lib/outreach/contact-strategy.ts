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
  | "instagram-dm-first";

export type SignalTone = "good" | "warn" | "muted";
export interface ContactSignal {
  label: string;
  value: string;
  tone: SignalTone;
}

export type StrategyIcon = "phone" | "mail" | "form" | "instagram";

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

function instagramUrl(lead: StrategyLead): string | null {
  return lead.socialLinks.find((u) => /instagram\.com/i.test(u)) ?? null;
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
  if (lead.socialLinks.length > 0) return "warn";
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
  const hasEmailRoute = !!(lead.publicEmail || opts.decisionMakerEmail);
  const hasPhone = !!lead.phone;
  const ig = instagramUrl(lead);
  const hasForm = !!lead.contactFormUrl;
  const hasWebsite = !!lead.website;
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
  // Nothing usable yet: still recommend a call if a number turns up; otherwise research.
  return build("call-first", "No verified channel was found yet. Find a phone number or booking link before drafting outreach.");
}

const LABEL: Record<ContactStrategyKind, string> = {
  "email-first": "Email",
  "call-first": "Phone Call",
  "contact-form-first": "Contact Form",
  "instagram-dm-first": "Instagram DM",
};
const ICON: Record<ContactStrategyKind, StrategyIcon> = {
  "email-first": "mail",
  "call-first": "phone",
  "contact-form-first": "form",
  "instagram-dm-first": "instagram",
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
