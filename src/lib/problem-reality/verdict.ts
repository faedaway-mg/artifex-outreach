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

// Known cross-origin CONTACT/LEAD FORM providers. An iframe pointed at one of these
// is a customer-facing form path even though same-origin DOM inspection cannot see
// its <form> (River Dental's blind spot: forms.variable.systems). Presence ⇒ a path
// exists ⇒ a "no contact/booking path" claim cannot be PROVEN.
export const FORM_HOSTS = [
  "forms.variable.systems", "variable.systems", "jotform.com", "jotform.co", "form.jotform",
  "typeform.com", "hsforms.com", "hs-sites.com", "hubspotusercontent", "js.hsforms",
  "wufoo.com", "formstack.com", "gravityforms", "cognitoforms.com", "123formbuilder.com",
  "formsite.com", "paperform.co", "docs.google.com/forms", "forms.gle", "forms.office.com",
  "mailchimp.com", "list-manage.com", "constantcontact.com", "getweave.com", "podium.com",
  "birdeye.com", "solutionreach.com", "revenuewell", "yapi", "flexbook", "gogaddy", "leadconnectorhq",
];

// Iframes that are clearly NOT a contact/booking form (maps, video, analytics, ads,
// social, captcha). These never count as a path — and never block a no-path verdict.
export const NON_FORM_IFRAME_HOSTS = [
  "google.com/maps", "maps.google", "maps.googleapis", "youtube.com", "youtube-nocookie",
  "youtu.be", "vimeo.com", "player.vimeo", "googletagmanager", "google-analytics",
  "doubleclick", "googlesyndication", "adservice", "facebook.com/plugins", "instagram.com",
  "twitter.com", "platform.twitter", "x.com", "recaptcha", "gstatic.com/recaptcha",
  "hcaptcha", "spotify.com", "soundcloud.com", "yelp.com/biz", "tripadvisor",
];

/**
 * Classify an iframe src for form/booking-path purposes.
 *  • "confirmed"  — a known form/booking provider ⇒ a real customer-facing path.
 *  • "possible"   — a cross-origin iframe we cannot inspect that looks form-ish ⇒
 *                   must PREVENT a no-path PROVEN (route to NEEDS_MORE_EVIDENCE).
 *  • "non-form"   — maps/video/analytics/ads/social/captcha ⇒ ignore for paths.
 */
export function classifyIframe(src: string): "confirmed" | "possible" | "non-form" {
  const u = (src || "").toLowerCase();
  if (!u) return "non-form";
  if (NON_FORM_IFRAME_HOSTS.some((h) => u.includes(h))) return "non-form";
  if (FORM_HOSTS.some((h) => u.includes(h)) || BOOKING_HOSTS.some((h) => u.includes(h))) return "confirmed";
  if (/\b(form|contact|appoint|book|schedul|inquir|request|reserv|widget|embed|lead)\b/.test(u)) return "possible";
  return "non-form";
}

// Rendered-text North-American phone numbers. Groups MUST be separated (so a
// run-together 10-digit id or a "12345-6789" ZIP+4 won't match), and the match may
// not sit inside a longer digit run.
const PHONE_RX = /(?<![\d])(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?![\d])/g;

/** Normalize an NANP number to +1XXXXXXXXXX for de-dupe/storage. */
export function normalizePhone(digits: string): string {
  let d = digits.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `+1${d}` : "";
}

/**
 * Detect dialable phone numbers that appear as RENDERED TEXT (not tel: anchors) —
 * the River Dental blind spot. Reads visible innerText only, so scripts/JSON are
 * excluded. Guards reject dates, ZIP+4, repeated-digit placeholders, and numbers
 * with invalid NANP area/exchange leading digits.
 */
export function detectRenderedPhones(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(PHONE_RX)) {
    const norm = normalizePhone(m[0]);
    if (!norm) continue;
    const d = norm.slice(2); // strip +1
    if (/^(\d)\1{9}$/.test(d)) continue;                 // 0000000000, 1111111111 …
    const area = d.slice(0, 3), exch = d.slice(3, 6);
    if (area[0] === "0" || area[0] === "1") continue;    // invalid NANP area code
    if (exch[0] === "0" || exch[0] === "1") continue;    // invalid exchange code
    found.add(norm);
  }
  return [...found];
}

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

/** How completely the evidence harvester was able to inspect the surface. A
 *  NO-PATH defect may only become PROVEN from a COMPLETE harvest — PARTIAL/BLOCKED
 *  fails closed to NEEDS_MORE_EVIDENCE. */
export type HarvestCompleteness = "COMPLETE" | "PARTIAL" | "BLOCKED";

/** Separated tracking of how the probe itself fared, so a raw-fetch/WAF failure can
 *  never override a successful browser render. */
export type ProbeStatus = "BROWSER_SUCCESS" | "HTTP_FETCH_BLOCKED" | "BOT_CHALLENGE" | "INDETERMINATE";

export interface ProbeSignal {
  loaded: boolean;
  onlinePath?: boolean;    // a usable online path to complete the action was found
  candidatePath?: boolean; // a matching control exists but wasn't confirmed usable
  widget?: boolean;        // scheduler widget present
  phonePath?: boolean;     // tel: link present
  phoneText?: boolean;     // dialable phone present as RENDERED TEXT (no tel: anchor)
  emailPath?: boolean;     // mailto: link present
  formPath?: boolean;      // an on-page form that could serve the action
  /** Cross-origin embedded form signal: "confirmed" (known provider) or "possible"
   *  (form-ish iframe we cannot inspect). Either one blocks a no-path PROVEN. */
  iframeForm?: "confirmed" | "possible";
  bodyMentions?: boolean;  // the action is mentioned in body copy
  /** Affirmative evidence the intended path is meant to exist (a CTA/control/copy
   *  referencing the action). Required before "no path" can be PROVEN. */
  pathIntended?: boolean;
  /** How complete this viewport's harvest was (fail-closed gate for no-path). */
  completeness?: HarvestCompleteness;
  /** How the probe fared for this viewport. */
  probeStatus?: ProbeStatus;
  /** Provenance of any detected phone signals (PHONE_LINK / PHONE_RENDERED_TEXT). */
  phoneProvenance?: string[];
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
  const action = h.primaryCustomerAction;

  // 0) The harvester never got a usable render in any viewport. A raw/HTTP failure
  //    or a bot challenge is NOT evidence of a missing path — fail closed.
  if (loaded.length === 0) {
    const blocked = signals.some((s) => s.probeStatus === "BOT_CHALLENGE" || s.probeStatus === "HTTP_FETCH_BLOCKED");
    return {
      verdict: "NEEDS_MORE_EVIDENCE",
      rationale: blocked
        ? "The site could not be inspected (bot-protection / access block); a failure to OBSERVE a path is not evidence a path is missing."
        : "Site did not load in any viewport; could not attempt to disprove the claim.",
    };
  }

  const anyPhone = loaded.some((s) => s.phonePath || s.phoneText);
  const anyEmail = loaded.some((s) => s.emailPath);
  const iframeConfirmed = loaded.some((s) => s.iframeForm === "confirmed");
  const iframePossible = loaded.some((s) => s.iframeForm === "possible");
  const anyForm = loaded.some((s) => s.formPath) || iframeConfirmed;
  const anyOnline = loaded.some((s) => s.onlinePath || s.widget) || iframeConfirmed;

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
  //    a confirmed online path (incl. a known cross-origin form/booking iframe), and
  //    — for contact/quote/forms — a present phone/email/form with no observed defect.
  if (anyOnline) return { verdict: "DISPROVEN", rationale: `A usable online path for "${action}" was found during live interaction${iframeConfirmed ? " (embedded form/scheduling provider present)" : ""} — the claimed problem is false.` };

  if ((action === "contact" || action === "quote" || action === "forms") && (anyPhone || anyEmail || anyForm)) {
    return { verdict: "DISPROVEN", rationale: `A working ${action} path exists (${anyForm ? "an on-page form" : anyPhone ? "a phone number" : "email"}) and no defect was reproduced on it — the claim is false.` };
  }

  // 3) booking/appointment, no online path, no observed defect, phone fallback ⇒
  //    OBSERVED. Missing online booking is a specific observable condition, not a
  //    provable defect (test: missing online booking + phone only ⇒ NOT PROVEN).
  if ((action === "booking" || action === "appointment") && anyPhone) {
    return { verdict: "OBSERVED", rationale: "No online booking path was found on the site; the business is reachable by phone, and no reproducible defect was observed. A specific observable condition, not a provable material defect — appropriate for a hedged conversation, not a fix claim." };
  }

  // 4) An UNRESOLVED cross-origin form-ish iframe means we could not see the path,
  //    not that it is missing. Never PROVEN off a blind spot ⇒ NEEDS_MORE_EVIDENCE.
  if (iframePossible) {
    return { verdict: "NEEDS_MORE_EVIDENCE", rationale: `A cross-origin embedded widget that may be a contact/booking form was present but could not be inspected — cannot conclude "no ${action} path" without seeing inside it.` };
  }

  const anyCandidate = loaded.some((s) => s.candidatePath || s.bodyMentions);
  if (anyCandidate && !loaded.some((s) => s.pathIntended)) {
    return { verdict: "NEEDS_MORE_EVIDENCE", rationale: `The site references "${action}" but a working path could not be confirmed by interaction — needs a closer look.` };
  }

  // 5) NO-PATH standard (tightened). "Not present" is not "broken." A no-path defect
  //    may become PROVEN only when the harvest was COMPLETE (browser rendered, dynamic
  //    content given a bounded chance, site-wide destinations checked, no unresolved
  //    widget) AND there is AFFIRMATIVE evidence the path is intended/required. Absent
  //    either, fail closed.
  const harvestComplete =
    loaded.some((s) => s.completeness === "COMPLETE") &&
    !loaded.some((s) => s.completeness === "BLOCKED") &&
    !signals.some((s) => s.probeStatus === "BOT_CHALLENGE" || s.probeStatus === "HTTP_FETCH_BLOCKED");
  const pathIntended = loaded.some((s) => s.pathIntended || s.candidatePath || s.bodyMentions);

  if (!harvestComplete) {
    return {
      verdict: "NEEDS_MORE_EVIDENCE",
      rationale: `Evidence collection was incomplete (harvest not COMPLETE) — a "no ${action} path" conclusion cannot be drawn from a partial/blocked inspection. Fail closed.`,
    };
  }
  if (!pathIntended) {
    // Fully inspected, genuinely nothing — but no affirmative evidence the business
    // intends this path. Pure absence is not a provable material defect.
    const material = MATERIAL_ACTIONS.has(action);
    return {
      verdict: material ? "OBSERVED" : "NO_MATERIAL_PROBLEM",
      rationale: `Inspected desktop + mobile (header, mobile menu, footer, body) and bounded same-site destinations; no "${action}" path was found, but nothing affirmatively indicates the business intends one here. Absence of a feature is not itself a defect — ${material ? "recorded as an observation, not a provable problem." : "not a material problem."}`,
    };
  }

  // 6) COMPLETE harvest + affirmative intent + reproducibly no usable path or fallback
  //    ⇒ PROVEN no-path (mitigation NONE).
  const defect: DefectObservation = {
    family: "no-path",
    detail: `Intended "${action}" path is referenced but, after a COMPLETE harvest (desktop + mobile: header, mobile menu, footer, body, and bounded same-site destinations), no usable path and no phone/email/form fallback exists.`,
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
