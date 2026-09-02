// Acquisition OS — DOWNSTREAM PIPELINE ADVANCE (finish-the-refill mandate).
//
// Discovery inserts a business; it is NOT nationwide refill until that business has traversed the whole
// canonical pipeline and its downstream state is KNOWN. This module is the deterministic engine that
// carries in-funnel candidates the rest of the way — with ZERO new human decisions and ZERO weakening of
// any gate — through the three stages no cron performed before:
//
//   1. ENRICH   — bounded website analysis on leads that have a site but no observed finding / no
//                 recipient yet (reuses the EXISTING contact-first EMAIL_PREP path). Read-only crawl;
//                 never contacts anyone.
//   2. APPROVE  — the mandate-authorized AUTOMATIC approval: for a lead whose Quick Review is already
//                 SENDABLE (>=2 observed findings, or 1 substantial), with a valid public recipient, a
//                 resolvable compliant footer, no suppression and no prior contact, freeze the PDF
//                 EXACTLY ONCE (approveAndFreezeQuickReview). This FAILS CLOSED on anything weak:
//                 INSUFFICIENT_EVIDENCE / NEEDS_REVIEW / drift never freeze, so nothing unsupported is
//                 ever promoted. The freeze is what makes a lead DELIVERY_READY.
//   3. SCHEDULE — persist a real dispatchable binding (scheduleBatch) for each DELIVERY_READY lead that
//                 isn't already scheduled, under the ABSOLUTE shared 20/LA-day cap, in the canonical
//                 weekday morning window the dispatch runner honors. Sending itself still happens ONLY
//                 through the authorized outreach runner on its own schedule — this module sends nothing.
//
// It is idempotent and fail-closed at every step; a per-lead failure degrades that lead, never the run.

import { listLeads, getLead, getSettings, countSentEmailsBetween } from "../repo";
import type { Lead } from "../types";
import { gatherDeliveryContext } from "./refill-context";
import { assessDeliveryReadiness, tallyFunnel, type DeliveryContext } from "./delivery-ready";
import { capState, laDayBoundsUtc, laAccountingDate, GLOBAL_DAILY_CAP } from "./daily-cap";
import { approveAndFreezeQuickReview } from "../outreach/quick-review-freeze";
import { scheduleBatch, listScheduledBindings, MORNING_WINDOW } from "../outreach/scheduled-batch";

// Same "cold reserve" definition the refill reserve uses — terminal / already-engaged stages are excluded.
const NON_RESERVE_STAGES = new Set([
  "Contacted", "Follow-Up", "Meeting Booked", "Discovery Complete", "Proposal Sent", "Won", "Lost",
  "Nurture", "Disqualified", "Proposal Accepted", "Agreement Signed", "Deposit Paid",
]);

export interface AdvanceOptions {
  now?: Date;
  enrich?: boolean;        // run the bounded EMAIL_PREP enrichment pass first (default: true)
  enrichCap?: number;      // hard ceiling on expensive analyses this run (protects AI/crawl budget)
  approveCap?: number;     // hard ceiling on PDF freezes this run
  scheduleCap?: number;    // hard ceiling on new scheduled bindings this run (never exceeds cap-remaining)
  maxLeads?: number;       // cap how many leads we resolve context for (protects DB)
  dryRun?: boolean;        // measure + report only; approve/schedule nothing (still reads real state)
}

export interface AdvanceReport {
  ranAt: string;
  dryRun: boolean;
  examined: number;
  emailsSent: 0;                       // invariant: this module never dispatches email
  enrich: { ran: boolean; eligible: number; analyzed: number; adoptedEmail: number; note: string } | null;
  approve: {
    eligible: number;                  // leads that met every automatic-approval precondition
    attempted: number;
    approved: number;                  // newly frozen (or idempotent-existing) → DELIVERY_READY
    blocked: number;
    blockedByReason: Record<string, number>;
    approvedLeadIds: string[];
  };
  funnelBefore: ReturnType<typeof tallyFunnel>;
  funnelAfter: ReturnType<typeof tallyFunnel>;
  deliveryReadyBefore: number;
  deliveryReadyAfter: number;
  schedule: {
    capRemaining: number;
    alreadyScheduled: number;
    requested: number;
    scheduled: number;
    removed: Array<{ leadId: string; reason: string }>;
    scheduledLeadIds: string[];
    batchId: string | null;
    dateKey: string | null;
    windowLocal: string;
  };
  geographicDistribution: Record<string, number>;
}

/** The soonest LA weekday date (YYYY-MM-DD) whose morning window is still eligible: today if it is a
 *  weekday and the window has not fully passed, otherwise the next weekday. Matches the runner's LA
 *  weekday-only gate so a persisted binding is never stranded on a weekend or a spent day. */
export function nextEligibleLaDateKey(now: Date, window: { tz: string; startHour: number; endHour: number } = MORNING_WINDOW): string {
  for (let addDays = 0; addDays < 8; addDays++) {
    const probe = new Date(now.getTime() + addDays * 86400000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: window.tz, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(probe);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
    const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd);
    if (!isWeekday) continue;
    if (addDays === 0 && hour >= window.endHour) continue; // today's window already passed
    return laAccountingDate(probe, window.tz);
  }
  return laAccountingDate(now, window.tz);
}

/** Resolve delivery context for a set of leads (bounded, defensive). */
async function contextsFor(leads: Lead[]): Promise<DeliveryContext[]> {
  const out: DeliveryContext[] = [];
  for (const lead of leads) out.push(await gatherDeliveryContext(lead));
  return out;
}

/**
 * Run the bounded EMAIL_PREP enrichment pass (the same contact-first path the materialize cron uses):
 * cheap published-email check → adopt a same-domain address → expensive website analysis → BI. This is
 * what turns "no observed finding / no recipient" leads into candidates. Sends nothing. Best-effort:
 * unavailable dependencies degrade to a no-op note rather than failing the advance.
 */
async function runEnrich(leads: Lead[], analyzedLeadIds: Set<string>, cap: number): Promise<AdvanceReport["enrich"]> {
  try {
    const { prepareEmailInventory } = await import("../outreach/inventory-prep");
    const { runWebsiteAnalysisAction } = await import("../actions");
    const { isValidEmail } = await import("../outreach/contact-strategy");
    const { checkPublishedEmail } = await import("./contact-check");
    const { updateLead, appendAudit } = await import("../repo");
    const summary = await prepareEmailInventory({
      leads,
      analyzedLeadIds,
      checkContact: async (lead) => {
        const r = await checkPublishedEmail(lead.website);
        return { outcome: r.outcome, email: r.email };
      },
      adoptEmail: async (id, email) => {
        const cur = await getLead(id);
        if (cur && !isValidEmail(cur.publicEmail)) await updateLead(id, { publicEmail: email });
      },
      recordOutcome: async (id, r) => {
        await appendAudit({ action: "acq.contact-check", actor: "refill", targetType: "lead", targetId: id, meta: { outcome: r.outcome }, ip: null });
      },
      analyze: (id) => runWebsiteAnalysisAction(id),
      getEmailAfter: async (id) => (await getLead(id))?.publicEmail ?? null,
      max: cap,
    });
    return { ran: true, eligible: summary.eligible, analyzed: summary.analyzed, adoptedEmail: summary.adoptedEmail, note: `EMAIL_PREP: eligible ${summary.eligible}, analyzed ${summary.analyzed}, adoptedEmail ${summary.adoptedEmail}${summary.capped ? " (capped)" : ""}` };
  } catch (e) {
    return { ran: false, eligible: 0, analyzed: 0, adoptedEmail: 0, note: `enrichment unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Carry in-funnel candidates through enrich → automatic-approval → schedule. Deterministic + fail-closed;
 * never sends. Returns an honest before/after funnel and exact per-stage counts (§6 reconciliation).
 */
export async function advanceReadyInventory(opts: AdvanceOptions = {}): Promise<AdvanceReport> {
  const now = opts.now ?? new Date();
  const maxLeads = opts.maxLeads ?? 3000;
  const enrichCap = Math.max(0, opts.enrichCap ?? 24);
  const approveCap = Math.max(0, opts.approveCap ?? 40);
  const dryRun = !!opts.dryRun;

  const all: Lead[] = await listLeads();
  const candidates = all
    .filter((l) => !!l.website && !NON_RESERVE_STAGES.has(String((l as { pipelineStage?: string }).pipelineStage ?? "")))
    .slice(0, maxLeads);

  // 1) ENRICH (bounded). Skipped on dryRun and when disabled. Grows observed-finding + recipient coverage.
  let enrich: AdvanceReport["enrich"] = null;
  if (!dryRun && (opts.enrich ?? true) && enrichCap > 0) {
    const { allBusinessIntelligence } = await import("../repo");
    const analyzedLeadIds = new Set((await allBusinessIntelligence()).map((b) => b.leadId));
    enrich = await runEnrich(all, analyzedLeadIds, enrichCap);
  }

  // Measure the funnel BEFORE promotion (post-enrich state).
  const ctxBefore = await contextsFor(candidates);
  const verdictsBefore = ctxBefore.map((ctx) => ({ ctx, verdict: assessDeliveryReadiness(ctx) }));
  const funnelBefore = tallyFunnel(verdictsBefore);
  const deliveryReadyBefore = verdictsBefore.filter((v) => v.verdict.ready).length;

  // 2) AUTOMATIC APPROVAL — freeze the SENDABLE, fully-qualified, not-yet-approved leads. Every condition
  //    here is a hard gate; approveAndFreezeQuickReview itself fails closed on INSUFFICIENT / not-ready.
  const approveEligible = verdictsBefore
    .map((v) => v.ctx)
    .filter((c) =>
      c.hasObservedFinding && c.reviewSendable && !!c.recipientEmail && c.recipientEmailValid &&
      c.footerReady && !c.suppressed && !c.priorContact && !c.reviewApproved &&
      !!c.website && !!c.websiteDomain,
    );
  const blockedByReason: Record<string, number> = {};
  const approvedLeadIds: string[] = [];
  let attempted = 0, blocked = 0;
  if (!dryRun) {
    for (const c of approveEligible.slice(0, approveCap)) {
      attempted += 1;
      try {
        const r = await approveAndFreezeQuickReview({ leadId: c.leadId });
        if (r.ok) approvedLeadIds.push(c.leadId);
        else { blocked += 1; const key = (r.reason ?? "blocked").slice(0, 60); blockedByReason[key] = (blockedByReason[key] ?? 0) + 1; }
      } catch (e) {
        blocked += 1; const key = `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 40)}`; blockedByReason[key] = (blockedByReason[key] ?? 0) + 1;
      }
    }
  }

  // Re-measure the funnel AFTER promotion — the honest post-run reserve.
  const ctxAfter = await contextsFor(candidates);
  const verdictsAfter = ctxAfter.map((ctx) => ({ ctx, verdict: assessDeliveryReadiness(ctx) }));
  const funnelAfter = tallyFunnel(verdictsAfter);
  const readyAfter = verdictsAfter.filter((v) => v.verdict.ready);
  const deliveryReadyAfter = readyAfter.length;

  const geographicDistribution: Record<string, number> = {};
  for (const v of readyAfter) { const k = (v.ctx.state || "??").toUpperCase(); geographicDistribution[k] = (geographicDistribution[k] ?? 0) + 1; }

  // 3) SCHEDULE — persist a dispatchable binding for each DELIVERY_READY lead not already scheduled, under
  //    the absolute shared 20/LA-day cap, in the canonical weekday morning window the runner enforces.
  const bounds = laDayBoundsUtc(now);
  const sentToday = await countSentEmailsBetween(bounds.startIso, bounds.endIso);
  const cap = capState(now, sentToday, GLOBAL_DAILY_CAP);
  const alreadyScheduledIds = new Set((await listScheduledBindings()).map((b) => b.leadId));
  const readyIds = readyAfter.map((v) => v.ctx.leadId).filter((id) => !alreadyScheduledIds.has(id));
  const scheduleCap = Math.min(opts.scheduleCap ?? GLOBAL_DAILY_CAP, cap.remaining, readyIds.length);
  const toSchedule = readyIds.slice(0, Math.max(0, scheduleCap));
  const dateKey = nextEligibleLaDateKey(now);
  const batchId = `refill-${dateKey}`;

  let scheduled = 0;
  const removed: Array<{ leadId: string; reason: string }> = [];
  const scheduledLeadIds: string[] = [];
  if (!dryRun && toSchedule.length > 0) {
    const res = await scheduleBatch(toSchedule, { dateKey, by: "refill-auto", batchId, now: now.toISOString(), window: MORNING_WINDOW });
    scheduled = res.scheduled.length;
    for (const s of res.scheduled) scheduledLeadIds.push(s.leadId);
    for (const r of res.removed) removed.push(r);
  }

  return {
    ranAt: now.toISOString(),
    dryRun,
    examined: candidates.length,
    emailsSent: 0,
    enrich,
    approve: { eligible: approveEligible.length, attempted, approved: approvedLeadIds.length, blocked, blockedByReason, approvedLeadIds },
    funnelBefore,
    funnelAfter,
    deliveryReadyBefore,
    deliveryReadyAfter,
    schedule: {
      capRemaining: cap.remaining,
      alreadyScheduled: alreadyScheduledIds.size,
      requested: toSchedule.length,
      scheduled,
      removed,
      scheduledLeadIds,
      batchId: toSchedule.length ? batchId : null,
      dateKey: toSchedule.length ? dateKey : null,
      windowLocal: `${String(MORNING_WINDOW.startHour).padStart(2, "0")}:00–${String(MORNING_WINDOW.endHour).padStart(2, "0")}:00 ${MORNING_WINDOW.tz} (weekdays)`,
    },
    geographicDistribution,
  };
}
