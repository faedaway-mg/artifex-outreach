// ─────────────────────────────────────────────────────────────────────────────
// Pure counter-test reasoning: keyword sets, scheduler/payment host lists, the
// action↔text matcher, and the verdict decision. No browser here so it is fully
// unit-testable; counter-test.ts feeds it the observed signals.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  ProblemHypothesis, ProblemRealityStatus, PrimaryCustomerAction,
  DefectSeverity, DefectMitigation, Materiality, DefectObservation,
} from "./types";

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
  /** A reproducible FAILURE of the intended surface observed in this viewport —
   *  a dead/erroring destination, a broken control, a malformed contact link.
   *  This is a defect FACT; an alternate path does not erase it. */
  deadPath?: { family: string; detail: string };
  /** Marks the observed defect as merely cosmetic (materiality FAIL candidate). */
  cosmetic?: boolean;
}

export interface VerdictDecision {
  verdict: ProblemRealityStatus;
  rationale: string;
  /** Set only when verdict is PROVEN. */
  defect?: DefectObservation | null;
  severity?: DefectSeverity;
  mitigation?: DefectMitigation;
  materiality?: Materiality;
}

// Actions whose failure plausibly interferes with a meaningful customer/business
// function (lead capture, booking, contact, purchase, navigation to an important
// action). A defect here clears the materiality threshold; a cosmetic/non-click
// defect does not.
const MATERIAL_ACTIONS: ReadonlySet<PrimaryCustomerAction> = new Set([
  "booking", "appointment", "contact", "quote", "forms",
  "service-location-selection", "cta-availability", "navigation", "mobile-interaction",
]);

/** Impact of a defect given the best available alternate path. An alternate path
 *  REDUCES impact (mitigation), it never erases the defect. */
function gradeImpact(opts: { anyOnline: boolean; anyPhone: boolean; anyEmail: boolean; anyForm: boolean }): { mitigation: DefectMitigation; severity: DefectSeverity } {
  const strong = opts.anyOnline || opts.anyPhone;          // a reliable way to still reach the goal
  const partial = !strong && (opts.anyEmail || opts.anyForm);
  const mitigation: DefectMitigation = strong ? "STRONG" : partial ? "PARTIAL" : "NONE";
  const severity: DefectSeverity = mitigation === "STRONG" ? "LOW" : mitigation === "PARTIAL" ? "MEDIUM" : "HIGH";
  return { mitigation, severity };
}

/**
 * Decide the Problem-Reality verdict AND its orthogonal dimensions.
 *
 * DEFECT FIRST — the corrected semantics: counter-testing answers "does the
 * SPECIFIC hypothesized defect actually occur?", NOT "can the customer reach the
 * goal by any other means?". So:
 *
 *  • A reproducible FAILURE of the intended surface (deadPath / dead-destination /
 *    broken control / malformed contact link), OR a site that loaded and offers NO
 *    usable path at all ⇒ PROVEN. An alternate path (phone/email/another page)
 *    becomes MITIGATION + lowers SEVERITY; it does NOT flip the verdict to DISPROVEN.
 *  • Only when the intended surface WORKS (a usable online path, or a present
 *    contact form/phone/email with no observed defect) ⇒ DISPROVEN.
 *  • booking/appointment with only a phone fallback and no observed defect and no
 *    online path ⇒ OBSERVED (a specific observable condition, not a provable defect).
 *  • A candidate existed but couldn't be confirmed ⇒ NEEDS_MORE_EVIDENCE.
 *  • Site never loaded ⇒ NEEDS_MORE_EVIDENCE.
 */
export function decideVerdict(h: ProblemHypothesis, signals: ProbeSignal[]): VerdictDecision {
  const loaded = signals.filter((s) => s.loaded);
  if (loaded.length === 0) return { verdict: "NEEDS_MORE_EVIDENCE", rationale: "Site did not load in any viewport; could not attempt to disprove the claim." };

  const action = h.primaryCustomerAction;
  const anyPhone = loaded.some((s) => s.phonePath);
  const anyEmail = loaded.some((s) => s.emailPath);
  const anyForm = loaded.some((s) => s.formPath);
  const anyOnline = loaded.some((s) => s.onlinePath || s.widget);

  // 1) REPRODUCIBLE DEFECT on the intended surface ⇒ PROVEN (regardless of any
  //    alternate path). The alternate path is recorded as mitigation, not as a
  //    reason to disbelieve the defect.
  const defectSignals = loaded.filter((s) => s.deadPath);
  if (defectSignals.length > 0) {
    const viewports = signalViewports(signals, defectSignals);
    const first = defectSignals[0].deadPath!;
    const cosmetic = defectSignals.some((s) => s.cosmetic) || !MATERIAL_ACTIONS.has(action);
    const { mitigation, severity } = gradeImpact({ anyOnline, anyPhone, anyEmail, anyForm });
    const materiality: Materiality = cosmetic ? "FAIL" : "PASS";
    const defect: DefectObservation = { family: first.family, detail: first.detail, viewports };
    const mitNote = mitigation === "NONE" ? "no alternate path" : `alternate path present (mitigation ${mitigation})`;
    return {
      verdict: "PROVEN",
      rationale: `Reproducible ${first.family} defect on the intended "${action}" path: ${first.detail}. ${mitNote}; the defect itself is real and reproducible.`,
      defect, severity, mitigation, materiality,
    };
  }

  // 2) The intended surface WORKS ⇒ DISPROVEN (the claim is false). This includes
  //    a confirmed online path, and — for contact/quote/forms — a present phone/
  //    email/form with no observed defect (test #3: working form + phone ⇒ DISPROVEN).
  if (anyOnline) return { verdict: "DISPROVEN", rationale: `A usable online path for "${action}" was found during live interaction — the claimed problem is false.` };

  if ((action === "contact" || action === "quote" || action === "forms") && (anyPhone || anyEmail || anyForm)) {
    return { verdict: "DISPROVEN", rationale: `A working ${action} path exists (${anyForm ? "an on-page form" : anyPhone ? "a phone number" : "email"}) and no defect was reproduced on it — the claim is false.` };
  }

  // 3) booking/appointment, no online path, no observed defect, phone fallback ⇒
  //    OBSERVED. Missing online booking is a specific observable condition, not a
  //    provable defect (test: missing online booking + phone only ⇒ NOT PROVEN).
  if ((action === "booking" || action === "appointment") && anyPhone) {
    return { verdict: "OBSERVED", rationale: "No online booking path was found on the site; the business is reachable by phone, and no reproducible defect was observed. A specific observable condition, not a provable material defect — appropriate for a hedged conversation, not a fix claim." };
  }

  const anyCandidate = loaded.some((s) => s.candidatePath || s.bodyMentions);
  if (anyCandidate) return { verdict: "NEEDS_MORE_EVIDENCE", rationale: `The site references "${action}" but a working path could not be confirmed by interaction — needs a closer look.` };

  // 4) Loaded, searched everywhere, NO usable path AND no fallback at all ⇒ a
  //    reproducibly broken customer journey ⇒ PROVEN (mitigation NONE).
  const defect: DefectObservation = {
    family: "no-path",
    detail: `Loaded and searched header, mobile menu, footer and body across desktop and mobile — no usable path for "${action}" and no phone/email/form fallback exists.`,
    viewports: signalViewports(signals, loaded),
  };
  const materiality: Materiality = MATERIAL_ACTIONS.has(action) ? "PASS" : "FAIL";
  return {
    verdict: "PROVEN",
    rationale: defect.detail + " Reproducible material problem.",
    defect, severity: "HIGH", mitigation: "NONE", materiality,
  };
}

/** Map the signals that carried a condition back to viewport labels (desktop first). */
function signalViewports(all: ProbeSignal[], subset: ProbeSignal[]): Array<"desktop" | "mobile"> {
  const out: Array<"desktop" | "mobile"> = [];
  // signals array is ordered [desktop, mobile] by the executor.
  const idx = new Set(subset.map((s) => all.indexOf(s)));
  if (idx.has(0)) out.push("desktop");
  if (idx.has(1)) out.push("mobile");
  return out.length ? out : ["desktop"];
}
