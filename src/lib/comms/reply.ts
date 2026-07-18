// ─────────────────────────────────────────────────────────────────────────────
// Reply processing. Classifies an inbound reply into a fixed set of intents and
// records it — WITHOUT ever overwriting the original message. The raw body is
// stored verbatim (inbound_messages.bodyRef); the classification + confidence live
// in separate columns. A genuine human reply stops the outbound sequence so we
// never email someone mid-conversation (auto-replies / bounces do not).
//
// The classifier is deterministic (rules-based) — no external calls, fully
// testable, and consistent with the app's deterministic-scoring ethos. It can be
// swapped for an AI classifier behind this same function later.
// ─────────────────────────────────────────────────────────────────────────────
import { getEmailSendByProviderMessageId, findLeadByEmail, insertInbound, getInboundByProviderId } from "../repo";
import { nowIso } from "../store";
import { stopPlansForLead } from "../acquisition/stop";
import { ensureLeadSuppressed } from "./suppression-sync";
import { verifySvixSignature, type SvixHeaders } from "./webhook";

export const REPLY_CLASSES = [
  "Interested", "Meeting Requested", "Question", "Not Now", "Already Working With Someone",
  "Wrong Contact", "Unsubscribe", "Out Of Office", "Bounce", "Unknown",
] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

interface Rule { cls: ReplyClass; confidence: number; re: RegExp }

// Order matters — the first match wins. Compliance/auto-reply signals are checked
// before intent signals so an out-of-office never reads as "Interested".
const RULES: Rule[] = [
  { cls: "Unsubscribe", confidence: 0.97, re: /\bunsubscribe\b|\bopt[\s-]?out\b|\bremove me\b|\btake me off\b|stop (emailing|contacting)|do not (contact|email)|^\s*stop\s*$/i },
  { cls: "Bounce", confidence: 0.95, re: /mailer-daemon|delivery (has )?failed|undeliverable|address not found|user unknown|mailbox (is )?full|does not exist|returned to sender|550 5\.|recipient.*rejected/i },
  { cls: "Out Of Office", confidence: 0.9, re: /out of (the )?office|\booo\b|on (vacation|holiday|leave|pto)|away from (my )?(desk|email|office)|auto(matic)?[\s-]?reply|will be back|currently (out|unavailable)|annual leave|parental leave|maternity leave|return(ing)? on/i },
  { cls: "Wrong Contact", confidence: 0.85, re: /wrong (person|contact|number|email|department)|not the right (person|contact)|no longer (with|at|here|employed)|i'?m not the|you'?(ll| will) want to (reach|contact|talk)|forward(ed|ing)? (this|you) to|reached the wrong/i },
  { cls: "Already Working With Someone", confidence: 0.85, re: /already (have|working|use|got|partnered|committed)|we have (a|an|our own) (guy|vendor|agency|developer|team|provider|partner)|we'?re all set|have someone (who|that)|under contract|happy with (our|my) (current|existing)/i },
  { cls: "Meeting Requested", confidence: 0.88, re: /\b(book|schedule|set ?up|calendar|zoom|google meet)\b|what (times?|days?) (work|are you)|when (are|can) you (free|available)|let'?s (talk|chat|meet|hop on|connect)|available (this|next|on|at)|send (me )?(a|the) (invite|link|time)/i },
  { cls: "Interested", confidence: 0.8, re: /\binterested\b|sounds (good|great|interesting)|tell me more|learn more|i'?d love|we'?d love|keen to|yes,? (please|i'?d|we)|let'?s do (it|this)|this looks (great|good|interesting)|(would|i'?m) keen|worth a (chat|conversation)/i },
  { cls: "Not Now", confidence: 0.78, re: /not (right )?now|maybe later|down the (road|line)|next (quarter|year|month|week)|circle back|reach (out|back) (again )?in|not at this time|revisit (this )?(later|in)|busy (right now|at the moment)|bad timing/i },
  { cls: "Question", confidence: 0.7, re: /how much|what (is|does|are|would) (the|your|it)|pricing|what'?s the cost|do you (also|guys)?|can you (also|explain|tell)|could you (clarify|explain)|\?\s*$/i },
];

export function classifyReply(input: { subject: string; body: string }): { classification: ReplyClass; confidence: number } {
  const text = `${input.subject}\n${input.body}`;
  for (const r of RULES) if (r.re.test(text)) return { classification: r.cls, confidence: r.confidence };
  return { classification: "Unknown", confidence: 0.3 };
}

// Human intents that should halt the outbound sequence. Auto-replies (OOO) and
// bounces do NOT stop it; unsubscribe/bounce suppression is added in Phase 6.
const STOPS_SEQUENCE = new Set<ReplyClass>(["Interested", "Meeting Requested", "Question", "Not Now", "Already Working With Someone", "Wrong Contact", "Unsubscribe", "Unknown"]);

export interface InboundReply {
  from: string;
  subject: string;
  body: string;
  providerMessageId?: string | null; // id of THIS inbound message (for dedup)
  inReplyTo?: string | null; // provider id of OUR original send (for association)
  at?: string;
}

export interface IngestResult {
  inboundId: string | null;
  leadId: string | null;
  classification: ReplyClass;
  confidence: number;
  duplicate: boolean;
  stoppedSequence: boolean;
}

export async function ingestInboundReply(input: InboundReply): Promise<IngestResult> {
  const { classification, confidence } = classifyReply(input);

  // Idempotency: a duplicate inbound webhook (same provider id) is a no-op.
  if (input.providerMessageId) {
    const existing = await getInboundByProviderId(input.providerMessageId);
    if (existing) {
      return { inboundId: existing.id, leadId: existing.leadId || null, classification: (existing.classification as ReplyClass) ?? classification, confidence: existing.confidence ?? confidence, duplicate: true, stoppedSequence: false };
    }
  }

  // Associate: prefer the In-Reply-To → our send → lead/plan; else sender email.
  let leadId: string | null = null;
  let planId: string | null = null;
  if (input.inReplyTo) {
    const send = await getEmailSendByProviderMessageId(input.inReplyTo);
    if (send) { leadId = send.leadId; planId = send.planId; }
  }
  if (!leadId) {
    const lead = await findLeadByEmail(input.from);
    if (lead) leadId = lead.id;
  }

  const inbound = await insertInbound({
    leadId: leadId ?? "", acquisitionPlanId: planId, provider: "resend", providerMessageId: input.providerMessageId ?? null,
    fromAddr: input.from, subject: input.subject, bodyRef: input.body, receivedAt: input.at ?? nowIso(),
    classification, confidence, reviewedAt: null,
  });

  let stoppedSequence = false;
  if (leadId && classification === "Unsubscribe") {
    // Opt-out reply → suppress future contact (Phase 6) + stop the sequence.
    await ensureLeadSuppressed(leadId, "Unsubscribe reply (auto-suppress)");
    stoppedSequence = true;
  } else if (leadId && STOPS_SEQUENCE.has(classification)) {
    const stopped = await stopPlansForLead(leadId, `Reply received: ${classification}`);
    stoppedSequence = stopped > 0;
  }

  return { inboundId: inbound.id, leadId, classification, confidence, duplicate: false, stoppedSequence };
}

// ── Inbound webhook pipeline (verify → normalize → ingest) ────────────────────
interface ResendInboundPayload {
  type?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    from?: string | { address?: string; email?: string };
    subject?: string;
    text?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
    in_reply_to?: string;
  };
  from?: string;
  subject?: string;
  text?: string;
}

type InboundHeaders = Record<string, string> | Array<{ name: string; value: string }> | undefined;
function headerValue(headers: InboundHeaders, name: string): string | null {
  if (!headers) return null;
  const lname = name.toLowerCase();
  if (Array.isArray(headers)) return headers.find((h) => h.name.toLowerCase() === lname)?.value ?? null;
  const found = Object.entries(headers).find(([k]) => k.toLowerCase() === lname);
  return found ? found[1] : null;
}

function fromAddress(v: unknown): string {
  if (typeof v === "string") {
    const m = v.match(/<([^>]+)>/);
    return (m ? m[1] : v).trim();
  }
  if (v && typeof v === "object") {
    const o = v as { address?: string; email?: string };
    return (o.address ?? o.email ?? "").trim();
  }
  return "";
}

export function normalizeInbound(payload: ResendInboundPayload): InboundReply | null {
  const d = payload.data ?? {};
  const from = fromAddress(d.from ?? payload.from);
  if (!from) return null;
  const subject = d.subject ?? payload.subject ?? "";
  const body = d.text ?? payload.text ?? "";
  const inReplyTo = d.in_reply_to ?? headerValue(d.headers, "in-reply-to");
  return { from, subject, body, providerMessageId: d.message_id ?? d.email_id ?? null, inReplyTo: inReplyTo ?? null };
}

export async function handleInboundWebhook(input: {
  rawBody: string;
  headers: SvixHeaders;
  secret?: string | null;
  isProduction?: boolean;
  now?: Date;
}): Promise<{ ok: boolean; status: number; kind: string; classification?: ReplyClass; result?: string }> {
  const secret = input.secret ?? null;
  if (secret) {
    if (!verifySvixSignature(secret, input.headers, input.rawBody, { now: input.now })) return { ok: false, status: 401, kind: "invalid_signature" };
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  let payload: ResendInboundPayload;
  try { payload = JSON.parse(input.rawBody); } catch { return { ok: false, status: 400, kind: "bad_json" }; }

  const reply = normalizeInbound(payload);
  if (!reply) return { ok: true, status: 200, kind: "ignored", result: "no_sender" };

  const r = await ingestInboundReply(reply);
  return { ok: true, status: 200, kind: "inbound", classification: r.classification, result: r.duplicate ? "duplicate" : "ingested" };
}
