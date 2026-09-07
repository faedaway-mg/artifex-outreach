// ─────────────────────────────────────────────────────────────────────────────
// LEAD TARGETING DISPOSITION (mandate 29 cleanup). Canonical, append-only, idempotent dispositions that are
// NOT customer-facing rejections and NEVER create suppression/unsubscribe events:
//   • DO_NOT_PREPARE — unsuitable for the CURRENT website-review Outreach Review workflow (e.g. no functioning
//     website). The business is preserved for a possible future campaign; not "permanently undesirable".
//   • INTERNAL_TEST — synthetic/internal-test record; permanently excluded from production targeting + counts.
// Terminal customer rejection (e.g. corporate franchise) uses the existing exactly-once rejectLead — NOT this.
// Bound to a batchHash so retries are idempotent and the audit trail is append-only.
// ─────────────────────────────────────────────────────────────────────────────
import { appendAudit, listAudit } from "../repo";

export const DISPOSITION_ACTION = "lead.disposition";
export type LeadDispositionType = "DO_NOT_PREPARE" | "INTERNAL_TEST";

export interface DispositionResult { applied: boolean; idempotent: boolean; disposition: LeadDispositionType; leadId: string }

/** Apply a disposition idempotently (per lead + batchHash). Append-only; no suppression. */
export async function applyLeadDisposition(input: { leadId: string; disposition: LeadDispositionType; reason: string; batchHash: string; actor: string }): Promise<DispositionResult> {
  const audit = await listAudit(50000);
  const already = audit.some((a) => a.action === DISPOSITION_ACTION && a.targetId === input.leadId && (a.meta as any)?.batchHash === input.batchHash);
  if (already) return { applied: false, idempotent: true, disposition: input.disposition, leadId: input.leadId };
  await appendAudit({
    action: DISPOSITION_ACTION, actor: input.actor, targetType: "lead", targetId: input.leadId,
    meta: { disposition: input.disposition, reason: input.reason, batchHash: input.batchHash, suppression: false } as unknown as Record<string, unknown>,
    ip: null,
  });
  return { applied: true, idempotent: false, disposition: input.disposition, leadId: input.leadId };
}

/** The latest disposition for a lead (null when none). */
export async function latestDisposition(leadId: string): Promise<{ disposition: LeadDispositionType; reason: string; at: string } | null> {
  const audit = await listAudit(50000);
  const evts = audit.filter((a) => a.action === DISPOSITION_ACTION && a.targetId === leadId).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const e = evts[0];
  return e ? { disposition: (e.meta as any).disposition, reason: (e.meta as any).reason, at: e.createdAt ?? "" } : null;
}

/** Read all disposition events once → a leadId→disposition map (for batch exclusion checks). */
export async function dispositionMap(): Promise<Record<string, LeadDispositionType>> {
  const audit = await listAudit(50000);
  const out: Record<string, { d: LeadDispositionType; at: string }> = {};
  for (const a of audit) {
    if (a.action !== DISPOSITION_ACTION || !a.targetId) continue;
    const at = a.createdAt ?? "";
    if (!out[a.targetId] || at.localeCompare(out[a.targetId].at) > 0) out[a.targetId] = { d: (a.meta as any).disposition, at };
  }
  const flat: Record<string, LeadDispositionType> = {};
  for (const [k, v] of Object.entries(out)) flat[k] = v.d;
  return flat;
}

export const isInternalTest = (m: Record<string, LeadDispositionType>, leadId: string) => m[leadId] === "INTERNAL_TEST";
export const isDoNotPrepare = (m: Record<string, LeadDispositionType>, leadId: string) => m[leadId] === "DO_NOT_PREPARE";
