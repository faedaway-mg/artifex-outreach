// ─────────────────────────────────────────────────────────────────────────────
// Call-board priority — value-first, not phone-first.
//
// The operator is weakest on a completely cold call (the recipient has never heard of
// Artifex, has seen nothing, has no context) and strongest when the call FOLLOWS
// something concrete — a review we emailed, a prior touch, a request. So the primary
// call board should carry WARM and HIGH-VALUE calls; ordinary completely-cold
// phone-first leads are deprioritized OUT of the primary queue (never deleted, never
// losing their number — they stay reachable and are surfaced in the ledger).
//
// Two pure predicates, asserted directly:
//   • isOrdinaryColdPhoneFirst — a cold, low-value, no-context phone-first lead.
//   • predictablyClosedForWeekend — a professional/admin office we shouldn't dial on a
//     weekend when we have no positive evidence it's open (its contact is predictably out).
// Both compose with the existing business-hours withholding (knownClosedNow).
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import { determineContactStrategy, gatekeeperHeavy } from "./contact-strategy";
import { businessHours } from "../timezone";
import { inferZone } from "../timezone";
import { zonedParts } from "../timezone";

// A call counts as HIGH-VALUE (worth synchronous attention even cold) when the business
// scores well enough to justify it. Tier A or a strong lead score clears the bar.
const HIGH_VALUE_SCORE = 70;

// Engagement = the prospect has actually leaned in. Email-first policy: a call task is only OFFERED
// after engagement — a booked meeting or a stage past first contact that a POSITIVE reply drives —
// never as cold-prospect busywork and never off an unanswered email. "Contacted"/"Follow-Up" mean we
// merely sent outbound and are NOT engagement. Operator-initiated calls from a live reply are always
// available; this only governs which calls the system SURFACES on its own.
const ENGAGED_STAGES = new Set([
  "Meeting Booked", "Discovery Complete", "Proposal Sent", "Proposal Accepted",
  "Agreement Signed", "Deposit Paid", "Won",
]);

/** Has the prospect ENGAGED (booked / in active conversation), so a call is genuinely warranted? */
export function isEngaged(lead: Pick<Lead, "pipelineStage">): boolean {
  return ENGAGED_STAGES.has(lead.pipelineStage);
}

/** Has this business already received Artifex context (so a call would be WARM, not cold)? */
export function hasPriorContext(lead: Pick<Lead, "lastContactAt" | "nextFollowUpAt" | "pipelineStage">): boolean {
  if (lead.lastContactAt) return true; // we've spoken / emailed — there is context to reference
  if (lead.nextFollowUpAt) return true; // a follow-up was scheduled (e.g. after emailing the review)
  // Anything past first contact in the pipeline has context behind it.
  return !["Discovered", "Qualified", "Analysis Ready"].includes(lead.pipelineStage);
}

/** Is this business worth a synchronous call even with no prior context? */
export function isHighValueCall(lead: Pick<Lead, "leadScore" | "tier" | "estimatedValueHigh">): boolean {
  if (lead.tier === "A") return true;
  if ((lead.leadScore ?? 0) >= HIGH_VALUE_SCORE) return true;
  if ((lead.estimatedValueHigh ?? 0) >= 20000) return true;
  return false;
}

/**
 * An ORDINARY completely-cold phone-first lead: call-first (no email route), no prior Artifex
 * context, and not high-value. These are exactly the calls that put the operator in his weakest
 * position, so they are deprioritized out of the PRIMARY queue (kept in data + the ledger).
 */
export function isOrdinaryColdPhoneFirst(lead: Lead): boolean {
  if (determineContactStrategy(lead).kind !== "call-first") return false; // only phone-first leads
  if (hasPriorContext(lead)) return false; // warm follow-up — belongs on the board
  if (isHighValueCall(lead)) return false; // exceptional cold call — allowed to surface
  return true;
}

// Professional / administrative businesses whose contact person is predictably OUT on weekends
// (front-desk / office staff, not owner-operators). Distinct from weekend-callable businesses
// (hotels, restaurants, retail, many trades). Reuses gatekeeperHeavy (dental/legal) + offices.
const PROFESSIONAL_WEEKEND_CLOSED_RE =
  /\b(account(ant|ing)|bookkeep|tax|cpa|insurance|financial|advisor|notary|title\s*(company|office)|real\s*estate\s*(office|broker|agency)|escrow|payroll|consult(ing|ant)|agency|clinic|medical\s*(office|practice|clinic)|physician|doctor|chiropract|optometr|dermatolog|veterinar|architect|engineering\s*firm)\b/i;

function isProfessionalOfficeCategory(lead: Pick<Lead, "industry" | "normalizedCategory">): boolean {
  return gatekeeperHeavy(lead)
    || PROFESSIONAL_WEEKEND_CLOSED_RE.test(lead.industry ?? "")
    || PROFESSIONAL_WEEKEND_CLOSED_RE.test(lead.normalizedCategory ?? "");
}

/**
 * A professional/admin office we should NOT put on the weekend call board: it's currently a
 * weekend, the category is one whose contact is predictably out (dental/legal/accounting/office),
 * and we have no positive evidence it's open today (its known hours don't include today). Owner-
 * accessible weekend businesses (hotels, restaurants, trades that publish weekend hours) are
 * unaffected — they either aren't professional-office categories or have real weekend hours.
 */
export function predictablyClosedForWeekend(
  lead: Pick<Lead, "state" | "longitude" | "latitude" | "hours" | "industry" | "normalizedCategory"> & { address?: string | null },
  now: Date,
): boolean {
  const { zone } = inferZone(lead);
  const { weekday } = zonedParts(now, zone);
  const isWeekend = weekday === 0 || weekday === 6;
  if (!isWeekend) return false;
  if (!isProfessionalOfficeCategory(lead)) return false;
  // If we have REAL hours showing it's open today, trust them — don't withhold.
  const hours = businessHours(lead);
  if (hours.source === "lead" && hours.days[weekday]) return false;
  return true; // professional office, weekend, no positive weekend-open evidence → withhold
}
