// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — SYNTHETIC USER PERSONAS + JOURNEYS (Release Orchestrator §3–§13).
//
// A DECLARATIVE, testable single-source-of-truth for the synthetic users Breakbot
// drives through the running release candidate. This module contains NO browser and
// NO I/O — it is the SCRIPT the Playwright harness (scripts/breakbot-journeys.ts)
// executes. Keeping it declarative means:
//   • the journeys are unit-testable (routes resolve, steps well-formed, safety held);
//   • the operator UI can render "what Breakbot checks" from the same data;
//   • a new escaped defect becomes a new step here, not scattered harness code.
//
// SAFETY (mandate §5/§10/§11/§12/§22/§32). Every journey is side-effect-free: no real
// purchase, no prospect email, no charge, no published social content, no paid-provider
// call. Forms are safe fixtures; state mutation only happens against isolated test
// fixtures. This is enforced structurally — a step may only use the safe action verbs.
// ─────────────────────────────────────────────────────────────────────────────

export type PersonaId =
  | "operator"
  | "prospect"
  | "quick-fix-customer"
  | "social-content-creator"
  | "fulfillment-operator"
  | "mobile-user";

export interface Persona {
  id: PersonaId;
  label: string;
  /** True → the journey needs an authenticated operator session; false → public capability. */
  authenticated: boolean;
  description: string;
  /** Conceptual capabilities this persona is allowed to exercise. */
  permissions: string[];
}

export const PERSONAS: Record<PersonaId, Persona> = {
  operator: {
    id: "operator",
    label: "Operator",
    authenticated: true,
    description: "A logged-in Artifex operator using Acquisition OS.",
    permissions: ["view-cockpit", "view-launch-readiness", "view-content-studio", "view-fulfillment", "view-explainer-qa", "preview-customer-portal"],
  },
  prospect: {
    id: "prospect",
    label: "Prospect",
    authenticated: false,
    description: "A recipient viewing an offer but making no real purchase.",
    permissions: ["view-offer", "play-personalized-video", "play-trust-video", "view-scope-and-price"],
  },
  "quick-fix-customer": {
    id: "quick-fix-customer",
    label: "Quick-Fix Customer",
    authenticated: false,
    description: "A simulated paying customer moving through portal states.",
    permissions: ["view-portal", "see-progress", "see-next-action"],
  },
  "social-content-creator": {
    id: "social-content-creator",
    label: "Social Content Creator",
    authenticated: true,
    description: "An operator commissioning a Content Studio social Field Note (zero-touch).",
    permissions: ["open-content-studio", "generate-field-note", "play-finished-video"],
  },
  "fulfillment-operator": {
    id: "fulfillment-operator",
    label: "Fulfillment Operator",
    authenticated: true,
    description: "An operator processing purchased work.",
    permissions: ["view-fulfillment-project", "see-scope-frozen", "see-tasks-blockers-evidence"],
  },
  "mobile-user": {
    id: "mobile-user",
    label: "Mobile User",
    authenticated: false,
    description: "A synthetic user operating critical flows at phone dimensions.",
    permissions: ["view-offer", "view-portal", "view-critical-flows"],
  },
};

// Safe action verbs only — a journey can never send/charge/publish. `expectAbsent`
// asserts hidden machinery (§10). `playMedia` exercises real playback (§2/§6).
export type JourneyAction =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "playMedia"
  | "back"
  | "openDrawer"
  | "expectVisible"
  | "expectText"
  | "expectAbsent"
  | "expectMediaHealthy";

export interface JourneyStep {
  action: JourneyAction;
  /** A route (starts with "/") or a stable test-id / selector. */
  target: string;
  /** Optional human note / expected value. */
  detail?: string;
}

// The mandate's mobile breakpoints (§13).
export const MOBILE_WIDTHS = [320, 375, 390, 430] as const;

export interface Journey {
  id: string;
  persona: PersonaId;
  title: string;
  mandateRef: string;
  viewport: "mobile" | "desktop";
  /** The entry route. Dynamic segments use a `:param` placeholder resolved from a fixture. */
  entryRoute: string;
  steps: JourneyStep[];
  /** Structural safety marker — every journey is read-only w.r.t. the real world. */
  sideEffectFree: true;
}

const OPERATOR_JOURNEY: Journey = {
  id: "operator-cockpit-sweep",
  persona: "operator",
  title: "Operator opens Acquisition OS and navigates the cockpit surfaces",
  mandateRef: "§4",
  viewport: "desktop",
  entryRoute: "/login",
  steps: [
    { action: "navigate", target: "/login" },
    { action: "type", target: "password", detail: "operator session (test credential)" },
    { action: "click", target: "login-submit" },
    { action: "navigate", target: "/", detail: "cockpit/home loads" },
    { action: "expectVisible", target: "app-shell" },
    { action: "navigate", target: "/launch/readiness", detail: "Launch Readiness loads" },
    { action: "expectVisible", target: "launch-readiness-gate" },
    { action: "expectVisible", target: "prospect-lanes", detail: "Google lane status renders" },
    { action: "expectVisible", target: "cost-gate" },
    { action: "navigate", target: "/launch/explainers", detail: "Explainer QA Gallery loads" },
    { action: "expectVisible", target: "explainer-coverage-summary" },
    { action: "navigate", target: "/launch/cockpit" },
    { action: "expectVisible", target: "cockpit" },
    { action: "navigate", target: "/content-studio", detail: "Content Studio loads" },
    { action: "navigate", target: "/revenue/fulfillment", detail: "Fulfillment loads" },
    { action: "expectAbsent", target: "legacy-lead-workspace", detail: "legacy junk not active" },
  ],
  sideEffectFree: true,
};

const PROSPECT_JOURNEY: Journey = {
  id: "prospect-offer-experience",
  persona: "prospect",
  title: "Prospect experiences the full customer-facing offer journey (no purchase)",
  mandateRef: "§5",
  viewport: "desktop",
  entryRoute: "/offer/:offerId",
  steps: [
    { action: "navigate", target: "/offer/:offerId", detail: "safe internal prospect fixture" },
    { action: "expectText", target: "company-name", detail: "correct company" },
    { action: "expectText", target: "finding-summary", detail: "correct finding" },
    { action: "playMedia", target: "personalized-video", detail: "personalized problem video" },
    { action: "expectMediaHealthy", target: "personalized-video", detail: "9:16 portrait, alive throughout" },
    { action: "scroll", target: "offer-details" },
    { action: "playMedia", target: "trust-video", detail: "trust/explainer video" },
    { action: "expectMediaHealthy", target: "trust-video", detail: "16:9 landscape, plays through the FULL runtime" },
    { action: "expectVisible", target: "scope-and-protections" },
    { action: "expectText", target: "price", detail: "consistent price, no contradiction" },
    { action: "expectVisible", target: "checkout-cta", detail: "CTA present when purchasable (no real purchase)" },
    { action: "expectAbsent", target: "internal-language", detail: "no raw links / internal/debug language / transcript-as-video" },
  ],
  sideEffectFree: true,
};

// §11 — three canonical customer portal scenarios.
const PORTAL_SUCCESS: Journey = {
  id: "portal-simple-success",
  persona: "quick-fix-customer",
  title: "Customer portal — simple success lifecycle",
  mandateRef: "§11A",
  viewport: "desktop",
  entryRoute: "/offer/:offerId/portal",
  steps: [
    { action: "navigate", target: "/offer/:offerId/portal", detail: "Order Confirmed → In Progress → Testing → Complete fixture" },
    { action: "expectVisible", target: "portal-scope" },
    { action: "expectVisible", target: "portal-progress" },
    { action: "expectVisible", target: "portal-timeline" },
    { action: "expectVisible", target: "portal-evidence" },
    { action: "expectVisible", target: "portal-completion" },
    { action: "expectAbsent", target: "internal-fields", detail: "never exposes internal/debug fields" },
  ],
  sideEffectFree: true,
};

const PORTAL_WAITING: Journey = {
  id: "portal-waiting-for-access",
  persona: "quick-fix-customer",
  title: "Customer portal — waiting for access",
  mandateRef: "§11B",
  viewport: "desktop",
  entryRoute: "/offer/:offerId/portal",
  steps: [
    { action: "navigate", target: "/offer/:offerId/portal", detail: "Order Confirmed → Waiting for Access fixture" },
    { action: "expectText", target: "portal-needs", detail: "what is needed" },
    { action: "expectText", target: "portal-why", detail: "why it is needed" },
    { action: "expectVisible", target: "portal-next-action", detail: "clear next action" },
  ],
  sideEffectFree: true,
};

const PORTAL_COMPLICATION: Journey = {
  id: "portal-scope-complication",
  persona: "quick-fix-customer",
  title: "Customer portal — scope complication / additional decision",
  mandateRef: "§11C",
  viewport: "desktop",
  entryRoute: "/offer/:offerId/portal",
  steps: [
    { action: "navigate", target: "/offer/:offerId/portal", detail: "In Progress → Additional Decision Needed fixture" },
    { action: "expectVisible", target: "portal-scope", detail: "original scope unchanged (frozen)" },
    { action: "expectText", target: "portal-decision", detail: "new issue explained clearly" },
    { action: "expectVisible", target: "portal-decision-ui", detail: "decision UI understandable" },
  ],
  sideEffectFree: true,
};

const CONTENT_STUDIO_JOURNEY: Journey = {
  id: "content-studio-zero-touch",
  persona: "social-content-creator",
  title: "Content Studio zero-touch: brief → Generate → finished video",
  mandateRef: "§10",
  viewport: "desktop",
  entryRoute: "/content-studio",
  steps: [
    { action: "navigate", target: "/content-studio" },
    { action: "expectVisible", target: "cs-brief-input", detail: "brief-oriented normal UI" },
    { action: "expectVisible", target: "cs-generate-button" },
    // The normal UI must NOT expose the production machinery (§10).
    { action: "expectAbsent", target: "narration-script-editor" },
    { action: "expectAbsent", target: "copy-narration" },
    { action: "expectAbsent", target: "upload-voiceover" },
    { action: "expectAbsent", target: "audio-format-instructions" },
    { action: "expectAbsent", target: "generate-voiceover-button" },
    { action: "expectAbsent", target: "generate-video-button" },
    { action: "click", target: "cs-generate-button", detail: "SAFE deterministic test path (mocked provider — no ElevenLabs spend)" },
    { action: "expectVisible", target: "cs-generating-state", detail: "simplified 'Creating your video…' state" },
    { action: "expectVisible", target: "cs-finished-video" },
    { action: "playMedia", target: "cs-finished-video" },
    { action: "expectMediaHealthy", target: "cs-finished-video", detail: "9:16 portrait, alive throughout" },
  ],
  sideEffectFree: true,
};

const FULFILLMENT_JOURNEY: Journey = {
  id: "fulfillment-operator-review",
  persona: "fulfillment-operator",
  title: "Fulfillment operator understands a purchased project at a glance",
  mandateRef: "§12",
  viewport: "desktop",
  entryRoute: "/revenue/fulfillment/:offerId",
  steps: [
    { action: "navigate", target: "/revenue/fulfillment/:offerId" },
    { action: "expectVisible", target: "fulfillment-scope", detail: "scope frozen" },
    { action: "expectVisible", target: "fulfillment-access-state" },
    { action: "expectVisible", target: "fulfillment-tasks" },
    { action: "expectVisible", target: "fulfillment-evidence" },
    { action: "expectVisible", target: "fulfillment-portal-projection", detail: "customer portal projection" },
  ],
  sideEffectFree: true,
};

// §13 — critical flows at phone dimensions. One journey per critical surface; the
// harness runs each across MOBILE_WIDTHS. Uses expectMediaHealthy + geometry (no overflow).
function mobileJourney(id: string, title: string, entryRoute: string, surface: string): Journey {
  return {
    id: `mobile-${id}`,
    persona: "mobile-user",
    title: `Mobile — ${title}`,
    mandateRef: "§13",
    viewport: "mobile",
    entryRoute,
    steps: [
      { action: "navigate", target: entryRoute },
      { action: "expectVisible", target: surface },
      { action: "expectAbsent", target: "horizontal-overflow", detail: "no sideways scroll at 320–430px" },
      { action: "scroll", target: surface },
    ],
    sideEffectFree: true,
  };
}

const MOBILE_JOURNEYS: Journey[] = [
  mobileJourney("offer", "offer page", "/offer/:offerId", "offer-hero"),
  mobileJourney("portal", "customer portal", "/offer/:offerId/portal", "portal-scope"),
  mobileJourney("content-studio", "Content Studio", "/content-studio", "cs-brief-input"),
  mobileJourney("cockpit", "cockpit", "/launch/cockpit", "cockpit"),
  mobileJourney("explainers", "Explainer QA", "/launch/explainers", "explainer-coverage-summary"),
];

export const JOURNEYS: Journey[] = [
  OPERATOR_JOURNEY,
  PROSPECT_JOURNEY,
  PORTAL_SUCCESS,
  PORTAL_WAITING,
  PORTAL_COMPLICATION,
  CONTENT_STUDIO_JOURNEY,
  FULFILLMENT_JOURNEY,
  ...MOBILE_JOURNEYS,
];

/** Every distinct route a journey navigates to (dynamic segments as `:param`). */
export function journeyRoutes(): string[] {
  const routes = new Set<string>();
  for (const j of JOURNEYS) {
    routes.add(j.entryRoute);
    for (const s of j.steps) if (s.action === "navigate" && s.target.startsWith("/")) routes.add(s.target);
  }
  return [...routes].sort();
}
