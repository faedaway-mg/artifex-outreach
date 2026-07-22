// ─────────────────────────────────────────────────────────────────────────────
// Roadmap metadata — the consultant's sequencing judgment, in one place.
//
// Dependencies here are ROLLOUT judgment ("connect the tools before automating on
// top of them"), not fabricated business facts — and they only ever apply between
// recommendations that actually exist for this lead. Impact and success metrics are
// grounded in each recommendation itself; we never invent a KPI.
// ─────────────────────────────────────────────────────────────────────────────
import type { ImpactLevel, SuccessMetric } from "./types";

// Prerequisite edges keyed by recommendation id (rec_<inferenceId>).
export const DEPENDENCY_TEMPLATES: Array<{ from: string; to: string; reason: string }> = [
  {
    from: "rec_integration-over-replacement",
    to: "rec_manual-scheduling",
    reason: "Connect the tools they already trust before layering booking automation on top of them.",
  },
  {
    from: "rec_manual-scheduling",
    to: "rec_capacity-bound-growth",
    reason: "Relieve the front-desk bottleneck first — adding demand before that just adds pressure.",
  },
];

export const IMPACT: Record<string, ImpactLevel> = {
  "rec_manual-scheduling": "High",
  "rec_capacity-bound-growth": "High",
  "rec_integration-over-replacement": "Medium",
};

export const METRICS: Record<string, SuccessMetric> = {
  "rec_manual-scheduling": {
    looksLike: "The front desk spends less time booking, and fewer calls go unanswered at busy times.",
    measuredBy: "Share of appointments booked without a phone call, and the count of missed calls per week.",
    reviewWhen: "About four weeks after anything goes live.",
  },
  "rec_capacity-bound-growth": {
    looksLike: "The same team handles more without the day getting longer.",
    measuredBy: "Throughput per staff member, and hours worked beyond the normal day.",
    reviewWhen: "After one full busy cycle.",
  },
  "rec_integration-over-replacement": {
    looksLike: "Information stops being re-entered by hand between the tools they already use.",
    measuredBy: "Number of manual double-entry touchpoints removed.",
    reviewWhen: "Once the first integration ships.",
  },
};

const DEFAULT_METRIC: SuccessMetric = {
  looksLike: "The specific friction this addresses is noticeably lighter for the team.",
  measuredBy: "A simple before/after the operator agrees on with the business.",
  reviewWhen: "A few weeks after the change lands.",
};

export const metricFor = (recommendationId: string): SuccessMetric => METRICS[recommendationId] ?? DEFAULT_METRIC;
export const impactFor = (recommendationId: string): ImpactLevel => IMPACT[recommendationId] ?? "Medium";
