// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX IMPACT & BEFORE/AFTER — qualitative, scope-family templates.
//
// The offer page shows a compact "why this matters" panel and an optional
// conceptual before/after. Both are drawn from APPROVED, fixed per-scope
// templates — never freeform speculation. They are strictly QUALITATIVE:
// no traffic, revenue, conversion %, ranking, or any measured/fabricated result.
// The before/after describes interface STRUCTURE ("what the repair addresses"),
// labelled as an example — it never claims the customer's measured outcome.
//
// Keyed by the same TrustVideoScope the server already maps every SKU to, so the
// panel, the video, and the scope stay in lock-step.
// ─────────────────────────────────────────────────────────────────────────────
import type { TrustVideoScope } from "./trust-videos";

export interface ScopeImpact {
  /** 2-3 qualitative outcomes of doing the fix properly (no numbers, ever). */
  impactPoints: string[];
  /** Conceptual interface structure — an EXAMPLE, not a measured result. */
  before: string;
  after: string;
}

const IMPACT: Record<TrustVideoScope, ScopeImpact> = {
  "contact-form-lead-capture": {
    impactPoints: ["A working path from visitor to inquiry", "Submissions that actually arrive", "Leads routed to the right place"],
    before: "Form errors · inquiries lost", after: "A working, reliable inquiry path",
  },
  "cta-conversion": {
    impactPoints: ["A clearer next action for visitors", "Less friction on the path that matters", "A CTA that works on mobile too"],
    before: "Action buried · competing buttons", after: "One clear primary action",
  },
  "mobile-responsive": {
    impactPoints: ["Key content usable on any screen", "Tap targets that are easy to hit", "A layout that holds together on mobile"],
    before: "Cramped · overflowing layout", after: "Clean and usable on any screen",
  },
  "accessibility": {
    impactPoints: ["The site is usable for more visitors", "Clear labels and focus cues", "The affected experience is tested"],
    before: "Missing labels · weak focus", after: "Clear, operable, properly labelled",
  },
  "analytics-tracking": {
    impactPoints: ["The activity you care about is measured", "Events verified as actually firing", "A clear record of what's tracked"],
    before: "Silent · unverified tracking", after: "Verified, documented measurement",
  },
  "cms-technical": {
    impactPoints: ["The broken function works again", "A contained, tested correction", "Confirmation it works as intended"],
    before: "A specific technical fault", after: "Repaired and confirmed working",
  },
  "seo-metadata": {
    impactPoints: ["Correct metadata search engines can read", "Indexing-related config in order", "The change verified in place"],
    before: "Missing · malformed metadata", after: "Correct, in-place metadata",
  },
  "homepage-sprint": {
    impactPoints: ["A clearer hierarchy on your key page", "A stronger, more visible trust block", "A clearer primary action"],
    before: "Unclear priority · weak trust", after: "Clear hierarchy · visible trust",
  },
  "fix-scan": {
    impactPoints: ["A clear read on what's actually wrong", "An evidence-backed recommended next step", "An eligible repair can be credited per the terms"],
    before: "An unclear problem", after: "An evidence-backed recommendation",
  },
  general: {
    impactPoints: ["One clearly defined problem, fixed properly", "Scope agreed before work begins", "The result tested and confirmed"],
    before: "One unresolved issue", after: "A scoped fix, tested and confirmed",
  },
};

export function impactForScope(scope: TrustVideoScope): ScopeImpact {
  return IMPACT[scope] ?? IMPACT.general;
}
