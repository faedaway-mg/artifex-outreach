// Idempotent sequence stop. Called by reply/opt-out/meeting/won/lost/suppression
// handlers. Only affects active/pending plans, so webhook retries never duplicate
// work or resurrect a stopped sequence.
import { plansForLead, updatePlan, stepsForPlan, updateStep } from "../repo";

const STOPPABLE = new Set(["prepared", "active", "paused"]);

export async function stopPlansForLead(leadId: string, reason: string): Promise<number> {
  const plans = await plansForLead(leadId);
  let stopped = 0;
  for (const plan of plans) {
    if (!STOPPABLE.has(plan.status)) continue; // idempotent: already stopped/completed
    await updatePlan(plan.id, { status: "stopped", stopReason: reason, completedAt: new Date().toISOString(), nextScheduledAt: null });
    for (const step of await stepsForPlan(plan.id)) {
      if (!step.sentAt && !step.stoppedAt) await updateStep(step.id, { stoppedAt: new Date().toISOString(), stopReason: reason });
    }
    stopped += 1;
  }
  return stopped;
}

export async function pausePlansForLead(leadId: string, reason: string): Promise<void> {
  for (const plan of await plansForLead(leadId)) {
    if (plan.status === "active") await updatePlan(plan.id, { status: "paused", pausedAt: new Date().toISOString(), pauseReason: reason, nextScheduledAt: null });
  }
}
