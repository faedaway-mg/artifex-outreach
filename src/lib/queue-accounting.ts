// Queue accounting — the full, honest answer to "where did all my leads go?".
//
// Pure function over (leads, tasks, cap, now): classifies every lead into exactly one
// visibility bucket and every open task into surfaced/excluded with a named reason.
// Used by (1) the read-only ops script for production truth, (2) the Today summary so
// the operator can always see what remains, what waits, and what's exhausted, and
// (3) tests that pin the queue's behavior to reality.
import type { Lead, Task } from "@/lib/types";
import { workKindForTask, type WorkKind } from "@/lib/work-queue";

export interface QueueAccounting {
  totalLeads: number;
  openTasks: number;
  /** Tasks that surface on Today right now (due, unsnoozed, within the cap). */
  surfaced: number;
  /** Surfaced counts by kind of work (email/call/…): what the operator sees. */
  surfacedByKind: Partial<Record<WorkKind, number>>;
  /** Due + unsnoozed but cut by the daily cap — the silent starvation slice. */
  beyondCap: number;
  beyondCapByKind: Partial<Record<WorkKind, number>>;
  /** Open tasks whose dueAt is in the future (scheduled follow-ups). */
  waitingFuture: number;
  /** Open tasks snoozed past now. */
  snoozed: number;
  /** Tasks completed today (the mission's "done"). */
  completedToday: number;
  /** Leads with at least one open task (in the system's working set). */
  leadsWithOpenWork: number;
  /** Leads with NO open task at all — invisible to Today until work is created. */
  leadsWithNoWork: number;
  /** Of the no-work leads: how many are terminal (lost/disqualified/closed) vs active. */
  noWorkTerminal: number;
  noWorkActive: number;
}

const TERMINAL_STAGES = new Set(["Lost", "Disqualified", "Closed Won", "Closed Lost"]);

export function accountQueue(input: {
  leads: Lead[];
  tasks: Task[];
  cap: number;
  now?: Date;
}): QueueAccounting {
  const now = input.now ?? new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const leadById = new Map(input.leads.map((l) => [l.id, l]));

  const open = input.tasks.filter((t) => t.status === "open" && leadById.has(t.leadId));
  const snoozed = open.filter((t) => t.snoozedUntil && +new Date(t.snoozedUntil) > +now);
  const active = open.filter((t) => !snoozed.includes(t));
  const dueToday = active
    .filter((t) => +new Date(t.dueAt) <= +endOfToday)
    .sort((a, b) => b.priority - a.priority || +new Date(a.dueAt) - +new Date(b.dueAt));
  const waitingFuture = active.length - dueToday.length;

  const surfacedTasks = dueToday.slice(0, input.cap);
  const beyondCapTasks = dueToday.slice(input.cap);

  const byKind = (ts: Task[]): Partial<Record<WorkKind, number>> => {
    const acc: Partial<Record<WorkKind, number>> = {};
    for (const t of ts) {
      const k = workKindForTask(t, leadById.get(t.leadId));
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return acc;
  };

  const completedToday = input.tasks.filter(
    (t) => t.status === "done" && +new Date(t.updatedAt) >= +startOfToday && +new Date(t.updatedAt) <= +endOfToday,
  ).length;

  const leadsWithOpen = new Set(open.map((t) => t.leadId));
  const noWorkLeads = input.leads.filter((l) => !leadsWithOpen.has(l.id));
  const noWorkTerminal = noWorkLeads.filter((l) => TERMINAL_STAGES.has(l.pipelineStage)).length;

  return {
    totalLeads: input.leads.length,
    openTasks: open.length,
    surfaced: surfacedTasks.length,
    surfacedByKind: byKind(surfacedTasks),
    beyondCap: beyondCapTasks.length,
    beyondCapByKind: byKind(beyondCapTasks),
    waitingFuture,
    snoozed: snoozed.length,
    completedToday,
    leadsWithOpenWork: leadsWithOpen.size,
    leadsWithNoWork: noWorkLeads.length,
    noWorkTerminal,
    noWorkActive: noWorkLeads.length - noWorkTerminal,
  };
}
