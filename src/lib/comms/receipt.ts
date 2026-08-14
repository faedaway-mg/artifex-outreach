// ─────────────────────────────────────────────────────────────────────────────
// Send receipt — the immutable record of what ACTUALLY left Artifex.
//
// The email_sends ledger records delivery state (status, providerMessageId, timestamps)
// but not the exact body or which Review was attached. A human-approved outbound email
// needs a receipt: what preview == what approved == what dispatched. We write that as an
// APPEND-ONLY audit event at the moment of a successful send, capturing the exact final
// payload (subject, body text + hash, attachment filename + content hash, recipient,
// provider id, business binding). Append-only + hashed = evidence that cannot silently
// drift when a draft is later regenerated. Reuses the existing audit log — no migration.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

/** The audit action that carries a send receipt. */
export const SEND_RECEIPT_ACTION = "email.sent";

export interface SendReceiptMeta {
  /** Business binding — the ONE business this send belongs to. */
  leadId: string;
  businessName: string;
  toAddr: string;
  fromAddr: string;
  replyTo: string;
  /** Exact subject dispatched (after operator edits + Re: threading). */
  subject: string;
  /** Exact body text dispatched (after operator edits), and its hash. */
  bodyText: string;
  bodySha256: string;
  /** The Business Technology Review attached, by filename + content hash (null if none). */
  attachmentFilename: string | null;
  attachmentSha256: string | null;
  providerMessageId: string | null;
  sentAt: string;
  stepId: string;
  planId: string;
  isFollowUp: boolean;
  /** The email_sends ledger row this receipt corresponds to. */
  sendId: string;
}

/** SHA-256 hex of a string or buffer — the immutable fingerprint of body/attachment bytes. */
export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface SendReceipt extends SendReceiptMeta {
  /** Audit row id. */
  id: string;
  /** When the receipt was recorded (ISO). */
  at: string;
}

interface AuditRowLite { id: string; action: string; targetId: string | null; createdAt: string; meta: unknown }

/** Reconstruct receipts from audit rows (newest first). Pure. */
export function receiptsFromAudit(audit: AuditRowLite[]): SendReceipt[] {
  return audit
    .filter((a) => a.action === SEND_RECEIPT_ACTION && a.meta && typeof a.meta === "object")
    .map((a) => ({ id: a.id, at: a.createdAt, ...(a.meta as SendReceiptMeta) }))
    .sort((x, y) => +new Date(y.at) - +new Date(x.at));
}

/** Receipts for a single business. */
export function receiptsForLead(audit: AuditRowLite[], leadId: string): SendReceipt[] {
  return receiptsFromAudit(audit).filter((r) => r.leadId === leadId);
}
