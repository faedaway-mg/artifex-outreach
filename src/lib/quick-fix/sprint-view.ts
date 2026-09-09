// ─────────────────────────────────────────────────────────────────────────────
// SPRINT VIEW — assemble the Quick-Cash graduation scoreboard from stored jobs +
// customers. Read-only; honest counts only (no fabricated progress). Defensive
// about optional persisted sub-state (completion evidence, reference permission).
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import { familyOf } from "./catalog";
import { buildSprintScoreboard, capabilityEvidenceExport, type SprintJob, type SprintCustomer, type SprintScoreboard, type CapabilityEvidence } from "./sprint";

export interface SprintView { scoreboard: SprintScoreboard; capabilityEvidence: CapabilityEvidence[] }

export async function sprintScoreboardView(): Promise<SprintView> {
  const jobs = await store.listJobs();
  const state = await store.getState();

  const sJobs: SprintJob[] = [];
  for (const j of jobs) {
    const offer = await store.getOffer(j.offerId);
    const skuKey = offer?.capabilityKeys[0] ?? null;
    const evidence = (j as any).evidence;
    sJobs.push({
      offerId: j.offerId,
      state: j.state,
      priceCents: offer?.priceCents ?? 0,
      skuFamily: skuKey ? familyOf(skuKey) : null,
      deliveredAt: (j as any).jobDeliveredAt ?? null,
      hasCompletionEvidence: Array.isArray(evidence) && evidence.length > 0,
      isDemo: j.isDemo === true,
    });
  }

  // A lead with at least one REAL (non-demo) job is a real customer; a lead whose
  // only jobs are demo jobs is a demo-only customer and is excluded from real counts.
  const realJobLeadIds = new Set(jobs.filter((j) => j.isDemo !== true).map((j) => j.leadId));
  const completedLeadIds = new Set(jobs.filter((j) => j.isDemo !== true && (j.state === "DELIVERED" || j.state === "COMPLETE")).map((j) => j.leadId));
  const sCustomers: SprintCustomer[] = Object.values(state.customers).map((c: any) => ({
    leadId: c.leadId,
    purchases: c.offersPurchased?.length ?? 0,
    lifetimeRevenueCents: c.lifetimeRevenueCents ?? 0,
    maintenancePlanKey: c.maintenancePlanKey ?? null,
    hasCompletedJob: completedLeadIds.has(c.leadId),
    referenceApproved: c.referenceApproved ?? false,
    isDemo: !realJobLeadIds.has(c.leadId),
  }));

  return { scoreboard: buildSprintScoreboard(sJobs, sCustomers), capabilityEvidence: capabilityEvidenceExport(sJobs) };
}
