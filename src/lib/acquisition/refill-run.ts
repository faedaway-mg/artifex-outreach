// Acquisition OS — the REFILL CYCLE orchestrator (nationwide-refill mandate, §2 loop).
//
// Ties the pure policy (refill.ts), the DELIVERY_READY gate (delivery-ready.ts), the global cap
// (daily-cap.ts), and the daily materializer (materialize-batch.ts) to real stored state. One cycle:
//   1. measure the DELIVERY_READY reserve + funnel over current leads,
//   2. size the shortfall + attrition-adjusted discovery target,
//   3. (optionally) run BOUNDED nationwide discovery via the existing runProspecting("refill") — which
//      searches beyond Los Angeles, dedups nationally, and qualifies — WITHOUT sending anything,
//   4. plan tomorrow's ≤20 batch in recipient-local windows under the shared cap,
//   5. persist the checkpoint (rotation + budget + funnel) so the loop resumes,
//   6. emit the owner-visibility snapshot.
// It sends ZERO emails: it never calls the scheduler/dispatch. Sending only ever happens through the
// authorized scheduler on its own schedule.

import { listLeads, getLead, getSettings, updateSettings, countSentEmailsBetween } from "../repo";
import type { Lead } from "../types";
import { gatherDeliveryContext } from "./refill-context";
import { assessDeliveryReadiness, tallyFunnel, type DeliveryContext } from "./delivery-ready";
import { assessReserve, planRefill, blendRates, refillShouldStop, buildVisibility, emptyCheckpoint, DEFAULT_REFILL_POLICY, type RefillCheckpoint, type RefillPolicy } from "./refill";
import { selectDailyBatch, type BatchPlan } from "./materialize-batch";
import { capState, laDayBoundsUtc, GLOBAL_DAILY_CAP } from "./daily-cap";

// Pipeline stages that are terminal or already-engaged — never part of the cold-ready reserve.
const NON_RESERVE_STAGES = new Set([
  "Contacted", "Follow-Up", "Meeting Booked", "Discovery Complete", "Proposal Sent", "Won", "Lost",
  "Nurture", "Disqualified", "Proposal Accepted", "Agreement Signed", "Deposit Paid",
]);

export interface RefillCycleOptions {
  now?: Date;
  discover?: boolean;      // actually run bounded discovery this cycle (default false = measure/plan only)
  discoverCap?: number;    // hard per-cycle discovery ceiling (protects Places budget)
  maxLeads?: number;       // cap how many leads we resolve context for (protects DB)
  policy?: RefillPolicy;
}

export interface RefillCycleReport {
  ranAt: string;
  emailsSentDuringRefill: 0;   // invariant: refill never sends
  reserveBefore: number;
  reserveAfter: number;        // same as before unless discovery promoted leads (it discovers, not promotes)
  reserve: ReturnType<typeof assessReserve>;
  funnel: ReturnType<typeof tallyFunnel>;
  plan: ReturnType<typeof planRefill>;
  discovery: { ran: boolean; requested: number; examined: number; qualified: number; territoriesBeyondLA: string[]; note: string } | null;
  batch: BatchPlan;
  cap: ReturnType<typeof capState>;
  visibility: ReturnType<typeof buildVisibility>;
  checkpoint: RefillCheckpoint;
  stop: { stop: boolean; why: string };
  geographicDistribution: Record<string, number>;
}

export async function runRefillCycle(opts: RefillCycleOptions = {}): Promise<RefillCycleReport> {
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? DEFAULT_REFILL_POLICY;
  const maxLeads = opts.maxLeads ?? 2500;

  // 1) Measure the reserve + funnel over in-funnel candidates (has website, not already engaged).
  const all: Lead[] = await listLeads();
  const candidates = all
    .filter((l) => !!l.website && !NON_RESERVE_STAGES.has(String((l as { pipelineStage?: string }).pipelineStage ?? "")))
    .slice(0, maxLeads);
  const contexts: DeliveryContext[] = [];
  for (const lead of candidates) contexts.push(await gatherDeliveryContext(lead));
  const verdicts = contexts.map((ctx) => ({ ctx, verdict: assessDeliveryReadiness(ctx) }));
  const funnel = tallyFunnel(verdicts);
  const readyContexts = verdicts.filter((v) => v.verdict.ready).map((v) => v.ctx);
  const reserveBefore = readyContexts.length;

  // 2) Size the shortfall + discovery target.
  const reserve = assessReserve(reserveBefore, policy);
  const rates = blendRates(funnel);
  const plan = planRefill(reserve, rates, policy);

  // Geographic distribution of the ready reserve (proves coverage beyond one metro).
  const geographicDistribution: Record<string, number> = {};
  for (const c of readyContexts) { const k = (c.state || "??").toUpperCase(); geographicDistribution[k] = (geographicDistribution[k] ?? 0) + 1; }

  // 3) Global cap state for the LA accounting date (the batch can't exceed what's left today).
  const bounds = laDayBoundsUtc(now);
  const sentToday = await countSentEmailsBetween(bounds.startIso, bounds.endIso);
  const cap = capState(now, sentToday, GLOBAL_DAILY_CAP);

  // 4) Plan the next sending batch (≤20 strongest, geographically diverse, recipient-local windows).
  const batch = selectDailyBatch(readyContexts, { now, dailyTarget: policy.dailyTarget, capRemaining: cap.remaining });

  // 5) Load/seed the checkpoint.
  const settings = await getSettings();
  const checkpoint: RefillCheckpoint = { ...(emptyCheckpoint()), ...(settings.refillCheckpoint ?? {}) };

  // 6) Optionally run BOUNDED nationwide discovery (no sends). runProspecting rotates territories beyond LA,
  //    dedups nationally, and qualifies; it never contacts anyone.
  let discovery: RefillCycleReport["discovery"] = null;
  let lastCycleAdded = 0;
  if (opts.discover && plan.needed) {
    const requested = Math.max(0, Math.min(plan.discoverTarget, opts.discoverCap ?? 40));
    try {
      const { runProspecting } = await import("../prospecting");
      const run = await runProspecting({ trigger: "refill", count: requested } as { trigger: "refill"; count: number });
      lastCycleAdded = Number(run.addedToToday ?? 0);
      // Prove coverage beyond Los Angeles from the NEW leads' own locations.
      const addedIds = Array.isArray(run.addedLeadIds) ? run.addedLeadIds : [];
      const locs: string[] = [];
      for (const id of addedIds.slice(0, 40)) {
        const l = await getLead(id).catch(() => null);
        const city = (l as { city?: string | null } | null)?.city ?? null;
        const state = (l as { state?: string | null } | null)?.state ?? null;
        if (city && String(city).toLowerCase() !== "los angeles") locs.push(`${city}, ${state ?? ""}`.trim());
      }
      discovery = {
        ran: true, requested,
        examined: Number(run.examined ?? 0),
        qualified: lastCycleAdded,
        territoriesBeyondLA: [...new Set(locs)].slice(0, 20),
        note: `runProspecting(refill) requested ${requested}; examined ${run.examined ?? 0}; qualified ${lastCycleAdded}; providerMode ${run.providerMode}`,
      };
      // Advance the checkpoint (rotation + budget + funnel).
      checkpoint.rotationOffset += lastCycleAdded;
      checkpoint.searchBudgetSpent += Number(run.examined ?? 0);
      checkpoint.lastRefillAt = now.toISOString();
    } catch (e) {
      discovery = { ran: false, requested, examined: 0, qualified: 0, territoriesBeyondLA: [], note: `discovery unavailable: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  checkpoint.updatedAt = now.toISOString();
  checkpoint.lastFunnel = funnel;
  checkpoint.lastReserveReady = reserveBefore;
  try { await updateSettings({ refillCheckpoint: checkpoint }); } catch { /* best-effort persist */ }

  const stop = refillShouldStop(reserve, checkpoint, opts.discover ? lastCycleAdded : 1);

  // Owner visibility — next geographic segments are surfaced from the discovery run when present.
  const nextLocations = discovery?.territoriesBeyondLA?.slice(0, 6) ?? [];
  const visibility = buildVisibility({ reserve, plan, funnel, tomorrowScheduled: batch.selected, nextLocations, checkpoint, policy });

  return {
    ranAt: now.toISOString(),
    emailsSentDuringRefill: 0,
    reserveBefore,
    reserveAfter: reserveBefore, // discovery adds to the funnel, not instantly to the ready reserve
    reserve, funnel, plan, discovery, batch, cap, visibility, checkpoint, stop, geographicDistribution,
  };
}
