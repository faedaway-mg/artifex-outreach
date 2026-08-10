// ─────────────────────────────────────────────────────────────────────────────
// The work queue — organize WORK, not businesses.
//
// The operator opens the app and sees the work that exists today, grouped into
// focused batches (videos to record, emails to review, calls to make…), each already
// sorted by urgency. Every category has a count, an honest time estimate, and one
// button that drops into a batch flow. Deterministic. Time-bound work sorts first.
// ─────────────────────────────────────────────────────────────────────────────
import type { Task, TaskType, Lead } from "./types";
import { determineContactStrategy, strategyToWorkKind } from "./outreach/contact-strategy";
import { knownClosedNow } from "./timezone";

export type WorkKind = "discovery" | "follow-up" | "email" | "report" | "call" | "contact-form" | "instagram-dm" | "video" | "understand";

/** Every kind, for anywhere an operator has to choose from them. Display order. */
export const WORK_KINDS: readonly WorkKind[] = [
  "discovery", "follow-up", "email", "report", "call", "contact-form", "instagram-dm", "video", "understand",
] as const;

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

// Ordering reflects the operator's day: scheduled conversations first, then the
// MORNING/computer block (calls, then videos), then ANYTIME/mobile work (emails,
// follow-ups) and the rest. It is triage, not a lock — every batch is openable anytime.
const META: Record<WorkKind, KindMeta> = {
  discovery: { title: "Discovery calls today", blurb: "Conversations on the calendar — walk in ready.", perMinutes: 10, cta: "Prepare", urgency: 0, timeBound: true },
  call: { title: "Calls to make", blurb: "Morning work — reach businesses while they're open.", perMinutes: 6, cta: "Start calling", urgency: 1 },
  video: { title: "Videos to record", blurb: "Morning work — record personal walkthroughs at your computer.", perMinutes: 8, cta: "Start video batch", urgency: 1.5 },
  "follow-up": { title: "Follow-ups due", blurb: "Open threads ready for the next touch.", perMinutes: 2, cta: "Review follow-ups", urgency: 2 },
  email: { title: "Emails to send", blurb: "Anytime — review, approve, and send from your phone.", perMinutes: 3, cta: "Start sending", urgency: 2.5 },
  report: { title: "Reports waiting", blurb: "Business Technology Reviews ready for approval.", perMinutes: 5, cta: "Review reports", urgency: 3 },
  "contact-form": { title: "Contact forms to submit", blurb: "Reach out through their contact form.", perMinutes: 4, cta: "Start forms", urgency: 4.4 },
  "instagram-dm": { title: "Instagram DMs to send", blurb: "Instagram is the live channel — open with a warm DM.", perMinutes: 3, cta: "Start DMs", urgency: 4.6 },
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

/**
 * Strategy-aware bucketing: the initial-outreach task ("review_and_send") is routed
 * by the Contact Strategy engine, so the queue already knows the channel before the
 * operator opens the business. All other task types keep their fixed kind.
 */
export function workKindForTask(task: Task, lead: Lead | undefined): WorkKind {
  if (task.type === "review_and_send" && lead) {
    return strategyToWorkKind(determineContactStrategy(lead).kind);
  }
  return TASK_TO_KIND[task.type];
}

export function buildWorkQueue(input: {
  tasks: Task[];
  meetingsToday: Array<{ leadId: string; scheduledAt: string }>;
  leads: Map<string, Lead>;
  /** For business-hours-aware call filtering. Injected in tests; defaults to real time. */
  now?: Date;
}): WorkCategory[] {
  const { tasks, meetingsToday, leads } = input;
  const now = input.now ?? new Date();
  const byKind = new Map<WorkKind, string[]>();
  const push = (kind: WorkKind, leadId: string) => {
    const lead = leads.get(leadId);
    if (!lead) return;
    // A PHONE-call task for a business we can prove is closed right now does not
    // belong on the active call board — it would just be a locked door. This is the
    // ONLY channel we withhold: asynchronous work (email, forms, DMs) is unaffected,
    // and only RELIABLE hours withhold anyone (knownClosedNow fails open on unknowns).
    if (kind === "call" && knownClosedNow(lead, now)) return;
    const arr = byKind.get(kind) ?? [];
    if (!arr.includes(leadId)) arr.push(leadId); // dedupe within a batch
    byKind.set(kind, arr);
  };

  // Time-bound conversations first (kept in chronological order).
  for (const m of [...meetingsToday].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))) push("discovery", m.leadId);
  // Then the prioritized task queue (already urgency-sorted upstream). The initial
  // outreach task is bucketed by CONTACT STRATEGY — the single source of truth for the
  // channel — so a no-email business lands in Calls, not Emails. Everything else keeps
  // its type-based kind, so email-first businesses behave exactly as before.
  for (const t of tasks) push(workKindForTask(t, leads.get(t.leadId)), t.leadId);

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

// ─────────────────────────────────────────────────────────────────────────────
// Channel-aware capacity — calls and emails are PARALLEL operator streams.
//
// The original queue capped the whole day with a single number (dailyQueueSize=8)
// applied to a priority-sorted list. Because follow-ups (70) and calls (50–65) sort
// above initial email work (40), that one combined cap let calls fill the day and
// leave legitimate email-first leads stranded beyond the cap — the operator saw a
// full "Calls to make" board and an empty "Emails to send" one. These functions cap
// each stream INDEPENDENTLY so email capacity is comparable to call capacity, and a
// day can hold ~10 calls + ~10 emails instead of 8 of whichever sorts highest.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CALL_TARGET = 10;
export const DEFAULT_EMAIL_TARGET = 10;
export const DEFAULT_VIDEO_TARGET = 3; // manual video work — a conservative daily target

/** The operator streams a task can draw capacity from. Calls, videos, and emails are the
 *  three primary outreach streams, each capped INDEPENDENTLY so none starves another. */
export interface ChannelCapacity {
  /** Phone calls to place. */
  call: number;
  /** Personal videos to record (morning/computer work). */
  video: number;
  /** Emails to send (initial + follow-up) — bounded by warm-up-safe daily capacity. */
  email: number;
  /** Everything else (reports, understand, forms, DMs) — a shared budget. */
  other: number;
}

/** Which capacity stream a work kind draws from. Follow-ups are email sends, so they
 *  share the email stream's warm-up budget; videos get their own stream. */
export function channelOf(kind: WorkKind): keyof ChannelCapacity {
  if (kind === "call") return "call";
  if (kind === "video") return "video";
  if (kind === "email" || kind === "follow-up") return "email";
  return "other";
}

/**
 * Resolve the per-stream capacity for a day. Email capacity is the warm-up-safe daily
 * ceiling MINUS what has already gone out today, so deliverability protection wins
 * over raw volume: once the day's safe sends are spent, the email stream reports zero
 * (and the deferred leads simply become eligible again tomorrow — nothing is dropped).
 */
export function channelCapacity(opts: {
  callTarget?: number | null;
  emailTarget?: number | null;
  videoTarget?: number | null;
  otherBudget: number;
  emailsSentToday?: number;
}): ChannelCapacity {
  const call = Math.max(0, opts.callTarget ?? DEFAULT_CALL_TARGET);
  const emailTarget = Math.max(0, opts.emailTarget ?? DEFAULT_EMAIL_TARGET);
  const email = Math.max(0, emailTarget - Math.max(0, opts.emailsSentToday ?? 0));
  const video = Math.max(0, opts.videoTarget ?? DEFAULT_VIDEO_TARGET);
  return { call, video, email, other: Math.max(0, opts.otherBudget) };
}

/**
 * Choose which due tasks to SURFACE today, capping each stream independently. Input is
 * the full priority-sorted due-task set (from todaysTasks with no limit); output is the
 * subset that fits within each stream's capacity, counted by DISTINCT BUSINESS so a
 * lead with two tasks in one stream spends one slot. Known-closed CALL leads are skipped
 * here too (composing with the business-hours fix) so a locked door never costs a call
 * slot. Replaces the old single `.slice(0, dailyQueueSize)`.
 */
export function surfaceTodaysTasks(input: {
  tasks: Task[];
  leads: Map<string, Lead>;
  capacity: ChannelCapacity;
  now?: Date;
}): Task[] {
  const { tasks, leads, capacity } = input;
  const now = input.now ?? new Date();
  const usedLeads: Record<keyof ChannelCapacity, Set<string>> = { call: new Set(), video: new Set(), email: new Set(), other: new Set() };
  const out: Task[] = [];
  for (const t of tasks) {
    const lead = leads.get(t.leadId);
    if (!lead) continue;
    const kind = workKindForTask(t, lead);
    if (kind === "call" && knownClosedNow(lead, now)) continue; // a locked door is not work
    const ch = channelOf(kind);
    const used = usedLeads[ch];
    if (!used.has(t.leadId)) {
      if (used.size >= capacity[ch]) continue; // this stream is full → defer the lead
      used.add(t.leadId);
    }
    out.push(t);
  }
  return out;
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
