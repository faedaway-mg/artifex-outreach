// ─────────────────────────────────────────────────────────────────────────────
// Business health narrative — a living account of change, not a score.
//
// "Over the past four months the business has gradually reduced manual work while
// making appointments easier to book." Every sentence traces to a reviewed outcome
// that the operator recorded. Failures and mixed results are never hidden. If nothing
// has been reviewed yet, we say exactly that.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem } from "../types";
import type { HealthNarrative } from "./types";
import { hasObservation } from "./before-after";

const DAY = 86_400_000;
const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.replace(/\.$/, "").trim();

function monthsSpan(reviews: OutcomeReviewItem[], now: number): number {
  const times = reviews.map((r) => Date.parse(r.reviewedAt || r.createdAt) || now);
  const earliest = Math.min(...times, now);
  return Math.max(1, Math.round((now - earliest) / (30 * DAY)));
}

export function buildHealthNarrative(reviews: OutcomeReviewItem[], now: number): HealthNarrative {
  const observed = reviews.filter((r) => hasObservation(r) && (r.status === "Supported" || r.status === "Mixed"));
  const notSupported = reviews.filter((r) => r.status === "Not Supported");

  if (observed.length === 0) {
    return {
      opening:
        reviews.length === 0
          ? "No outcomes have been reviewed yet — this account fills in as completed work is measured."
          : "Work has been completed, but nothing has been reviewed against what we expected yet.",
      points: [],
      fromReviewIds: [],
    };
  }

  const months = monthsSpan(observed, now);
  const opening = `Over the past ${months} month${months === 1 ? "" : "s"}, the business has begun to change in ways we can point to.`;

  const points: string[] = [];
  for (const r of observed) {
    const note = r.status === "Mixed" ? " (mixed — worth watching)" : "";
    points.push(`${stripDot(lower1(r.observedOutcome))}${note}.`);
  }
  // Never hide failures.
  for (const r of notSupported) {
    if (r.observedOutcome.trim()) points.push(`Not everything landed: ${stripDot(lower1(r.observedOutcome))} — the change we expected didn't hold.`);
  }

  return { opening, points, fromReviewIds: [...observed, ...notSupported].map((r) => r.id) };
}
