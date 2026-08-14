// ─────────────────────────────────────────────────────────────────────────────
// Historical send consistency audit — READ-ONLY cross-business contamination check.
//
// Given the immutable send receipts (from the audit log) + the leads, flag any send whose
// parts do not all belong to the same business. The strongest single signal is the ATTACHMENT:
// the Review filename is derived from the business name, so if a send's attachment filename does
// not match its own business, the wrong Review was attached — a confirmed cross-business defect.
// Recipient-domain mismatches are only SUSPICIOUS (businesses legitimately use third-party
// inboxes). Never mutates anything.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { SendReceipt } from "./receipt";
import { quickReviewFilename } from "../outreach/quick-review";

export type AnomalyClass = "confirmed-mismatch" | "suspicious" | "explainable" | "insufficient-evidence";

export interface SendAnomaly {
  sendId: string;
  leadId: string;
  businessName: string;
  kind: string;
  classification: AnomalyClass;
  detail: string;
}

export interface SendAuditResult {
  examined: number;
  anomalies: SendAnomaly[];
  byClass: Record<AnomalyClass, number>;
  /** True if ANY confirmed cross-business send was found — sending should be paused for review. */
  confirmedCrossBusiness: boolean;
}

// Consumer/provider inboxes a business legitimately uses that won't match its own domain.
const COMMON_PROVIDERS = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|aol|proton(mail)?|me|msn)\./i;
const domainOf = (email: string) => (email.split("@")[1] ?? "").toLowerCase().replace(/^www\./, "");
const registrable = (host: string) => host.split(".").filter(Boolean).slice(-2).join(".");

/** Audit every receipt for cross-business contamination. Pure. */
export function auditSendConsistency(receipts: SendReceipt[], leads: Lead[] | Map<string, Lead>): SendAuditResult {
  const leadById = Array.isArray(leads) ? new Map(leads.map((l) => [l.id, l])) : leads;
  const anomalies: SendAnomaly[] = [];
  const seenMsgIds = new Map<string, string>(); // providerMessageId → sendId (dup detection)

  for (const r of receipts) {
    const push = (kind: string, classification: AnomalyClass, detail: string) =>
      anomalies.push({ sendId: r.sendId, leadId: r.leadId, businessName: r.businessName, kind, classification, detail });

    // 1) ATTACHMENT belongs to another business → confirmed cross-business (the wrong Review shipped).
    if (r.attachmentFilename) {
      const expected = quickReviewFilename(r.businessName);
      if (r.attachmentFilename !== expected) {
        push("attachment-business-mismatch", "confirmed-mismatch", `attachment "${r.attachmentFilename}" does not match business "${r.businessName}" (expected "${expected}")`);
      }
    }

    // 2) RECIPIENT domain vs the lead's own domain — suspicious only (third-party inboxes are legit).
    const lead = leadById.get(r.leadId);
    if (!lead) {
      push("orphan-send", "insufficient-evidence", "receipt references a lead not present in the audited set");
    } else if (lead.websiteDomain && !COMMON_PROVIDERS.test(r.toAddr)) {
      const rd = registrable(domainOf(r.toAddr));
      const ld = registrable(lead.websiteDomain.toLowerCase().replace(/^www\./, ""));
      if (rd && ld && rd !== ld) {
        push("recipient-domain-mismatch", "suspicious", `recipient ${r.toAddr} is off the business domain ${lead.websiteDomain}`);
      }
    }

    // 3) DUPLICATE provider message id across two different sends → one message billed to two sends.
    if (r.providerMessageId) {
      const prior = seenMsgIds.get(r.providerMessageId);
      if (prior && prior !== r.sendId) push("duplicate-provider-message-id", "confirmed-mismatch", `providerMessageId shared with send ${prior}`);
      else seenMsgIds.set(r.providerMessageId, r.sendId);
    }
  }

  const byClass: Record<AnomalyClass, number> = { "confirmed-mismatch": 0, suspicious: 0, explainable: 0, "insufficient-evidence": 0 };
  for (const a of anomalies) byClass[a.classification] += 1;
  return { examined: receipts.length, anomalies, byClass, confirmedCrossBusiness: byClass["confirmed-mismatch"] > 0 };
}
