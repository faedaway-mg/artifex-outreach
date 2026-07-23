// ─────────────────────────────────────────────────────────────────────────────
// The work queue — organize WORK, not businesses.
//
// The operator opens the app and sees the work that exists today, grouped into
// focused batches (videos to record, emails to review, calls to make…), each already
// sorted by urgency. Every category has a count, an honest time estimate, and one
// button that drops into a batch flow. Deterministic. Time-bound work sorts first.
// ─────────────────────────────────────────────────────────────────────────────
import type { Task, TaskType, Lead } from "./types";

export type WorkKind = "discovery" | "follow-up" | "email" | "report" | "call" | "video" | "understand";

export interface WorkCategory {
  kind: WorkKind;
  title: string;
  blurb: string;
  count: number;
  estMinutes: number;
  ctaLabel: string;
  href: string;
  leadIds: string[];
  /** Lower sorts first. */
  urgency: number;
  timeBound: boolean;
}

interface KindMeta { title: string; blurb: string; perMinutes: number; cta: string; urgency: number; timeBound?: boolean }

const META: Record<WorkKind, KindMeta> = {
  discovery: { title: "Discovery calls today", blurb: "Conversations on the calendar — walk in ready.", perMinutes: 10, cta: "Prepare", urgency: 0, timeBound: true },
  "follow-up": { title: "Follow-ups due", blurb: "Open threads ready for the next touch.", perMinutes: 2, cta: "Review follow-ups", urgency: 1 },
  email: { title: "Initial emails ready", blurb: "First-contact emails drafted and waiting for your eyes.", perMinutes: 3, cta: "Review emails", urgency: 2 },
  report: { title: "Reports waiting", blurb: "Business Technology Reviews ready for approval.", perMinutes: 5, cta: "Review reports", urgency: 3 },
  call: { title: "Calls to make", blurb: "Businesses ready for a quick phone call.", perMinutes: 6, cta: "Start calling", urgency: 4 },
  video: { title: "Videos to record", blurb: "Businesses ready for a personal video.", perMinutes: 8, cta: "Start video batch", urgency: 5 },
  understand: { title: "New businesses to understand", blurb: "Fresh businesses worth getting to know.", perMinutes: 5, cta: "Start reviewing", urgency: 6 },
};

const TASK_TO_KIND: Record<TaskType, WorkKind> = {
  prepare_video: "video",
  review_and_send: "email",
  follow_up: "follow-up",
  call: "call",
  prepare_proposal: "report",
  prepare_meeting: "discovery",
  review: "understand",
};

/** Which batch a task belongs to. */
export function kindOfTask(type: TaskType): WorkKind {
  return TASK_TO_KIND[type];
}

export function buildWorkQueue(input: {
  tasks: Task[];
  meetingsToday: Array<{ leadId: string; scheduledAt: string }>;
  leads: Map<string, Lead>;
}): WorkCategory[] {
  const { tasks, meetingsToday, leads } = input;
  const byKind = new Map<WorkKind, string[]>();
  const push = (kind: WorkKind, leadId: string) => {
    if (!leads.has(leadId)) return;
    const arr = byKind.get(kind) ?? [];
    if (!arr.includes(leadId)) arr.push(leadId); // dedupe within a batch
    byKind.set(kind, arr);
  };

  // Time-bound conversations first (kept in chronological order).
  for (const m of [...meetingsToday].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))) push("discovery", m.leadId);
  // Then the prioritized task queue (already urgency-sorted upstream).
  for (const t of tasks) push(TASK_TO_KIND[t.type], t.leadId);

  const cats: WorkCategory[] = [];
  for (const [kind, leadIds] of byKind) {
    if (leadIds.length === 0) continue;
    const m = META[kind];
    cats.push({
      kind, title: m.title, blurb: m.blurb, count: leadIds.length,
      estMinutes: leadIds.length * m.perMinutes,
      ctaLabel: m.cta, href: `/work/${kind}`, leadIds,
      urgency: m.urgency, timeBound: Boolean(m.timeBound),
    });
  }
  return cats.sort((a, b) => a.urgency - b.urgency);
}

/** The ordered lead list for one batch (for the batch runner). */
export function batchLeadIds(cats: WorkCategory[], kind: string): string[] {
  return cats.find((c) => c.kind === kind)?.leadIds ?? [];
}

export interface DailyMission {
  /** Businesses to move today (remaining + already done). */
  total: number;
  done: number;
  remaining: number;
  estMinutes: number;
}

/** Today's single objective: contact N businesses. Progress persists as work completes. */
export function buildDailyMission(cats: WorkCategory[], doneToday: number): DailyMission {
  const remaining = new Set(cats.flatMap((c) => c.leadIds)).size;
  return {
    total: remaining + doneToday,
    done: doneToday,
    remaining,
    estMinutes: cats.reduce((s, c) => s + c.estMinutes, 0),
  };
}

export function categoryTitle(kind: string): string {
  return (META as Record<string, KindMeta>)[kind]?.title ?? "Work";
}

export function minutesLabel(mins: number): string {
  if (mins <= 0) return "";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), r = mins % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
