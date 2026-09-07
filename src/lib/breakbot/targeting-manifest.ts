// TARGETING ACTION MANIFEST (mandate 27). Canonical registry of every Targeting-view control. CI fails if a
// visible targeting control ships without a registered action + acceptance, or if a manifested DOM marker is
// not rendered by a targeting surface (dead-registration detection).
export interface TargetingActionSpec {
  id: string;
  surface: string;
  goal: string;
  expectedUi: string;
  countInvariant: string;   // "count == list" where applicable
  sideEffect: "none";       // the Targeting view is READ-ONLY — never a provider/render/schedule side-effect
  deterministicTest: string;
  domMarker: string | null;
}

export const TARGETING_ACTIONS: TargetingActionSpec[] = [
  { id: "targeting.board", surface: "/targeting", goal: "open the targeting view", expectedUi: "board with persona + model version", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-targeting-board]" },
  { id: "targeting.backlog-counts", surface: "/targeting", goal: "read qualified backlog counts", expectedUi: "A/B/Review/DoNotPrepare/Ineligible/auto-prepare tiles", countInvariant: "each count equals its band", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-backlog-count]" },
  { id: "targeting.next-market", surface: "/targeting", goal: "see the next market being searched + why", expectedUi: "secondary/tertiary markets with reasons; major metros excluded", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-next-market]" },
  { id: "targeting.market-reason", surface: "/targeting", goal: "read why a market qualifies", expectedUi: "market rationale + tier", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-market-reason]" },
  { id: "targeting.qualified-list", surface: "/targeting", goal: "read the qualified backlog list", expectedUi: "PRIORITY A/B cards only; enterprise excluded", countInvariant: "qualified count equals its list", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-targeting-list]" },
  { id: "targeting.target-card", surface: "/targeting", goal: "open a business (tap-through)", expectedUi: "navigates to full-page Why-this-business", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-target-card]" },
  { id: "targeting.why-business", surface: "/targeting/[leadId]", goal: "read Why this business", expectedUi: "persona fit, reputation, gap, opportunity, recipient, disqualifiers, asset", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-why-business]" },
  { id: "targeting.score-breakdown", surface: "/targeting/[leadId]", goal: "read the component score breakdown", expectedUi: "8 components with caps; penalties listed", countInvariant: "score == sum of components − penalties (clamped)", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-score-breakdown]" },
  { id: "targeting.recommended-asset", surface: "/targeting/[leadId]", goal: "see the recommended outreach asset", expectedUi: "video / PDF+email / evidence-email + reason", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-recommended-asset]" },
  { id: "targeting.recipient", surface: "/targeting/[leadId]", goal: "see the resolved recipient + confidence", expectedUi: "role, verified, confidence, decision-control", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-recipient]" },
  { id: "targeting.back", surface: "/targeting/[leadId]", goal: "return to the targeting board", expectedUi: "back to /targeting", countInvariant: "n/a", sideEffect: "none", deterministicTest: "breakbot-targeting-journey", domMarker: "[data-target-back]" },
];

export function targetingActionIds(): string[] { return TARGETING_ACTIONS.map((a) => a.id); }
