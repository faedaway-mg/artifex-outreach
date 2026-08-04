// ─────────────────────────────────────────────────────────────────────────────
// The Call Assistant's conversation engine.
//
// A cold call is not a script read top to bottom — it forks on the second word.
// So the operator does not read a page; they tap what just happened, and the words
// to say next appear. This module is that machine, and it is deliberately PURE:
// every event, every next line, every derived outcome is a function of the path
// taken so far. Nothing here touches the database.
//
// That purity is the safety property the whole feature rests on. Tapping through a
// conversation must never write to a lead — the operator is mid-call, guessing at
// what the person on the other end meant, and will tap the wrong thing. The path is
// a draft until they commit it. Back and Undo are therefore free, and the commit is
// a single deliberate act (see saveCallOutcomeAction).
//
// The other half of the design: these taps are the only structured record we will
// ever get of what happened on a phone call. A free-text note is where knowledge
// goes to die. So the same path that drives the script also derives the outcome and
// a set of structured facts — one set of taps, three uses.
// ─────────────────────────────────────────────────────────────────────────────
import type { CallOutcome, VoicemailStatus } from "./call-outcome";
import type { CallOpening } from "./call-opening";

// ── The events ───────────────────────────────────────────────────────────────
// What just happened on the call. Named from the OPERATOR's point of view, because
// that is who is tapping: "they transferred me", not "transfer_initiated".
export type CallEvent =
  // who picked up
  | "reception-answered"
  | "dm-answered"
  | "no-answer"
  // navigating the business
  | "transferred"
  | "transfer-failed"
  | "on-hold"
  | "asked-what-this-is"
  | "dm-unavailable"
  | "busy-callback"
  // the address
  | "general-email"
  | "direct-email"
  | "permission-granted"
  | "email-no-permission"
  | "asked-to-email-info"
  // interest
  | "interested-broader"
  | "interested-specific"
  | "wants-meeting"
  // language
  | "spanish"
  | "other-language"
  | "transferred-to-english"
  | "no-english-contact"
  | "callback-with-language-support"
  // voicemail
  | "voicemail-available"
  | "no-voicemail"
  | "mailbox-full"
  // endings
  | "not-interested"
  | "wrong-number"
  | "closed-invalid"
  | "end-call";

export const EVENT_LABEL: Record<CallEvent, string> = {
  "reception-answered": "Reception answered",
  "dm-answered": "Decision-maker answered",
  "no-answer": "No answer",
  transferred: "Transferred",
  "transfer-failed": "Transfer failed / disconnected",
  "on-hold": "Put on hold",
  "asked-what-this-is": "Asked what this is about",
  "dm-unavailable": "Owner / decision-maker unavailable",
  "busy-callback": "Busy — call back later",
  "general-email": "General email provided",
  "direct-email": "Direct email provided",
  "permission-granted": "Said yes — send it over",
  "email-no-permission": "Email given, no permission asked",
  "asked-to-email-info": "Asked me to email information",
  "interested-broader": "Interested in broader help",
  "interested-specific": "Interested in one specific issue",
  "wants-meeting": "Wants a meeting",
  spanish: "Spanish speaker",
  "other-language": "Another language",
  "transferred-to-english": "Transferred to an English speaker",
  "no-english-contact": "No English-speaking contact available",
  "callback-with-language-support": "Call back with language support",
  "voicemail-available": "Voicemail available",
  "no-voicemail": "No voicemail available",
  "mailbox-full": "Mailbox full",
  "not-interested": "Not interested",
  "wrong-number": "Wrong number",
  "closed-invalid": "Closed / invalid",
  "end-call": "End call",
};

/** Colour/weight grouping for the UI — good news, keep going, or wrap it up. */
export type EventTone = "good" | "neutral" | "bad";
const TONE: Partial<Record<CallEvent, EventTone>> = {
  "dm-answered": "good",
  "permission-granted": "good",
  "direct-email": "good",
  "general-email": "good",
  "transferred-to-english": "good",
  "interested-broader": "good",
  "interested-specific": "good",
  "wants-meeting": "good",
  "not-interested": "bad",
  "wrong-number": "bad",
  "closed-invalid": "bad",
  "transfer-failed": "bad",
  "no-english-contact": "bad",
};
export const toneOf = (e: CallEvent): EventTone => TONE[e] ?? "neutral";

// ── What the operator may need to type ───────────────────────────────────────
export type CaptureField =
  | "generalEmail"
  | "directEmail"
  | "contactName"
  | "contactRole"
  | "transferTo"
  | "callbackWindow"
  | "languageOther"
  | "interest"
  | "notes";

export interface CallCaptured {
  generalEmail?: string;
  directEmail?: string;
  contactName?: string;
  contactRole?: "owner" | "manager" | "assistant";
  transferTo?: "owner" | "manager" | "department" | "unknown";
  transferName?: string;
  callbackWindow?: string;
  languageOther?: string;
  interest?: string;
  notes?: string;
}

/** The temporary, uncommitted call. `leadId` is carried so a session can never be
 *  saved against a business it wasn't recorded for. */
export interface CallSession {
  leadId: string;
  /** A client-generated id, stable for one call — the idempotency key on commit. */
  sessionId: string;
  path: CallEvent[];
  captured: CallCaptured;
}

export function newSession(leadId: string, sessionId: string): CallSession {
  return { leadId, sessionId, path: [], captured: {} };
}

// ── The reducer — Back, Undo, and editing the breadcrumb ─────────────────────
// All three are the same operation at different depths, and all three are pure.

/** Record what just happened. Two DISPOSITIONS can't both be true — tapping "wrong
 *  number" after "not interested" corrects the first rather than pretending both
 *  happened. Hanging up is not a disposition, so it always appends: a call that ends
 *  after a decline must still remember the decline. */
export function appendEvent(s: CallSession, e: CallEvent): CallSession {
  const last = s.path[s.path.length - 1];
  if (last === e) return s; // double-tap of the same button is not a new event
  if (last && isDisposition(last) && isDisposition(e)) {
    return { ...s, path: [...s.path.slice(0, -1), e] };
  }
  return { ...s, path: [...s.path, e] };
}

/** Remove ONLY the last event. */
export function undoLast(s: CallSession): CallSession {
  if (s.path.length === 0) return s;
  return { ...s, path: s.path.slice(0, -1) };
}

/** Return to a prior point in the breadcrumb — everything after `index` is dropped.
 *  `truncateTo(s, 0)` returns to the opening. */
export function truncateTo(s: CallSession, index: number): CallSession {
  const n = Math.max(0, Math.min(index, s.path.length));
  if (n === s.path.length) return s;
  return { ...s, path: s.path.slice(0, n) };
}

/** Replace an accidental selection at `index` with a different event. */
export function replaceAt(s: CallSession, index: number, e: CallEvent): CallSession {
  if (index < 0 || index >= s.path.length) return s;
  return { ...s, path: [...s.path.slice(0, index), e] };
}

export function capture(s: CallSession, patch: CallCaptured): CallSession {
  return { ...s, captured: { ...s.captured, ...patch } };
}

/** How the call resolved. Mutually exclusive — at most one can be true of a call. */
const DISPOSITIONS: CallEvent[] = ["not-interested", "wrong-number", "closed-invalid"];
export const isDisposition = (e: CallEvent) => DISPOSITIONS.includes(e);

/** The call is over after this. A disposition ends it; so does simply hanging up. */
export const isTerminal = (e: CallEvent) => e === "end-call" || isDisposition(e);

// ── The guidance ─────────────────────────────────────────────────────────────
export interface CallGuidance {
  /** What we are trying to achieve right now. */
  objective: string;
  /** The words to say next. This is the loudest thing on the screen. */
  say: string;
  /** A short private note to the operator — never spoken. */
  note?: string;
  /** Fields this moment might need. */
  capture: CaptureField[];
  /** Only the choices that plausibly come next — never all 27. */
  next: CallEvent[];
  /** Where this is heading, so the commit is never a surprise. */
  likelyOutcomes: CallOutcome[];
}

export interface GuidanceContext {
  businessName: string;
  /**
   * The reasoned opening for THIS business — what we looked at, what we made,
   * what we noticed, and the words for each turn of the call. Required, because
   * the alternative is this file inventing its own version of the same sentences
   * and the two drifting apart. Build it with openingForLead().
   */
  opening: CallOpening;
  /** The strongest concrete observation we prepared, if we have one — it makes the
   *  value real instead of generic. */
  observation?: string | null;
}

const OPENING_NEXT: CallEvent[] = [
  "reception-answered", "dm-answered", "asked-what-this-is", "no-answer",
  "spanish", "other-language", "wrong-number",
];

/**
 * What to say, given everything that has happened so far.
 *
 * The primary goal is NOT "find the decision-maker" — it is to earn permission to
 * send something genuinely valuable. Every line below is written to that end: brief,
 * specific, no pressure, and grounded in the thing we actually prepared.
 *
 * The business-specific words come from ctx.opening (see call-opening.ts). This
 * file decides WHEN to say something; that engine decides WHAT, per business.
 */
export function guidanceFor(path: CallEvent[], ctx: GuidanceContext): CallGuidance {
  const name = ctx.businessName;
  const o = ctx.opening;
  const last = path[path.length - 1];
  const been = (e: CallEvent) => path.includes(e);

  // FIRST CONTACT — value first. Not "who handles your customer experience".
  if (!last) {
    return {
      objective: `Offer ${o.deliverable} and get the best email to send it to.`,
      say: o.say,
      note: "Lead with what you prepared. What you made is the door; everything else comes later.",
      capture: [],
      next: OPENING_NEXT,
      likelyOutcomes: ["asked-to-send", "contact-collected", "no-answer"],
    };
  }

  switch (last) {
    case "reception-answered":
      return {
        objective: "Get the best email, or the name of who can give it to you.",
        say: o.lines.reception,
        note: "Reception can hand you the address. You don't need the owner to succeed here.",
        capture: ["contactName"],
        next: ["general-email", "direct-email", "transferred", "on-hold", "asked-what-this-is", "dm-unavailable", "busy-callback", "asked-to-email-info", "not-interested"],
        likelyOutcomes: ["contact-collected", "asked-to-send", "follow-up"],
      };

    case "dm-answered":
      return {
        objective: "Make the value concrete, then ask permission to send it.",
        say: o.lines.decisionMaker,
        note: "You have the right person. Don't pitch — offer, and let the work speak for itself.",
        capture: ["contactName", "contactRole", "directEmail"],
        next: ["direct-email", "permission-granted", "general-email", "asked-what-this-is", "interested-specific", "interested-broader", "wants-meeting", "busy-callback", "not-interested"],
        likelyOutcomes: ["reached-dm", "asked-to-send", "contact-collected"],
      };

    // TRANSFERRED — do not restart the opening. They have already heard some of it.
    case "transferred":
      return {
        objective: "Re-open warmly, in one sentence, without repeating yourself.",
        say: o.lines.transferred,
        note: "Never run the cold opening twice. Acknowledge the transfer and get to the point.",
        capture: ["transferTo", "contactName"],
        next: ["dm-answered", "direct-email", "general-email", "permission-granted", "asked-what-this-is", "on-hold", "transfer-failed", "dm-unavailable", "not-interested"],
        likelyOutcomes: ["reached-dm", "asked-to-send", "contact-collected"],
      };

    case "transfer-failed":
      return {
        objective: "Recover the call — or at least the address.",
        say: `Sorry, I think we got cut off during the transfer. I'll be quick — is there an email I could send ${o.deliverable} to?`,
        note: "A dropped transfer is not a dead lead. Ask once, then schedule a call back.",
        capture: ["generalEmail", "callbackWindow"],
        next: ["general-email", "direct-email", "busy-callback", "dm-unavailable", "no-answer", "end-call"],
        likelyOutcomes: ["contact-collected", "follow-up", "no-answer"],
      };

    case "on-hold":
      return {
        objective: "Hold, and keep your place.",
        say: `Of course — I'll hold, thank you.`,
        note: "Nothing is lost while you wait. Your place in this conversation is kept — tap what happens when they come back.",
        capture: [],
        next: ["transferred", "dm-answered", "reception-answered", "dm-unavailable", "transfer-failed", "busy-callback"],
        likelyOutcomes: ["reached-dm", "contact-collected", "follow-up"],
      };

    case "asked-what-this-is":
      return {
        objective: "Explain the value in two sentences. No pitch.",
        say: o.lines.whatIsThis,
        note: "Answer plainly and stop talking. Over-explaining is what loses the call.",
        capture: [],
        next: ["permission-granted", "general-email", "direct-email", "transferred", "dm-answered", "interested-specific", "not-interested", "asked-to-email-info"],
        likelyOutcomes: ["asked-to-send", "contact-collected", "not-interested"],
      };

    case "dm-unavailable":
      return {
        objective: "Get the address now, and a time worth calling back.",
        say: `No problem at all. Is there an email I could send it to in the meantime — and when's usually a good time to reach them?`,
        note: "Two asks, one breath. The address is the win; the callback time is the backup.",
        capture: ["generalEmail", "directEmail", "callbackWindow"],
        next: ["general-email", "direct-email", "busy-callback", "asked-to-email-info", "not-interested", "end-call"],
        likelyOutcomes: ["contact-collected", "follow-up"],
      };

    case "busy-callback":
      return {
        objective: "Pin a time and get off the phone politely.",
        say: `Totally understand — I won't keep you. When's a better time to try you? I'll keep it to two minutes.`,
        note: "Respect the brush-off and it becomes an appointment.",
        capture: ["callbackWindow"],
        next: ["general-email", "direct-email", "end-call", "not-interested"],
        likelyOutcomes: ["follow-up", "contact-collected"],
      };

    // THE ADDRESS — the distinction between having one and being allowed to use it
    // is the whole ethical core of this system, so the script keeps them separate.
    case "general-email":
      return {
        objective: "Turn an address into permission.",
        say: o.lines.gatekept,
        note: "An address is not a yes. Ask, and tap what they actually say.",
        capture: ["generalEmail", "contactName"],
        next: ["permission-granted", "email-no-permission", "asked-what-this-is", "not-interested", "end-call"],
        likelyOutcomes: ["asked-to-send", "contact-collected"],
      };

    case "direct-email":
      return {
        objective: "Confirm the address and who it belongs to, then ask.",
        say: `Great, thank you — let me read that back to make sure I have it right. And is it alright if I send it there?`,
        note: "Read the address back. A typo here loses the whole call.",
        capture: ["directEmail", "contactName", "contactRole"],
        next: ["permission-granted", "email-no-permission", "wants-meeting", "interested-specific", "not-interested", "end-call"],
        likelyOutcomes: ["asked-to-send", "contact-collected", "reached-dm"],
      };

    case "permission-granted":
      return {
        objective: "Close cleanly and get off the phone.",
        say: `Perfect, thank you. I'll send it over today. If anything in it is useful we can talk it through, and if not, no hard feelings at all.`,
        note: "You got what you called for. Don't keep selling — end the call warm and short.",
        capture: ["directEmail", "generalEmail", "contactName", "notes"],
        next: ["wants-meeting", "interested-broader", "interested-specific", "end-call"],
        likelyOutcomes: ["asked-to-send"],
      };

    case "email-no-permission":
      return {
        objective: "Leave honestly. Do not treat the address as a yes.",
        say: `No problem at all — I'll hold off until it's welcome. Thanks for your time.`,
        note: "We have the address but NOT permission. Saving this keeps the lead call-first; nothing is emailed.",
        capture: ["generalEmail", "directEmail", "notes"],
        next: ["busy-callback", "end-call", "not-interested"],
        likelyOutcomes: ["contact-collected"],
      };

    case "asked-to-email-info":
      return {
        objective: "Take it — that IS the permission you called for.",
        say: `Happy to. What's the best address to send it to?`,
        note: "\"Just email me\" is a yes. Get the address and confirm you may use it.",
        capture: ["generalEmail", "directEmail"],
        next: ["general-email", "direct-email", "permission-granted", "end-call"],
        likelyOutcomes: ["asked-to-send", "contact-collected"],
      };

    // INTEREST — what we made is the door, not the ceiling. Only after value is real
    // does it make sense to mention that we build software, not just websites.
    case "interested-specific":
      return {
        objective: "Capture the specific problem in their words.",
        say: `That's really useful to know — tell me a bit more about how that shows up day to day. I'll make sure what I send speaks to it.`,
        note: "Write down their words, not your paraphrase. This is what makes the follow-up land.",
        capture: ["interest", "notes"],
        next: ["permission-granted", "direct-email", "general-email", "wants-meeting", "end-call"],
        likelyOutcomes: ["reached-dm", "asked-to-send"],
      };

    case "interested-broader":
      return {
        objective: "Let them describe the operational problem. Don't scope it on the phone.",
        say: `That's the kind of thing we actually do most — custom tools, automation, systems that take the manual work out. Tell me what's eating the most time right now and I'll include some thoughts.`,
        note: "Now it's fair to say we build software, not just websites. Still: listen, don't pitch.",
        capture: ["interest", "notes"],
        next: ["wants-meeting", "permission-granted", "direct-email", "general-email", "end-call"],
        likelyOutcomes: ["reached-dm", "asked-to-send"],
      };

    case "wants-meeting":
      return {
        objective: "Get the address, send it over, and let it set up the meeting.",
        say: `I'd like that. Let me send it over first so you've seen it, then we can find fifteen minutes. What's the best email?`,
        note: "What you send does the pre-selling. Don't book blind.",
        capture: ["directEmail", "contactName", "contactRole", "notes"],
        next: ["direct-email", "permission-granted", "end-call"],
        likelyOutcomes: ["reached-dm", "asked-to-send"],
      };

    // LANGUAGE — a real barrier, handled with respect and without pretending.
    case "spanish":
      return {
        objective: "Ask for an email or an English speaker — kindly, in their language.",
        say: `Disculpe, hablo muy poco español. ¿Hay un correo electrónico donde puedo enviar información? ¿O alguien que hable inglés?`,
        note: "Say only this much. Don't improvise Spanish you don't have — write it down and get language support for the follow-up.",
        capture: ["generalEmail"],
        next: ["general-email", "transferred-to-english", "no-english-contact", "callback-with-language-support", "end-call"],
        likelyOutcomes: ["contact-collected", "follow-up"],
      };

    case "other-language":
      return {
        objective: "Find a shared channel — usually email.",
        say: `I'm sorry — I don't speak the language well. Is there an email address I could send information to?`,
        note: "Record which language you met, so the next attempt is prepared instead of surprised.",
        capture: ["languageOther", "generalEmail"],
        next: ["general-email", "transferred-to-english", "no-english-contact", "callback-with-language-support", "end-call"],
        likelyOutcomes: ["contact-collected", "follow-up"],
      };

    case "transferred-to-english":
      return {
        objective: "Start again, briefly — this person hasn't heard any of it.",
        say: o.lines.transferred,
        note: "The barrier is cleared. Treat this as a fresh, warm opening.",
        capture: ["contactName"],
        next: ["general-email", "direct-email", "permission-granted", "dm-answered", "asked-what-this-is", "not-interested"],
        likelyOutcomes: ["asked-to-send", "contact-collected", "reached-dm"],
      };

    case "no-english-contact":
      return {
        objective: "Close politely and flag it for language support.",
        say: `No problem at all — thank you for your time. Gracias.`,
        note: "Saving this records the language and schedules a call back with support. Nothing is marked as a rejection.",
        capture: ["callbackWindow", "notes"],
        next: ["callback-with-language-support", "end-call"],
        likelyOutcomes: ["follow-up"],
      };

    case "callback-with-language-support":
      return {
        objective: "Book the retry, with help.",
        say: `Thank you — I'll try again another time.`,
        note: "The follow-up is tagged as needing language support, so it isn't repeated blind.",
        capture: ["callbackWindow", "notes"],
        next: ["end-call"],
        likelyOutcomes: ["follow-up"],
      };

    // NOBODY PICKED UP
    case "no-answer":
      return {
        objective: "Decide whether there's a voicemail worth leaving.",
        say: `(Nobody picked up — check whether it rings to a mailbox.)`,
        note: "Many small businesses have no voicemail at all. That's information, not a failure.",
        capture: [],
        next: ["voicemail-available", "no-voicemail", "mailbox-full", "wrong-number", "end-call"],
        likelyOutcomes: ["no-answer", "voicemail"],
      };

    case "voicemail-available":
      return {
        objective: "Leave a short, specific message.",
        say: o.lines.voicemail,
        note: "Name the business, name the value, give one easy action. Under twenty seconds.",
        capture: ["notes"],
        next: ["end-call"],
        likelyOutcomes: ["voicemail"],
      };

    case "no-voicemail":
    case "mailbox-full":
      return {
        objective: "Nothing to leave — record it and try again.",
        say: `(No message could be left.)`,
        note: last === "mailbox-full" ? "A full mailbox usually means they don't check it. Prefer another channel next time." : "No voicemail available — worth noting so nobody expects a call back.",
        capture: ["notes"],
        next: ["end-call"],
        likelyOutcomes: ["no-answer"],
      };

    // ENDINGS
    case "not-interested":
      return {
        objective: "Leave gracefully. Do not handle the objection.",
        say: `Completely fair — I appreciate you taking the call. I'll leave it there. Have a good rest of your day.`,
        note: "No second ask. A clean exit is worth more than a salvaged call.",
        capture: ["notes"],
        next: ["end-call"],
        likelyOutcomes: ["not-interested"],
      };

    case "wrong-number":
      return {
        objective: "Confirm and stop dialing this number.",
        say: `Ah — my apologies, I must have the wrong number. Thank you, and sorry to bother you.`,
        note: "The lead survives; only the number is wrong.",
        capture: ["notes"],
        next: ["end-call"],
        likelyOutcomes: ["wrong-number"],
      };

    case "closed-invalid":
      return {
        objective: "Confirm and close the lead.",
        say: `Thank you — I appreciate you letting me know.`,
        note: "This disqualifies the business so nobody calls it again.",
        capture: ["notes"],
        next: ["end-call"],
        likelyOutcomes: ["business-closed"],
      };

    case "end-call":
      return {
        objective: "Record what happened.",
        say: `(Call ended.)`,
        note: been("permission-granted")
          ? "You earned permission — saving this queues it to send."
          : "Review the outcome below, then save it once.",
        capture: ["notes"],
        next: [],
        likelyOutcomes: [deriveOutcome({ path, captured: {} }).outcome],
      };
  }
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// ── Deriving the committed outcome ───────────────────────────────────────────
// The nine outcomes are unchanged — the assistant guides TOWARD them rather than
// replacing them. Precedence runs from the most consequential signal downward, so
// a path that ends "…permission granted → end call" commits as permission even
// though "end call" was the last tap.

export interface DerivedOutcome {
  outcome: CallOutcome;
  voicemail: VoicemailStatus | null;
  /** The address to save, if one was given. */
  email: string | null;
  /** True only when they explicitly agreed we may send. */
  permission: boolean;
  /** Why this outcome — shown before committing so it is never a surprise. */
  because: string;
}

export function deriveOutcome(s: Pick<CallSession, "path" | "captured">): DerivedOutcome {
  const p = s.path;
  const been = (e: CallEvent) => p.includes(e);
  const email = (s.captured.directEmail || s.captured.generalEmail || "").trim() || null;

  const vm: VoicemailStatus | null = been("voicemail-available")
    ? "left"
    : been("mailbox-full")
      ? "mailbox-full"
      : been("no-voicemail")
        ? "none-available"
        : null;

  // Hard closes first — these end the lead regardless of what came before.
  if (been("closed-invalid")) return { outcome: "business-closed", voicemail: vm, email, permission: false, because: "The business is closed or the listing is invalid." };
  if (been("wrong-number")) return { outcome: "wrong-number", voicemail: vm, email, permission: false, because: "This number doesn't reach the business." };
  if (been("not-interested")) return { outcome: "not-interested", voicemail: vm, email, permission: false, because: "They declined." };

  // Permission is the win condition.
  if (been("permission-granted") || been("asked-to-email-info")) {
    return { outcome: "asked-to-send", voicemail: vm, email, permission: true, because: email ? "They agreed to receive it at the address you captured." : "They agreed to receive it — capture the address to send it." };
  }

  // An address WITHOUT permission is contact intelligence, never a licence to send.
  if (been("email-no-permission") || been("general-email") || been("direct-email")) {
    return { outcome: "contact-collected", voicemail: vm, email, permission: false, because: "You have an address but not permission — nothing will be emailed." };
  }

  // A real conversation with the right person, but no address yet.
  if (been("dm-answered") || been("wants-meeting") || been("interested-broader") || been("interested-specific")) {
    return { outcome: "reached-dm", voicemail: vm, email, permission: false, because: "You spoke with the decision-maker; a follow-up call is scheduled." };
  }

  // Voicemail states.
  if (been("voicemail-available")) return { outcome: "voicemail", voicemail: "left", email, permission: false, because: "A voicemail was left." };
  if (been("no-voicemail") || been("mailbox-full")) return { outcome: "no-answer", voicemail: vm, email, permission: false, because: "Nobody answered and no message could be left." };

  // Someone was there but we couldn't get to the point yet.
  if (been("busy-callback") || been("dm-unavailable") || been("no-english-contact") || been("callback-with-language-support") || been("transfer-failed") || been("spanish") || been("other-language") || been("transferred-to-english") || been("reception-answered") || been("transferred") || been("on-hold") || been("asked-what-this-is")) {
    return { outcome: "follow-up", voicemail: vm, email, permission: false, because: "The conversation didn't resolve — a call back is scheduled." };
  }

  if (been("no-answer")) return { outcome: "no-answer", voicemail: vm, email, permission: false, because: "Nobody picked up." };

  return { outcome: "no-answer", voicemail: vm, email, permission: false, because: "No conversation was recorded." };
}

// ── Structured intelligence ──────────────────────────────────────────────────
// What we LEARNED, as facts rather than prose. A free-text summary can't be queried,
// counted, or acted on later; these can. Deliberately small — this is not a CRM.

export interface CallFact {
  key: string;
  value: string | boolean;
}

export interface CallIntelligence {
  facts: CallFact[];
  /** Language met on the call, when there was a barrier. */
  language: { code: "spanish" | "other"; detail?: string; resolved: boolean; needsSupport: boolean } | null;
  /** A transfer BETWEEN PEOPLE AT THE BUSINESS — unrelated to operator ownership. */
  transfer: { occurred: boolean; to: string; name?: string; succeeded: boolean } | null;
  /** When they said to try again, in their words. */
  callbackWindow: string | null;
  /** Verified route + whether we may actually use it. */
  emailKind: "general" | "direct" | null;
  permission: boolean;
  /** What they told us they care about, in their words. */
  interests: string[];
}

export function deriveIntelligence(s: Pick<CallSession, "path" | "captured">): CallIntelligence {
  const p = s.path;
  const c = s.captured;
  const been = (e: CallEvent) => p.includes(e);
  const facts: CallFact[] = [];

  if (been("transferred")) facts.push({ key: "reception.routes-inquiries", value: true });
  if (been("reception-answered")) facts.push({ key: "reception.answers-phone", value: true });
  if (been("dm-answered")) facts.push({ key: "decision-maker.reachable-by-phone", value: true });
  if (been("general-email")) facts.push({ key: "email.general-verified", value: c.generalEmail?.trim() || true });
  if (been("direct-email")) facts.push({ key: "email.direct-verified", value: c.directEmail?.trim() || true });
  if (been("permission-granted") || been("asked-to-email-info")) facts.push({ key: "permission.may-send-review", value: true });
  if (been("email-no-permission")) facts.push({ key: "permission.withheld", value: true });
  if (been("no-voicemail")) facts.push({ key: "voicemail.none-available", value: true });
  if (been("mailbox-full")) facts.push({ key: "voicemail.mailbox-full", value: true });
  if (been("wants-meeting")) facts.push({ key: "interest.wants-meeting", value: true });
  if (been("interested-broader")) facts.push({ key: "interest.operational-systems", value: true });
  if (been("interested-specific")) facts.push({ key: "interest.specific-issue", value: c.interest?.trim() || true });
  if (c.callbackWindow?.trim()) facts.push({ key: "callback.preferred-window", value: c.callbackWindow.trim() });
  if (c.contactRole) facts.push({ key: "contact.role", value: c.contactRole });

  const langCode: "spanish" | "other" | null = been("spanish") ? "spanish" : been("other-language") ? "other" : null;
  const language = langCode
    ? {
        code: langCode,
        detail: langCode === "other" ? c.languageOther?.trim() || undefined : undefined,
        resolved: been("transferred-to-english"),
        needsSupport: been("no-english-contact") || been("callback-with-language-support") || !been("transferred-to-english"),
      }
    : null;
  if (language) {
    facts.push({ key: "language.encountered", value: language.detail || language.code });
    if (language.needsSupport) facts.push({ key: "language.support-needed", value: true });
  }

  const transfer = been("transferred") || been("transfer-failed")
    ? { occurred: true, to: c.transferTo ?? "unknown", name: c.transferName?.trim() || undefined, succeeded: been("transferred") && !been("transfer-failed") }
    : null;

  const interests: string[] = [];
  if (c.interest?.trim()) interests.push(c.interest.trim());

  return {
    facts,
    language,
    transfer,
    callbackWindow: c.callbackWindow?.trim() || null,
    emailKind: been("direct-email") ? "direct" : been("general-email") ? "general" : null,
    permission: been("permission-granted") || been("asked-to-email-info"),
    interests,
  };
}

/** The breadcrumb, in words — used in the committed note so the history reads like
 *  what actually happened rather than a code. */
export function describePath(path: CallEvent[]): string {
  return path.map((e) => EVENT_LABEL[e]).join(" → ");
}
