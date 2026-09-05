// Live allocation snapshot (mandate 1). Reads today's demand (qualified first-touch packages due + due
// follow-ups) and what each group has ALREADY sent this LA day, then runs the pure allocator. Both cron
// runners call this and pass their group's per-tick limit, so the 10/10 reserve (with cross-transfer) is
// honored regardless of which tick fires first. Read-only; sends nothing.
import { allEmailSends, allSteps, allPlans, listLeads, isSuppressed } from "../repo";
import { validEmail } from "../acquisition/compliance";
import { listScheduledBindings } from "./scheduled-batch";
import { laDayBoundsUtc } from "../acquisition/daily-cap";
import { allocateDailyCap, configuredReserves, type Allocation } from "./daily-allocation";

/** PURE: how many first-touch bindings are eligible-and-sendable within THIS LA day's window — the
 *  day-scoped demand that fixes the starvation (counts today's whole batch, not just the instant-due ones).
 *  Excludes non-"scheduled" status, out-of-window instants, invalid recipients, and suppressed recipients. */
export function firstTouchDayEligible(
  bindings: Array<{ binding: { status: string; scheduledAt: string; recipient: string } }>,
  bounds: { startIso: string; endIso: string },
  isSupp: (email: string) => boolean,
): number {
  let n = 0;
  for (const { binding } of bindings) {
    if (binding.status !== "scheduled") continue;
    if (binding.scheduledAt < bounds.startIso || binding.scheduledAt >= bounds.endIso) continue;
    if (!validEmail(binding.recipient)) continue;
    if (isSupp(binding.recipient)) continue;
    n += 1;
  }
  return n;
}

export interface AllocationState extends Allocation {
  firstDemand: number;         // total first-touch demand for THIS LA day (sent today + eligible-today)
  followDemand: number;        // total follow-up demand for THIS LA day (sent today + eligible-today)
  firstEligibleToday: number;  // unsent, sendable first-touch bindings scheduled within today's window
  followEligibleToday: number; // unsent, eligible follow-up steps scheduled within today's window
  firstDeferred: number;       // first-touch demand that exceeds today's first-touch target
  followDeferred: number;      // follow-up demand that exceeds today's follow-up target
  sentFirstToday: number;
  sentFollowToday: number;
  laDay: string;
}

export async function currentAllocation(now: Date = new Date()): Promise<AllocationState> {
  const bounds = laDayBoundsUtc(now);
  const [sends, steps, plans, leads, allBindings] = await Promise.all([
    allEmailSends(), allSteps(), allPlans(), listLeads(), listScheduledBindings(),
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

  // FIRST-TOUCH demand — DAY-SCOPED (the starvation fix): count every first-touch binding scheduled within
  // TODAY's LA window that is still sendable (status scheduled, valid recipient, unsuppressed), NOT merely
  // the ones already past-due this instant. This holds the first-touch reserve for the whole day so an early
  // follow-up tick cannot borrow slots that later-in-window first-touches will need.
  // Pre-resolve suppression for today's candidate recipients, then count via the pure day-scoped helper.
  const todaysBindings = allBindings.filter(({ binding }) => binding.status === "scheduled" && binding.scheduledAt >= bounds.startIso && binding.scheduledAt < bounds.endIso);
  const suppressed = new Set<string>();
  for (const { binding } of todaysBindings) {
    if (binding.recipient && (await isSuppressed({ email: binding.recipient }))) suppressed.add(binding.recipient.toLowerCase());
  }
  const firstEligibleToday = firstTouchDayEligible(todaysBindings, bounds, (e) => suppressed.has(e.toLowerCase()));

  // FOLLOW-UP demand — also DAY-SCOPED: eligible email steps (2+) on active/approved plans, prior initial
  // sent, valid & unsuppressed, scheduled WITHIN today's window (due now or later today) — symmetric so the
  // follow-up reserve is likewise protected from first-touch borrowing (test 2).
  let followEligibleToday = 0;
  for (const s of steps) {
    if (s.channel !== "email" || s.stepNumber < 2 || s.sentAt || s.stoppedAt) continue;
    if (!s.scheduledAt || s.scheduledAt < bounds.startIso || s.scheduledAt >= bounds.endIso) continue;
    const plan = planById.get(s.planId);
    if (!plan || plan.status !== "active" || plan.approvalStatus !== "approved" || s.approvalStatus !== "approved") continue;
    const lead = leadById.get(plan.leadId);
    if (!lead || !validEmail(lead.publicEmail)) continue;
    const prior = (stepsByPlan.get(s.planId) ?? []).some((p) => p.channel === "email" && p.stepNumber < s.stepNumber && !!p.sentAt);
    if (!prior) continue;
    if (await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone })) continue;
    followEligibleToday += 1;
  }

  // A lane's day-demand = what it already sent today + what it still has eligible today. The allocator sizes
  // each lane's target from this full-day demand, so borrowing is only granted against genuinely-unused reserve.
  const firstDemand = sentFirstToday + firstEligibleToday;
  const followDemand = sentFollowToday + followEligibleToday;
  const { reserveFirst, reserveFollow } = configuredReserves();
  const allocation = allocateDailyCap({ firstDemand, followDemand, sentFirstToday, sentFollowToday, reserveFirst, reserveFollow });
  const firstDeferred = Math.max(0, firstDemand - allocation.firstTarget);
  const followDeferred = Math.max(0, followDemand - allocation.followTarget);
  return { ...allocation, firstDemand, followDemand, firstEligibleToday, followEligibleToday, firstDeferred, followDeferred, sentFirstToday, sentFollowToday, laDay: bounds.date };
}
