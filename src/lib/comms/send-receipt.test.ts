import { describe, it, expect } from "vitest";
import { sha256, receiptsFromAudit, receiptsForLead, SEND_RECEIPT_ACTION, type SendReceiptMeta } from "./receipt";
import { auditSendConsistency } from "./send-audit";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { quickReviewFilename } from "../outreach/quick-review";

const meta = (over: Partial<SendReceiptMeta> = {}): SendReceiptMeta => ({
  leadId: "beta", businessName: "Beta Law", toAddr: "info@betalaw.com", fromAddr: "hello@artifexlabs.tech",
  replyTo: "hello@artifexlabs.tech", subject: "A quick review for Beta Law", bodyText: "Hi Beta Law, …",
  bodySha256: sha256("Hi Beta Law, …"), attachmentFilename: quickReviewFilename("Beta Law"), attachmentSha256: "abc",
  providerMessageId: "msg_1", sentAt: "2026-08-13T10:00:00Z", stepId: "s1", planId: "p1", isFollowUp: false, sendId: "send1", ...over,
});
const auditRow = (id: string, m: SendReceiptMeta, createdAt: string) => ({ id, action: SEND_RECEIPT_ACTION, targetId: m.leadId, createdAt, meta: m });

describe("send receipt — immutable record of the exact payload", () => {
  it("sha256 is deterministic and content-bound", () => {
    expect(sha256("same")).toBe(sha256("same"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("receiptsFromAudit reads only send-receipt events, newest first; receiptsForLead filters by business", () => {
    const rows = [
      auditRow("r1", meta({ leadId: "alpha", businessName: "Alpha Dental", sendId: "sA" }), "2026-08-13T09:00:00Z"),
      auditRow("r2", meta({ leadId: "beta", sendId: "sB" }), "2026-08-13T10:00:00Z"),
      { id: "x", action: "lead.assigned", targetId: "beta", createdAt: "2026-08-13T11:00:00Z", meta: {} }, // ignored
    ];
    const all = receiptsFromAudit(rows);
    expect(all.map((r) => r.sendId)).toEqual(["sB", "sA"]); // newest first
    expect(receiptsForLead(rows, "alpha").map((r) => r.sendId)).toEqual(["sA"]);
  });
});

describe("auditSendConsistency — cross-business contamination audit (read-only)", () => {
  const beta = makeLead({ id: "beta", businessName: "Beta Law", websiteDomain: "betalaw.com", publicEmail: "info@betalaw.com" });
  const alpha = makeLead({ id: "alpha", businessName: "Alpha Dental", websiteDomain: "alphadental.com" });
  const leads: Lead[] = [beta, alpha];
  const R = (m: SendReceiptMeta, at = "2026-08-13T10:00:00Z") => ({ ...m, id: "aud", at });

  it("a clean send raises no anomaly", () => {
    const res = auditSendConsistency([R(meta())], leads);
    expect(res.confirmedCrossBusiness).toBe(false);
    expect(res.anomalies).toHaveLength(0);
  });

  it("attachment for the WRONG business is a CONFIRMED cross-business mismatch", () => {
    const bad = R(meta({ attachmentFilename: quickReviewFilename("Alpha Dental") })); // Beta send, Alpha's Review
    const res = auditSendConsistency([bad], leads);
    expect(res.confirmedCrossBusiness).toBe(true);
    expect(res.anomalies[0].kind).toBe("attachment-business-mismatch");
  });

  it("recipient off the business domain is SUSPICIOUS (not confirmed) — third-party inboxes are legit", () => {
    const res = auditSendConsistency([R(meta({ toAddr: "someone@randomhost.com" }))], leads);
    expect(res.byClass.suspicious).toBe(1);
    expect(res.confirmedCrossBusiness).toBe(false);
  });

  it("a common provider inbox (gmail) on a business is NOT flagged", () => {
    const res = auditSendConsistency([R(meta({ toAddr: "betalawoffice@gmail.com" }))], leads);
    expect(res.anomalies).toHaveLength(0);
  });

  it("a provider message id shared across two sends is a confirmed anomaly", () => {
    const res = auditSendConsistency([R(meta({ sendId: "s1", providerMessageId: "dup" })), R(meta({ sendId: "s2", providerMessageId: "dup" }))], leads);
    expect(res.confirmedCrossBusiness).toBe(true);
    expect(res.anomalies.some((a) => a.kind === "duplicate-provider-message-id")).toBe(true);
  });
});
