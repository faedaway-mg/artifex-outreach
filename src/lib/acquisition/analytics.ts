// Acquisition analytics — historical operating data available immediately, before
// any live sending. Small samples must be labeled in the UI.
import type { Lead, AcquisitionPlan, Meeting, Proposal, Suppression, AcquisitionFeedback } from "../types";

export interface AcqMetrics {
  strategyDistribution: [string, number][];
  totalPlans: number;
  approvedPlans: number;
  rejectedPlans: number;
  pendingPlans: number;
  approvalRate: number; // approved / decided
  avgTimeToApprovalHours: number | null;
  overrides: number;
  avgEstValue: number;
  assetCostByStrategy: [string, number][];
  meetings: number;
  proposalsSent: number;
  won: number;
  proposalConversion: number; // won / proposalsSent
  winRate: number; // won / approvedPlans
  suppressionRate: number; // suppressions / leads
  manualReview: number;
  assisted: number;
}

export function acquisitionMetrics(
  leads: Lead[], plans: AcquisitionPlan[], meetings: Meeting[], proposals: Proposal[], suppressions: Suppression[], feedback: AcquisitionFeedback[],
): AcqMetrics {
  const dist: Record<string, number> = {};
  for (const l of leads) if (l.acquisitionStrategy) dist[l.acquisitionStrategy] = (dist[l.acquisitionStrategy] ?? 0) + 1;

  const approved = plans.filter((p) => p.approvalStatus === "approved");
  const rejected = plans.filter((p) => p.approvalStatus === "rejected");
  const pending = plans.filter((p) => p.approvalStatus === "pending");
  const decided = approved.length + rejected.length;

  const approvalTimes = approved
    .filter((p) => p.approvedAt)
    .map((p) => (+new Date(p.approvedAt!) - +new Date(p.createdAt)) / 3_600_000)
    .filter((h) => h >= 0);
  const avgTimeToApprovalHours = approvalTimes.length ? Math.round((approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length) * 10) / 10 : null;

  const valued = leads.filter((l) => l.acquisitionStrategy && l.estimatedValueLow && l.estimatedValueHigh);
  const avgEstValue = valued.length ? Math.round(valued.reduce((s, l) => s + (l.estimatedValueLow! + l.estimatedValueHigh!) / 2, 0) / valued.length) : 0;

  const costByStrat: Record<string, number> = {};
  for (const p of plans) costByStrat[p.strategy] = Math.round(((costByStrat[p.strategy] ?? 0) + p.estimatedCost) * 100) / 100;

  const proposalsSent = proposals.filter((p) => p.status !== "draft").length;
  const won = leads.filter((l) => l.pipelineStage === "Won").length;

  return {
    strategyDistribution: Object.entries(dist).sort((a, b) => b[1] - a[1]),
    totalPlans: plans.length, approvedPlans: approved.length, rejectedPlans: rejected.length, pendingPlans: pending.length,
    approvalRate: decided ? Math.round((approved.length / decided) * 100) : 0,
    avgTimeToApprovalHours, overrides: feedback.filter((f) => f.field === "strategy").length,
    avgEstValue, assetCostByStrategy: Object.entries(costByStrat).sort((a, b) => b[1] - a[1]),
    meetings: meetings.length, proposalsSent, won,
    proposalConversion: proposalsSent ? Math.round((won / proposalsSent) * 100) : 0,
    winRate: approved.length ? Math.round((won / approved.length) * 100) : 0,
    suppressionRate: leads.length ? Math.round((suppressions.length / leads.length) * 100) : 0,
    manualReview: dist["Manual Review"] ?? 0, assisted: dist["Assisted"] ?? 0,
  };
}
