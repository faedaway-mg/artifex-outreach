// ─────────────────────────────────────────────────────────────────────────────
// Team timeline — the complete operational history of one business.
//
// The promise is that nothing disappears when a business changes hands. The new
// operator inherits the whole story, in order: who owned it, what was tried, what
// came back, and why it moved. That is only possible because ownership changes go
// into `audit_log` alongside everything else, rather than into a private table
// that a reassignment would orphan.
//
// Pure: it merges records that already exist. It creates no new source of truth.
// ─────────────────────────────────────────────────────────────────────────────
import type { AuditEntry, EmailSend, InboundMessage, Meeting, Operator, Task } from "../types";
import { shortName } from "./model";

export type TimelineKind = "ownership" | "outreach" | "response" | "work" | "meeting";

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  /** One line, past tense, readable months later with no other context. */
  label: string;
  /** Who did it, resolved to a name where possible. */
  actor: string | null;
  detail?: string;
}

const nameOf = (operators: Operator[], id: string | null | undefined): string | null => {
  if (!id) return null;
  if (id === "system") return "Automatically";
  if (id === "cron") return "Scheduled run";
  const op = operators.find((o) => o.id === id);
  return op ? shortName(op) : id;
};

function ownershipLabel(entry: AuditEntry, operators: Operator[]): string {
  const meta = (entry.meta ?? {}) as { from?: string | null; to?: string | null; reason?: string };
  const to = nameOf(operators, meta.to) ?? "an operator";
  const from = nameOf(operators, meta.from);
  if (entry.action === "lead.transferred") return `Transferred${from ? ` from ${from}` : ""} to ${to}`;
  if (entry.action === "lead.reassigned") return `Reassigned${from ? ` from ${from}` : ""} to ${to}`;
  return `Assigned to ${to}`;
}

const TASK_DONE_LABEL: Record<string, string> = {
  call: "Call completed",
  review: "Business reviewed",
  review_and_send: "Review sent",
  follow_up: "Follow-up sent",
  prepare_video: "Video prepared",
  prepare_meeting: "Discovery prepared",
  prepare_proposal: "Evolution plan prepared",
};

export function buildLeadTimeline(input: {
  audit: AuditEntry[];
  tasks: Task[];
  emailSends: EmailSend[];
  inbound: InboundMessage[];
  meetings: Meeting[];
  operators: Operator[];
}): TimelineEvent[] {
  const { audit, tasks, emailSends, inbound, meetings, operators } = input;
  const events: TimelineEvent[] = [];

  for (const entry of audit) {
    if (entry.action.startsWith("lead.assigned") || entry.action === "lead.reassigned" || entry.action === "lead.transferred") {
      const meta = (entry.meta ?? {}) as { reason?: string };
      events.push({
        at: entry.createdAt,
        kind: "ownership",
        label: ownershipLabel(entry, operators),
        actor: nameOf(operators, entry.actor),
        detail: meta.reason,
      });
    } else if (entry.action.startsWith("lead.call-outcome")) {
      const meta = (entry.meta ?? {}) as { outcome?: string };
      events.push({
        at: entry.createdAt,
        kind: "work",
        label: meta.outcome ? `Call outcome — ${meta.outcome}` : "Call outcome recorded",
        actor: nameOf(operators, entry.actor),
      });
    }
  }

  for (const task of tasks) {
    if (task.status !== "done") continue;
    const label = TASK_DONE_LABEL[task.type];
    if (!label) continue;
    events.push({ at: task.updatedAt, kind: "work", label, actor: null, detail: task.title });
  }

  for (const send of emailSends) {
    if (send.sentAt) events.push({ at: send.sentAt, kind: "outreach", label: "Email sent", actor: null, detail: send.subject });
    if (send.openedAt) events.push({ at: send.openedAt, kind: "response", label: "Email opened", actor: null });
    if (send.clickedAt) events.push({ at: send.clickedAt, kind: "response", label: "Link clicked", actor: null });
    if (send.bouncedAt) events.push({ at: send.bouncedAt, kind: "response", label: "Email bounced", actor: null });
  }

  for (const msg of inbound) {
    events.push({ at: msg.receivedAt, kind: "response", label: "They replied", actor: null, detail: msg.subject || undefined });
  }

  for (const meeting of meetings) {
    events.push({ at: meeting.createdAt, kind: "meeting", label: "Meeting booked", actor: null });
    if (meeting.outcome && meeting.outcome !== "pending") {
      events.push({ at: meeting.updatedAt, kind: "meeting", label: `Meeting ${meeting.outcome}`, actor: null });
    }
  }

  // Newest first — the operator opening this needs the current state of the
  // relationship before its origin story.
  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
