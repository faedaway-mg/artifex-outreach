// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT REPLY ROUTING — where a reply to a cold prospect email must land, and how
// an inbound reply maps back to its lead / send / sending lane / thread.
//
// DEFAULT: replies return to the ACTUAL sending lane's Google Workspace mailbox (the
// From address that sent the message), so the person who replies reaches the mailbox
// that contacted them. This preserves per-lane ownership and keeps hello@artifexlabs.tech
// (Microsoft 365) as the untouched Artifex business mailbox — a prospect reply is NEVER
// silently routed into it, and NEVER pointed at Resend.
//
// OVERRIDE: an operator may set COMMS_CANONICAL_REPLY_TO to a single canonical reply
// address (e.g. a shared Workspace inbox). When set + valid, every prospect Reply-To uses
// it instead of the per-lane mailbox. It must be an explicit, configured value — there is
// no invented default.
//
// This module holds NO secrets and performs no I/O.
// ─────────────────────────────────────────────────────────────────────────────
import { validEmail } from "../acquisition/compliance";

/** The bare email out of a From/Reply-To header, e.g. `Name <a@b.com>` → `a@b.com`. */
function bareAddress(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim();
}

/**
 * The explicitly-configured canonical Reply-To override, or null when unset/invalid.
 * When null, callers mirror the sending lane's mailbox (the default). Never invents a value.
 */
export function canonicalReplyToOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.COMMS_CANONICAL_REPLY_TO ?? "").trim();
  if (!raw) return null;
  const addr = bareAddress(raw);
  return validEmail(addr) ? addr : null;
}

/**
 * Resolve the Reply-To for a prospect send given the actual sending mailbox. Returns the
 * canonical override when configured, else the sending lane's own mailbox. Pure + deterministic.
 */
export function resolveProspectReplyTo(sendingFrom: string, env: NodeJS.ProcessEnv = process.env): string {
  return canonicalReplyToOverride(env) ?? bareAddress(sendingFrom);
}

/** A non-secret record binding an inbound reply back to its originating send + lane + thread. */
export interface ReplyLineage {
  leadId: string | null;
  sendId: string | null;
  /** The lane/sender id that sent the original message (e.g. "sender-1"). */
  senderId: string | null;
  /** The lane mailbox that sent (non-secret address). */
  senderAddress: string | null;
  /** MIME thread anchor (Message-ID / In-Reply-To). */
  threadId: string | null;
  /** The plan/journey the original send belonged to. */
  planId: string | null;
}

/**
 * Map an inbound reply to its lineage using the ORIGINAL send record it threads to. This changes
 * no mailbox ownership — it is pure attribution so a reply landing in a lane mailbox (or the
 * canonical inbox) can still be reconciled to the lead, send, lane, and conversation. Returns a
 * best-effort lineage; unknown fields are null (never guessed).
 */
export function mapReplyToLineage(originalSend: {
  leadId?: string | null;
  id?: string | null;
  senderId?: string | null;
  fromAddr?: string | null;
  providerMessageId?: string | null;
  planId?: string | null;
} | null | undefined): ReplyLineage {
  const s = originalSend ?? {};
  return {
    leadId: s.leadId ?? null,
    sendId: s.id ?? null,
    senderId: s.senderId ?? null,
    senderAddress: s.fromAddr ? bareAddress(s.fromAddr) : null,
    threadId: s.providerMessageId ?? null,
    planId: s.planId ?? null,
  };
}
