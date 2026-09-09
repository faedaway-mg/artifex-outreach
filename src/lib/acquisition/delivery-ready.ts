// Acquisition OS — DELIVERY_READY gate (nationwide-refill mandate, §1 + §6 fail-closed).
//
// A lead counts toward the rolling ready reserve ONLY when every dispatch precondition is already
// satisfied — not "discovered" or "researching" or "needs-evidence". This module is the single, pure,
// deterministic predicate the refill loop, the daily materializer, and the owner-visibility snapshot all
// share, so "ready" means exactly one thing everywhere. It NEVER sends and NEVER mutates; it only judges a
// pre-gathered context. Anything short of fully-qualified is rejected with a specific, countable reason
// (funnel attrition is measured, never hidden).

// Every way a candidate can fall short of DELIVERY_READY — one bucket per mandate exclusion, so the funnel
// can report "rejected by reason" honestly.
export type RejectReason =
  | "missing_website"        // no canonical website
  | "invalid_website"        // website present but not a valid http(s) URL / no domain
  | "service_fit"            // not a supported service-fit vertical
  | "no_recipient"           // no publicly-sourced, valid recipient email
  | "no_observed_finding"    // no directly-observed, supported finding (needs-evidence)
  | "review_not_approved"    // Quick Review not approved/frozen
  | "review_insufficient"    // frozen review is INSUFFICIENT_EVIDENCE / not sendable
  | "attachment_missing"     // no frozen compliant attachment (SHA) bound
  | "footer_missing"         // unsubscribe + postal footer not resolvable
  | "suppressed"             // email/domain/phone on the suppression list
  | "unsubscribed"           // recipient previously unsubscribed
  | "bounced"                // recipient previously hard-bounced
  | "duplicate"              // a national duplicate already owns this business
  | "prior_contact"          // this lead was already contacted (no re-cold)
  | "no_timezone"            // recipient-local timezone can't be resolved
  | "jurisdiction_blocked"   // cold email not cleared for this jurisdiction (fail-closed)
  | "dispatch_gate";         // a residual dispatch gate is not passing

export const ALL_REJECT_REASONS: RejectReason[] = [
  "missing_website", "invalid_website", "service_fit", "no_recipient", "no_observed_finding",
  "review_not_approved", "review_insufficient", "attachment_missing", "footer_missing",
  "suppressed", "unsubscribed", "bounced", "duplicate", "prior_contact", "no_timezone", "jurisdiction_blocked", "dispatch_gate",
];

// The pre-gathered facts about one candidate. The refill cron resolves these from the DB (BI, frozen-review
// binding, suppression checker, prior sends); this module stays pure so the gate is unit-testable.
export interface DeliveryContext {
  leadId: string;
  businessName: string;
  website: string | null;
  websiteDomain: string | null;
  serviceFit: boolean;            // matched a supported service vertical
  recipientEmail: string | null;  // publicly-sourced candidate recipient
  recipientEmailValid: boolean;   // passed surface validation
  hasObservedFinding: boolean;    // a directly-observed, supported finding exists (not needs-evidence)
  reviewApproved: boolean;        // an approved/frozen Quick Review binding exists
  reviewSendable: boolean;        // that review's status is SENDABLE (not INSUFFICIENT_EVIDENCE)
  attachmentSha: string | null;   // frozen compliant attachment SHA-256
  footerReady: boolean;           // unsubscribe URL + postal footer resolvable
  suppressed: boolean;            // on the suppression list (email/domain/phone)
  unsubscribed: boolean;          // prior unsubscribe event
  bounced: boolean;               // prior hard bounce
  duplicate: boolean;             // national duplicate exists
  priorContact: boolean;          // already contacted / has inbound
  recipientTimezone: string | null; // resolved IANA tz for recipient-local scheduling
  score: number;                  // strength for "strongest-first" selection
  city: string | null;
  state: string | null;
  /** Optional country/jurisdiction key (e.g. "US"). When set, an uncleared
   *  jurisdiction fails closed. Unset ⇒ no jurisdiction gate (back-compatible). */
  country?: string | null;
}

export interface ReadinessVerdict {
  ready: boolean;
  reasons: RejectReason[];   // empty when ready; ALL failing gates otherwise (so the funnel is complete)
  firstReason: RejectReason | null; // the single reason to bucket by (deterministic priority order)
}

const isHttpUrl = (u: string): boolean => { try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; } };

// Jurisdiction fail-closed check — a cold send is cleared only when the send-eligibility
// registry affirmatively allows it (US today; everything else disabled). See quick-fix/jurisdiction.ts.
import { sendEligibility } from "../quick-fix/jurisdiction";
function jurisdictionCleared(country: string): boolean { return sendEligibility(country).coldSendAllowed; }

// Judge one candidate against every DELIVERY_READY precondition. Fail-closed: any missing gate → not ready.
// Reasons accrue in a fixed priority order so `firstReason` is a stable bucket for the rejection report.
export function assessDeliveryReadiness(ctx: DeliveryContext): ReadinessVerdict {
  const reasons: RejectReason[] = [];
  const add = (r: RejectReason) => reasons.push(r);

  // Business + canonical website.
  if (!ctx.website) add("missing_website");
  else if (!isHttpUrl(ctx.website) || !ctx.websiteDomain) add("invalid_website");
  // Supported service fit.
  if (!ctx.serviceFit) add("service_fit");
  // Publicly-sourced, valid recipient.
  if (!ctx.recipientEmail || !ctx.recipientEmailValid) add("no_recipient");
  // Directly-observed supported finding (not needs-evidence).
  if (!ctx.hasObservedFinding) add("no_observed_finding");
  // Approved/frozen, sendable Quick Review + compliant attachment.
  if (!ctx.reviewApproved) add("review_not_approved");
  else if (!ctx.reviewSendable) add("review_insufficient");
  if (!ctx.attachmentSha) add("attachment_missing");
  // Unsubscribe + postal footer.
  if (!ctx.footerReady) add("footer_missing");
  // Compliance exclusions.
  if (ctx.suppressed) add("suppressed");
  if (ctx.unsubscribed) add("unsubscribed");
  if (ctx.bounced) add("bounced");
  if (ctx.duplicate) add("duplicate");
  if (ctx.priorContact) add("prior_contact");
  // Recipient-local timezone.
  if (!ctx.recipientTimezone) add("no_timezone");
  // Jurisdiction — hard input when provided; an uncleared/unknown jurisdiction fails closed.
  if (ctx.country != null && !jurisdictionCleared(ctx.country)) add("jurisdiction_blocked");

  // Priority order for the single bucket (evidence/recipient first — the expensive, common blockers).
  const priority: RejectReason[] = [
    "missing_website", "invalid_website", "service_fit", "no_observed_finding", "no_recipient",
    "review_not_approved", "review_insufficient", "attachment_missing", "footer_missing",
    "suppressed", "unsubscribed", "bounced", "duplicate", "prior_contact", "no_timezone", "jurisdiction_blocked", "dispatch_gate",
  ];
  const firstReason = priority.find((p) => reasons.includes(p)) ?? null;
  return { ready: reasons.length === 0, reasons, firstReason };
}

// A funnel roll-up over a set of judged candidates — the mandate's "track … rejected by reason" (§3/§7).
export interface FunnelCounts {
  discovered: number;         // total candidates considered
  websiteValid: number;       // valid canonical website
  serviceFit: number;         // + supported service fit
  evidenceSupported: number;  // + directly-observed finding
  recipientResolved: number;  // + valid recipient
  reviewApproved: number;     // + approved/sendable frozen review
  deliveryReady: number;      // fully qualified
  rejectedByReason: Record<RejectReason, number>;
}

export function tallyFunnel(verdicts: Array<{ ctx: DeliveryContext; verdict: ReadinessVerdict }>): FunnelCounts {
  const rejectedByReason = Object.fromEntries(ALL_REJECT_REASONS.map((r) => [r, 0])) as Record<RejectReason, number>;
  let websiteValid = 0, serviceFit = 0, evidenceSupported = 0, recipientResolved = 0, reviewApproved = 0, deliveryReady = 0;
  for (const { ctx, verdict } of verdicts) {
    const websiteOk = !!ctx.website && isHttpUrl(ctx.website) && !!ctx.websiteDomain;
    if (websiteOk) websiteValid++;
    if (websiteOk && ctx.serviceFit) serviceFit++;
    if (websiteOk && ctx.serviceFit && ctx.hasObservedFinding) evidenceSupported++;
    if (websiteOk && ctx.serviceFit && ctx.hasObservedFinding && !!ctx.recipientEmail && ctx.recipientEmailValid) recipientResolved++;
    if (ctx.reviewApproved && ctx.reviewSendable) reviewApproved++;
    if (verdict.ready) deliveryReady++;
    else if (verdict.firstReason) rejectedByReason[verdict.firstReason]++;
  }
  return { discovered: verdicts.length, websiteValid, serviceFit, evidenceSupported, recipientResolved, reviewApproved, deliveryReady, rejectedByReason };
}
