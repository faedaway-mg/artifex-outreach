// ─────────────────────────────────────────────────────────────────────────────
// Conversation state — a derived, timestamped read-model of a lead's communication
// lifecycle:
//
//   Prepared → Queued → Sending → Sent → Delivered → Opened → Clicked → Replied
//            → Meeting → Proposal → Won
//
// It is COMPUTED from existing records (plans, send ledger, inbound messages,
// meetings, proposals, lead stage) rather than stored, so it can never drift from
// the source of truth. Every transition carries the timestamp of the record that
// caused it. Negative signals (bounced/complained/unsubscribed/failed, stopped)
// are surfaced as flags without corrupting the forward lifecycle.
// ─────────────────────────────────────────────────────────────────────────────
import { plansForLead, emailSendsForLead, inboundForLead, meetingsForLead, proposalsForLead, getLead } from "../repo";
import type { EmailSend } from "../types";

export const CONVERSATION_STAGES = [
  "Prepared", "Queued", "Sending", "Sent", "Delivered", "Opened", "Clicked", "Replied", "Meeting", "Proposal", "Won",
] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];
const ORDER = new Map(CONVERSATION_STAGES.map((s, i) => [s, i]));

export interface ConversationTransition {
  stage: ConversationStage;
  at: string;
  detail?: string;
}

export interface ConversationState {
  leadId: string;
  currentStage: ConversationStage | null;
  transitions: ConversationTransition[]; // ordered by lifecycle, each timestamped
  flags: string[]; // bounced / complained / unsubscribed / failed / stopped
  lastActivityAt: string | null;
}

// Earliest non-null timestamp across a set of records for a given field.
function earliest<T>(rows: T[], field: (r: T) => string | null | undefined): string | null {
  let min: string | null = null;
  for (const r of rows) {
    const v = field(r);
    if (v && (min === null || v < min)) min = v;
  }
  return min;
}

const HUMAN_REPLY_EXCLUDED = new Set(["Out Of Office", "Bounce"]);

export async function conversationState(leadId: string): Promise<ConversationState> {
  const [lead, plans, sends, inbound, meetings, proposals] = await Promise.all([
    getLead(leadId), plansForLead(leadId), emailSendsForLead(leadId), inboundForLead(leadId), meetingsForLead(leadId), proposalsForLead(leadId),
  ]);

  const stamp = (stage: ConversationStage, at: string | null, detail?: string): ConversationTransition | null =>
    at ? { stage, at, detail } : null;

  const sentField = (f: keyof EmailSend) => earliest(sends, (s) => s[f] as string | null);
  const humanReply = inbound.filter((m) => !HUMAN_REPLY_EXCLUDED.has(m.classification ?? ""));
  const acceptedProposal = proposals.find((p) => p.status === "accepted" || p.acceptedAt);

  const candidates: (ConversationTransition | null)[] = [
    stamp("Prepared", earliest(plans, (p) => p.createdAt)),
    stamp("Queued", sentField("queuedAt")),
    stamp("Sending", sentField("sendingAt")),
    stamp("Sent", sentField("sentAt")),
    stamp("Delivered", sentField("deliveredAt")),
    stamp("Opened", sentField("openedAt")),
    stamp("Clicked", sentField("clickedAt")),
    stamp("Replied", earliest(humanReply, (m) => m.receivedAt), humanReply[0]?.classification ?? undefined),
    stamp("Meeting", earliest(meetings, (m) => m.createdAt)),
    stamp("Proposal", earliest(proposals, (p) => p.createdAt)),
    stamp("Won", lead?.pipelineStage === "Won" ? (acceptedProposal?.acceptedAt ?? lead?.updatedAt ?? null) : null),
  ];

  const transitions = candidates.filter((t): t is ConversationTransition => t !== null).sort((a, b) => (ORDER.get(a.stage)! - ORDER.get(b.stage)!) || a.at.localeCompare(b.at));

  // Current stage = furthest-along stage reached.
  let currentStage: ConversationStage | null = null;
  for (const t of transitions) if (currentStage === null || ORDER.get(t.stage)! >= ORDER.get(currentStage)!) currentStage = t.stage;

  // Negative signals (do not advance the lifecycle).
  const flags: string[] = [];
  if (sends.some((s) => s.status === "bounced")) flags.push("bounced");
  if (sends.some((s) => s.status === "complained")) flags.push("complained");
  if (sends.some((s) => s.status === "unsubscribed") || lead?.acquisitionStrategy === "Do Not Contact") flags.push("unsubscribed");
  if (sends.some((s) => s.status === "failed")) flags.push("failed");
  if (plans.some((p) => p.status === "stopped")) flags.push("stopped");

  const allStamps = [
    ...sends.flatMap((s) => [s.updatedAt, s.sentAt, s.deliveredAt, s.openedAt, s.clickedAt]),
    ...inbound.map((m) => m.receivedAt),
    ...meetings.map((m) => m.updatedAt),
    ...proposals.map((p) => p.updatedAt),
  ].filter(Boolean) as string[];
  const lastActivityAt = allStamps.length ? allStamps.reduce((a, b) => (a > b ? a : b)) : null;

  return { leadId, currentStage, transitions, flags, lastActivityAt };
}
