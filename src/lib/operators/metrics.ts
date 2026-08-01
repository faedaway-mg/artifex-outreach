// ─────────────────────────────────────────────────────────────────────────────
// Operator metrics — what each person is actually carrying and moving.
//
// Every number is derived from records that already exist (tasks, email sends,
// inbound replies, meetings) and attributed through the SAME ownership column the
// queue reads. Nothing is counted twice and nothing is invented: a metric with no
// evidence behind it reports null rather than zero, because "we don't know" and
// "it didn't happen" are different facts and only one of them is actionable.
//
// Pure: no I/O, no clock of its own.
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailSend, InboundMessage, Lead, Meeting, Operator, Task } from "../types";
import { computeWorkloads, TERMINAL_STAGES } from "./assignment";

export interface OperatorMetrics {
  operatorId: string;
  /** Businesses this operator is accountable for (finished ones excluded). */
  leadsOwned: number;
  callsCompletedToday: number;
  emailsSentToday: number;
  reviewsDeliveredToday: number;
  followUpsDue: number;
  meetingsBooked: number;
  /** Replies ÷ businesses emailed, across everything they own. null = nobody emailed yet. */
  responseRate: number | null;
  /** Median hours from an outbound send to the reply it earned. null = no replies yet. */
  medianResponseHours: number | null;
  /** Businesses with work due today. */
  dueToday: number;
  capacity: number;
  /** dueToday ÷ capacity, as a fraction. Can exceed 1 — an honest overload reads > 100%. */
  load: number;
  lastActiveAt: string | null;
}

const sameDay = (iso: string | null | undefined, ref: Date): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeOperatorMetrics(input: {
  operators: Operator[];
  leads: Lead[];
  tasks: Task[];
  emailSends: EmailSend[];
  inbound: InboundMessage[];
  meetings: Meeting[];
  now: Date;
}): OperatorMetrics[] {
  const { operators, leads, tasks, emailSends, inbound, meetings, now } = input;
  const loads = computeWorkloads(operators, leads, tasks, now);
  const ownerOf = new Map(leads.map((l) => [l.id, l.assignedTo]));
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  // First outbound and first reply per business — the two instants a response
  // time is measured between. Both come from records the send pipeline already
  // writes, so nothing new has to be tracked to answer the question.
  const firstSendAt = new Map<string, number>();
  for (const s of emailSends) {
    if (!s.leadId || !s.sentAt) continue;
    const at = new Date(s.sentAt).getTime();
    const prev = firstSendAt.get(s.leadId);
    if (prev === undefined || at < prev) firstSendAt.set(s.leadId, at);
  }
  const firstReplyAt = new Map<string, number>();
  for (const m of inbound) {
    const at = new Date(m.receivedAt).getTime();
    const prev = firstReplyAt.get(m.leadId);
    if (prev === undefined || at < prev) firstReplyAt.set(m.leadId, at);
  }

  const blank = (op: Operator): OperatorMetrics => ({
    operatorId: op.id,
    leadsOwned: 0, callsCompletedToday: 0, emailsSentToday: 0, reviewsDeliveredToday: 0,
    followUpsDue: 0, meetingsBooked: 0, responseRate: null, medianResponseHours: null,
    dueToday: 0, capacity: op.dailyCapacity, load: 0, lastActiveAt: op.lastActiveAt,
  });

  const out = new Map<string, OperatorMetrics>(operators.map((op) => [op.id, blank(op)]));
  const emailed = new Map<string, number>();
  const replied = new Map<string, number>();
  const responseHours = new Map<string, number[]>();

  for (const lead of leads) {
    const owner = lead.assignedTo && out.has(lead.assignedTo) ? lead.assignedTo : null;
    if (!owner || TERMINAL_STAGES.has(lead.pipelineStage)) continue;
    const sent = firstSendAt.get(lead.id);
    if (sent === undefined) continue;
    emailed.set(owner, (emailed.get(owner) ?? 0) + 1);
    const reply = firstReplyAt.get(lead.id);
    if (reply !== undefined && reply >= sent) {
      replied.set(owner, (replied.get(owner) ?? 0) + 1);
      const hours = (reply - sent) / 3_600_000;
      responseHours.set(owner, [...(responseHours.get(owner) ?? []), hours]);
    }
  }

  for (const task of tasks) {
    const owner = ownerOf.get(task.leadId);
    if (!owner) continue;
    const m = out.get(owner);
    if (!m) continue;
    if (task.status === "done" && sameDay(task.updatedAt, now)) {
      if (task.type === "call") m.callsCompletedToday += 1;
      if (task.type === "review_and_send" || task.type === "review") m.reviewsDeliveredToday += 1;
    }
    if (task.status === "open" && task.type === "follow_up") {
      const snoozed = task.snoozedUntil && new Date(task.snoozedUntil).getTime() > now.getTime();
      if (!snoozed && new Date(task.dueAt).getTime() <= endOfToday) m.followUpsDue += 1;
    }
  }

  for (const s of emailSends) {
    if (!s.leadId || !s.sentAt || !sameDay(s.sentAt, now)) continue;
    const owner = ownerOf.get(s.leadId);
    const m = owner ? out.get(owner) : undefined;
    if (m) m.emailsSentToday += 1;
  }

  for (const meeting of meetings) {
    const owner = ownerOf.get(meeting.leadId);
    const m = owner ? out.get(owner) : undefined;
    if (m && new Date(meeting.scheduledAt).getTime() >= now.getTime()) m.meetingsBooked += 1;
  }

  for (const m of out.values()) {
    const w = loads.get(m.operatorId);
    if (w) { m.leadsOwned = w.leadsOwned; m.dueToday = w.dueToday; m.capacity = w.capacity; }
    m.load = m.capacity > 0 ? m.dueToday / m.capacity : 0;
    const sent = emailed.get(m.operatorId) ?? 0;
    m.responseRate = sent > 0 ? (replied.get(m.operatorId) ?? 0) / sent : null;
    m.medianResponseHours = median(responseHours.get(m.operatorId) ?? []);
  }

  return operators.map((op) => out.get(op.id)!);
}
