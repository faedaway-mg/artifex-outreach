// Live allocation snapshot (mandate 1). Reads today's demand (qualified first-touch packages due + due
// follow-ups) and what each group has ALREADY sent this LA day, then runs the pure allocator. Both cron
// runners call this and pass their group's per-tick limit, so the 10/10 reserve (with cross-transfer) is
// honored regardless of which tick fires first. Read-only; sends nothing.
import { allEmailSends, allSteps, allPlans, listLeads, isSuppressed } from "../repo";
import { validEmail } from "../acquisition/compliance";
import { dueScheduled } from "./scheduled-batch";
import { laDayBoundsUtc } from "../acquisition/daily-cap";
import { allocateDailyCap, configuredReserves, type Allocation } from "./daily-allocation";

export interface AllocationState extends Allocation {
  firstDemand: number;
  followDemand: number;
  sentFirstToday: number;
  sentFollowToday: number;
  laDay: string;
}

export async function currentAllocation(now: Date = new Date()): Promise<AllocationState> {
  const bounds = laDayBoundsUtc(now);
  const nowIso = now.toISOString();
  const [sends, steps, plans, leads, dueFirst] = await Promise.all([
    allEmailSends(), allSteps(), allPlans(), listLeads(), dueScheduled(now),
  ]);
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const stepsByPlan = new Map<string, typeof steps>();
  for (const s of steps) { const a = stepsByPlan.get(s.planId) ?? []; a.push(s); stepsByPlan.set(s.planId, a); }

  // Already-sent split today (sent-family rows stamped within the LA accounting day).
  let sentFirstToday = 0, sentFollowToday = 0;
  for (const s of sends) {
    if (!s.sentAt || s.sentAt < bounds.startIso || s.sentAt >= bounds.endIso) continue;
    const st = s.stepId ? stepById.get(s.stepId) : undefined;
    if (st && st.stepNumber >= 2) sentFollowToday += 1; else sentFirstToday += 1;
  }

  // Follow-up DEMAND: due email steps (2+) on active/approved plans, prior initial sent, valid & unsuppressed.
  let followDemand = 0;
  for (const s of steps) {
    if (s.channel !== "email" || s.stepNumber < 2 || s.sentAt || s.stoppedAt) continue;
    if (!s.scheduledAt || s.scheduledAt > nowIso) continue;
    const plan = planById.get(s.planId);
    if (!plan || plan.status !== "active" || plan.approvalStatus !== "approved" || s.approvalStatus !== "approved") continue;
    const lead = leadById.get(plan.leadId);
    if (!lead || !validEmail(lead.publicEmail)) continue;
    const prior = (stepsByPlan.get(s.planId) ?? []).some((p) => p.channel === "email" && p.stepNumber < s.stepNumber && !!p.sentAt);
    if (!prior) continue;
    if (await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone })) continue;
    followDemand += 1;
  }

  const { reserveFirst, reserveFollow } = configuredReserves();
  const allocation = allocateDailyCap({ firstDemand: dueFirst.length, followDemand, sentFirstToday, sentFollowToday, reserveFirst, reserveFollow });
  return { ...allocation, firstDemand: dueFirst.length, followDemand, sentFirstToday, sentFollowToday, laDay: bounds.date };
}
