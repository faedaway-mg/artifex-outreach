// ─────────────────────────────────────────────────────────────────────────────
// Follow-up sequence. No autonomous sending — each step becomes a Today task that
// Jordan approves. Sequence stops when the lead replies or opts out.
//
// SOURCE OF TRUTH: the guidance text for each step is drawn from the approved
// Communication Guide (./communication-guide.ts §6.4 follow-up cadence + §7
// snippets). This file holds no independent copy — it inherits the guide's voice.
// ─────────────────────────────────────────────────────────────────────────────
import type { FollowUpStep, Lead } from "./types";
import { insertTask, updateLead, allTasks, updateTask, plansForLead } from "./repo";
import { SNIPPETS, OFFERINGS } from "./communication-guide";

export const DEFAULT_SEQUENCE: FollowUpStep[] = [
  { dayOffset: 0, label: "Initial outreach", message: "Initial personalized outreach." },
  {
    dayOffset: 3,
    label: "One more thought",
    message: `One more thought in case it's useful — no agenda. When a new customer first reaches out, how much of what happens next is still handled by hand? That's usually where the quiet time goes. ${SNIPPETS.ctas[0]}`,
  },
  {
    dayOffset: 7,
    label: "Offer the Review",
    message: `If it would help, the low-risk next step is a ${OFFERINGS.review} — a short, structured look at where the friction actually costs you, and a ranked plan you keep either way. ${SNIPPETS.reassurances[0]}`,
  },
  {
    dayOffset: 14,
    label: "Final low-pressure message",
    message: `I'll leave this here for now. ${SNIPPETS.reassurances[2]}`,
  },
];

function addDays(base: Date, days: number, hour = 9): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * Schedule the follow-up sequence for a lead from a given start date. Creates
 * `follow_up` tasks for each future step. Day-0 is treated as the initial
 * outreach (already handled) so we schedule steps after it.
 *
 * DEPRECATED — legacy Gmail-draft path only (see `markOutreachSentAction`).
 *
 * The authoritative sequence now lives in acquisition plans/steps, and due steps
 * become Today work via `comms/task-projection`. Two systems must never schedule
 * follow-ups for the same lead, so this NO-OPS for any lead that has a real plan.
 * The guard lives here rather than at the call site so every caller inherits it.
 */
export async function scheduleFollowUps(lead: Lead, startFrom = new Date(), timing = DEFAULT_SEQUENCE): Promise<void> {
  const plans = await plansForLead(lead.id);
  if (plans.some((p) => p.approvalStatus !== "rejected")) return;

  const future = timing.filter((s) => s.dayOffset > 0);
  const first = future[0];
  for (const step of future) {
    await insertTask({
      leadId: lead.id,
      type: "follow_up",
      title: `${step.label} — ${lead.businessName}`,
      dueAt: addDays(startFrom, step.dayOffset, 10),
      status: "open",
      priority: 65 - step.dayOffset,
      snoozedUntil: null,
    });
  }
  if (first) {
    await updateLead(lead.id, { nextFollowUpAt: addDays(startFrom, first.dayOffset, 10) });
  }
}

/** Stop future follow-ups (lead replied or opted out). */
export async function stopFollowUps(leadId: string): Promise<void> {
  for (const task of await allTasks()) {
    if (task.leadId === leadId && task.type === "follow_up" && task.status === "open") {
      await updateTask(task.id, { status: "skipped" });
    }
  }
  await updateLead(leadId, { nextFollowUpAt: null });
}
