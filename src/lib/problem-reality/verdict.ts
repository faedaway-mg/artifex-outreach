// ─────────────────────────────────────────────────────────────────────────────
// Pure counter-test reasoning: keyword sets, scheduler/payment host lists, the
// action↔text matcher, and the verdict decision. No browser here so it is fully
// unit-testable; counter-test.ts feeds it the observed signals.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemHypothesis, ProblemRealityStatus, PrimaryCustomerAction } from "./types";

export const KEYWORDS: Record<PrimaryCustomerAction, string[]> = {
  booking: ["book", "booking", "book now", "book online", "reserve", "reservation", "book appointment"],
  appointment: ["appointment", "schedule", "scheduling", "book", "consultation", "consult", "reserve", "make an appointment"],
  contact: ["contact", "contact us", "get in touch", "reach us", "message us", "email us", "send us a message"],
  quote: ["quote", "get a quote", "request a quote", "free quote", "estimate", "free estimate", "get pricing", "request pricing"],
  navigation: ["menu", "home", "services", "about", "products"],
  "mobile-interaction": ["menu", "book", "contact", "call", "appointment"],
  forms: ["submit", "send", "contact", "message", "request"],
  "service-location-selection": ["location", "locations", "find a location", "select location", "choose location", "zip", "postal", "service area", "near you"],
  "cta-availability": ["book", "contact", "get started", "request", "call", "schedule", "shop", "order", "get a quote", "sign up"],
  "non-interactive": [],
};

// Third-party scheduler/booking widgets — presence of one is a strong "online
// booking path exists" signal (⇒ a "no booking" claim is DISPROVEN).
export const BOOKING_HOSTS = [
  "calendly.com", "acuityscheduling.com", "app.acuityscheduling", "squareup.com", "square.site",
  "mindbodyonline.com", "vagaro.com", "booker.com", "schedulicity.com", "setmore.com", "janeapp.com",
  "zenoti.com", "joinblvd.com", "boulevard", "gettimely.com", "timelyapp", "appointy.com",
  "simplybook.me", "fresha.com", "nexhealth.com", "localmed.com", "zocdoc.com", "getpetdesk.com",
  "booksy.com", "genbook.com", "10to8.com", "youcanbook.me", "picktime.com", "cal.com",
  // Med-spa / salon / clinic scheduling platforms.
  "meevo.com", "mangomint.com", "aestheticrecord.com", "aestheticspro.com", "symplast", "rosy",
  "phorest.com", "getweave.com", "solutionreach.com", "podium.com/booking", "tebra.com", "kareo.com",
];

// Never complete these — close/skip anything heading to checkout/payment.
export const PAYMENT_HOSTS = [
  "checkout.stripe.com", "paypal.com/checkout", "squareup.com/checkout", "shop.", "/checkout", "/cart", "/payment",
];

function matcher(keywords: string[]): RegExp | null {
  if (!keywords.length) return null;
  const esc = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${esc.join("|")})\\b`, "i");
}
const MATCHERS: Partial<Record<PrimaryCustomerAction, RegExp | null>> = {};

export function actionMatchesText(action: PrimaryCustomerAction, text: string): boolean {
  if (!text) return false;
  if (!(action in MATCHERS)) MATCHERS[action] = matcher(KEYWORDS[action] ?? []);
  const re = MATCHERS[action];
  return re ? re.test(text) : false;
}

export interface ProbeSignal {
  loaded: boolean;
  onlinePath?: boolean;    // a usable online path to complete the action was found
  candidatePath?: boolean; // a matching control exists but wasn't confirmed usable
  widget?: boolean;        // scheduler widget present
  phonePath?: boolean;     // tel: link present
  emailPath?: boolean;     // mailto: link present
  formPath?: boolean;      // an on-page form that could serve the action
  bodyMentions?: boolean;  // the action is mentioned in body copy
}

/**
 * Decide the Problem-Reality verdict from the per-viewport signals.
 *
 *  • Any usable ONLINE path (link/page/form/widget) ⇒ DISPROVEN — the claim is false.
 *  • Action achievable only OFFLINE (phone/email): DISPROVEN for contact/quote
 *    (that IS a contact/quote path); NO_MATERIAL_PROBLEM for booking/appointment
 *    (bookable by phone ⇒ no material online failure worth paying to fix).
 *  • Loaded, thoroughly searched, NO path at all ⇒ PROVEN (reproducible).
 *  • A candidate existed but couldn't be confirmed ⇒ NEEDS_MORE_EVIDENCE.
 *  • Site never loaded ⇒ NEEDS_MORE_EVIDENCE (can't disprove or prove).
 */
export function decideVerdict(h: ProblemHypothesis, signals: ProbeSignal[]): { verdict: ProblemRealityStatus; rationale: string } {
  const loaded = signals.filter((s) => s.loaded);
  if (loaded.length === 0) return { verdict: "NEEDS_MORE_EVIDENCE", rationale: "Site did not load in any viewport; could not attempt to disprove the claim." };

  const anyOnline = loaded.some((s) => s.onlinePath || s.widget);
  if (anyOnline) return { verdict: "DISPROVEN", rationale: `A usable online path for "${h.primaryCustomerAction}" was found during live interaction — the claimed problem is false.` };

  const anyPhone = loaded.some((s) => s.phonePath);
  const anyEmail = loaded.some((s) => s.emailPath);
  const anyForm = loaded.some((s) => s.formPath);
  const action = h.primaryCustomerAction;

  if ((action === "contact" || action === "quote" || action === "forms") && (anyPhone || anyEmail || anyForm)) {
    return { verdict: "DISPROVEN", rationale: `The customer can ${action === "quote" ? "request a quote" : "make contact"} via ${anyForm ? "an on-page form" : anyPhone ? "a phone number" : "email"} — the claim is false.` };
  }
  if ((action === "booking" || action === "appointment") && (anyPhone)) {
    // A SPECIFIC observable condition — no online booking path on the site — with an
    // offline fallback (phone). We cannot prove from outside that this is defective,
    // unintended, or costing them anything, so it is NOT a PROVEN defect. It IS a
    // genuine, business-specific observation suitable for a truthful, hedged
    // CONVERSATION ("I noticed there's no way to book online — can't tell if that's
    // intentional"). This is OBSERVED, never a defect claim.
    return { verdict: "OBSERVED", rationale: "No online booking path was found on the site; the business is reachable by phone. A specific observable condition, not a provable material defect — appropriate for a hedged conversation, not a fix claim." };
  }

  const anyCandidate = loaded.some((s) => s.candidatePath || s.bodyMentions);
  if (anyCandidate) return { verdict: "NEEDS_MORE_EVIDENCE", rationale: `The site references "${action}" but a working path could not be confirmed by interaction — needs a closer look.` };

  return { verdict: "PROVEN", rationale: `Loaded and searched header, mobile menu, footer and body across desktop and mobile — no usable path for "${action}" exists. Reproducible material problem.` };
}
