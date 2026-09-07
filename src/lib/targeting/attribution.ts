// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN OUTCOME ATTRIBUTION (persona-gate Phase 9). A versioned, pure attribution model: it aggregates
// real campaign events by every dimension the operator needs to judge whether Priority A/B businesses actually
// book and hold meetings — WITHOUT auto-retraining the persona. Weight/threshold changes require a minimum
// cohort AND explicit operator approval; a small sample can never silently move the model.
// ─────────────────────────────────────────────────────────────────────────────

export const ATTRIBUTION_VERSION = "attribution-v1-2026-09";

export type OutcomeEventType =
  | "delivered" | "hard-bounce" | "soft-bounce" | "positive-reply" | "negative-reply"
  | "unsubscribe" | "complaint" | "meeting-booked" | "meeting-held" | "proposal-delivered" | "client-closed";

// Every event is attributed to the full dimensional key (persona version → transport).
export interface OutcomeEvent {
  leadId: string;
  at: string;                       // ISO timestamp
  type: OutcomeEventType;
  personaVersion: string;
  tier: string;                     // PRIORITY_A / PRIORITY_B / …
  vertical: string;
  marketBand: string;               // secondary / tertiary / …
  evidencePattern: string;          // e.g. "booking+mobile"
  recipientRole: string;            // owner / general-manager / …
  asset: string;                    // personalized-video / evidence-email / …
  messageVersion: string;
  mailbox: string;
  transport: string;                // resend / google-workspace / …
}

export interface OutcomeMetrics {
  delivered: number; hardBounce: number; softBounce: number; positiveReply: number; negativeReply: number;
  unsubscribe: number; complaint: number; meetingBooked: number; meetingHeld: number; proposalDelivered: number; clientClosed: number;
  // derived rates (per delivered), null when no deliveries yet (missing data → null, never invented)
  bounceRate: number | null; replyRate: number | null; positiveReplyRate: number | null;
  meetingRate: number | null; heldRate: number | null; complaintRate: number | null;
}

const empty = (): OutcomeMetrics => ({ delivered: 0, hardBounce: 0, softBounce: 0, positiveReply: 0, negativeReply: 0, unsubscribe: 0, complaint: 0, meetingBooked: 0, meetingHeld: 0, proposalDelivered: 0, clientClosed: 0, bounceRate: null, replyRate: null, positiveReplyRate: null, meetingRate: null, heldRate: null, complaintRate: null });

function finalize(m: OutcomeMetrics): OutcomeMetrics {
  const d = m.delivered;
  const rate = (n: number) => (d > 0 ? n / d : null);
  return { ...m, bounceRate: rate(m.hardBounce + m.softBounce), replyRate: rate(m.positiveReply + m.negativeReply), positiveReplyRate: rate(m.positiveReply), meetingRate: rate(m.meetingBooked), heldRate: rate(m.meetingHeld), complaintRate: rate(m.complaint) };
}

const bump = (m: OutcomeMetrics, t: OutcomeEventType) => {
  const map: Record<OutcomeEventType, keyof OutcomeMetrics> = { "delivered": "delivered", "hard-bounce": "hardBounce", "soft-bounce": "softBounce", "positive-reply": "positiveReply", "negative-reply": "negativeReply", "unsubscribe": "unsubscribe", "complaint": "complaint", "meeting-booked": "meetingBooked", "meeting-held": "meetingHeld", "proposal-delivered": "proposalDelivered", "client-closed": "clientClosed" };
  (m[map[t]] as number)++;
};

export type Dimension = "tier" | "vertical" | "marketBand" | "recipientRole" | "asset" | "messageVersion" | "mailbox" | "transport" | "personaVersion" | "evidencePattern";

/** Aggregate outcomes overall + broken down by a chosen dimension. Pure. */
export function attributeOutcomes(events: OutcomeEvent[], dimension: Dimension): { version: string; overall: OutcomeMetrics; byDimension: Record<string, OutcomeMetrics> } {
  const overall = empty();
  const by: Record<string, OutcomeMetrics> = {};
  for (const e of events) {
    bump(overall, e.type);
    const key = String(e[dimension] ?? "unknown");
    by[key] ??= empty();
    bump(by[key], e.type);
  }
  const byDimension: Record<string, OutcomeMetrics> = {};
  for (const [k, v] of Object.entries(by)) byDimension[k] = finalize(v);
  return { version: ATTRIBUTION_VERSION, overall: finalize(overall), byDimension };
}

// A retrain requires a real cohort AND explicit operator approval — a small sample can never move the model.
export const MIN_RETRAIN_COHORT = { delivered: 200, meetingsHeld: 10 };
export interface RetrainDecision { allowed: boolean; reason: string }
export function mayRetrainPersona(overall: OutcomeMetrics, operatorApproved: boolean): RetrainDecision {
  if (overall.delivered < MIN_RETRAIN_COHORT.delivered) return { allowed: false, reason: `cohort too small (${overall.delivered} < ${MIN_RETRAIN_COHORT.delivered} delivered)` };
  if (overall.meetingHeld < MIN_RETRAIN_COHORT.meetingsHeld) return { allowed: false, reason: `insufficient held meetings (${overall.meetingHeld} < ${MIN_RETRAIN_COHORT.meetingsHeld})` };
  if (!operatorApproved) return { allowed: false, reason: "operator approval required before changing weights/thresholds" };
  return { allowed: true, reason: "minimum cohort met + operator approved" };
}

// The controlled ramp when compliant cold transport is eventually activated: 20/weekday for the first 3 weeks.
export const COLD_RAMP = { dailyCap: 20, holdWeeks: 3 } as const;
