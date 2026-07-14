// ─────────────────────────────────────────────────────────────────────────────
// Follow-up sequence. No autonomous sending — each step becomes a Today task that
// Jordan approves. Sequence stops when the lead replies or opts out.
// ─────────────────────────────────────────────────────────────────────────────
import type { FollowUpStep, Lead } from "./types";
import { insertTask, updateLead, allTasks, updateTask } from "./repo";

export const DEFAULT_SEQUENCE: FollowUpStep[] = [
  { dayOffset: 0, label: "Initial outreach", message: "Initial personalized outreach." },
  {
    dayOffset: 3,
    label: "Brief follow-up",
    message: "Just following up on the note and Modernization Brief I sent — did you get a chance to look?",
  },
  {
    dayOffset: 7,
    label: "One additional observation",
    message: "One more thing I noticed that could help: a small change to how customers reach you could reduce missed inquiries.",
  },
  {
    dayOffset: 14,
    label: "Final low-pressure message",
    message: "I'll leave this here for now — if the timing is ever right to explore a modernization project, I'd be glad to talk.",
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
 */
export async function scheduleFollowUps(lead: Lead, startFrom = new Date(), timing = DEFAULT_SEQUENCE): Promise<void> {
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
