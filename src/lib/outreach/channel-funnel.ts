// ─────────────────────────────────────────────────────────────────────────────
// Channel funnel — compare outreach paths from EXISTING sources of truth.
//
// Not a new analytics store. A pure roll-up over the audit log (call sessions),
// the email-send ledger, outreach responses, and meetings, so we can start to answer
// the only question that matters: for each minute of operator attention, which path
// (cold call vs value-first email → warm follow-up) produces qualified pipeline?
//
// Deliberately honest about provenance: every number cites the source it came from.
// A call is classified COLD vs WARM by whether the business had already been emailed
// BEFORE the call (the email-send ledger is the clock).
// ─────────────────────────────────────────────────────────────────────────────
import { CALL_SESSION_AUDIT_ACTION } from "./call-commit";

export interface AuditRowLite { action: string; targetId: string | null; meta: unknown; createdAt: string }
export interface EmailSendLite { leadId: string | null; sentAt: string | null }
export interface OutreachLite { leadId: string; responseStatus: string | null }
export interface MeetingLite { leadId: string | null; scheduledAt: string | null; outcome: string | null }

export interface ChannelFunnel {
  email: {
    /** Personalized emails the provider accepted (email-send ledger). */
    sent: number;
    /** Distinct businesses emailed. */
    businessesEmailed: number;
    /** Replies (outreach.responseStatus = "replied"). */
    replies: number;
  };
  warmCalls: {
    /** Calls placed to a business that had ALREADY been emailed — the value-first path. */
    attempted: number;
    answered: number;
  };
  coldCalls: {
    /** Calls placed to a business with NO prior email — the weakest position. */
    attempted: number;
    answered: number;
    /** Cold calls that at least earned an email address / permission to send. */
    emailCaptured: number;
  };
  /** Substantive conversations (reached a decision-maker / earned a send). */
  conversations: number;
  /** Meetings on the calendar. */
  meetingsBooked: number;
}

// Someone actually engaged (not a rung-out line or a machine).
const ANSWERED = new Set(["reached-dm", "contact-collected", "asked-to-send", "follow-up", "not-interested", "wrong-number"]);
// A real two-way conversation with someone who could act.
const SUBSTANTIVE = new Set(["reached-dm", "asked-to-send"]);

function outcomeOf(meta: unknown): string {
  return (meta && typeof meta === "object" && typeof (meta as { outcome?: unknown }).outcome === "string")
    ? (meta as { outcome: string }).outcome : "";
}
function capturedEmail(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as { outcome?: string; permission?: unknown; emailKind?: unknown; facts?: { email?: unknown } };
  if (m.outcome === "asked-to-send" || m.outcome === "contact-collected") return true;
  if (m.permission === true) return true;
  if (typeof m.emailKind === "string" && m.emailKind) return true;
  return typeof m.facts?.email === "string" && !!m.facts.email;
}

/**
 * Roll up channel performance. Pure over the passed arrays — the caller supplies them from the
 * existing repos (listAudit / allEmailSends / all outreach / allMeetings). A call is WARM when
 * the business had a sent email strictly before the call was recorded; otherwise COLD.
 */
export function channelFunnel(input: {
  audit: AuditRowLite[];
  emailSends: EmailSendLite[];
  outreach: OutreachLite[];
  meetings: MeetingLite[];
}): ChannelFunnel {
  const { audit, emailSends, outreach, meetings } = input;

  // Email side.
  const sent = emailSends.filter((s) => !!s.sentAt && !!s.leadId);
  const businessesEmailed = new Set(sent.map((s) => s.leadId));
  // Earliest sent-email time per business — the clock that makes a later call "warm".
  const firstEmailAt = new Map<string, number>();
  for (const s of sent) {
    const t = s.sentAt ? Date.parse(s.sentAt) : NaN;
    if (Number.isNaN(t) || !s.leadId) continue;
    const prev = firstEmailAt.get(s.leadId);
    if (prev === undefined || t < prev) firstEmailAt.set(s.leadId, t);
  }
  const replies = outreach.filter((o) => o.responseStatus === "replied").length;

  // Call side — every recorded call session is one attempt.
  const calls = audit.filter((a) => a.action === CALL_SESSION_AUDIT_ACTION);
  const funnel: ChannelFunnel = {
    email: { sent: sent.length, businessesEmailed: businessesEmailed.size, replies },
    warmCalls: { attempted: 0, answered: 0 },
    coldCalls: { attempted: 0, answered: 0, emailCaptured: 0 },
    conversations: 0,
    meetingsBooked: 0,
  };
  for (const c of calls) {
    const outcome = outcomeOf(c.meta);
    const answered = ANSWERED.has(outcome);
    const emailedAt = c.targetId ? firstEmailAt.get(c.targetId) : undefined;
    const warm = emailedAt !== undefined && Date.parse(c.createdAt) >= emailedAt;
    if (warm) {
      funnel.warmCalls.attempted += 1;
      if (answered) funnel.warmCalls.answered += 1;
    } else {
      funnel.coldCalls.attempted += 1;
      if (answered) funnel.coldCalls.answered += 1;
      if (capturedEmail(c.meta)) funnel.coldCalls.emailCaptured += 1;
    }
    if (SUBSTANTIVE.has(outcome)) funnel.conversations += 1;
  }

  funnel.meetingsBooked = meetings.filter((m) => !!m.scheduledAt).length;
  return funnel;
}
