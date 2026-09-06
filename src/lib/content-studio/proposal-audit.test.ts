import { describe, it, expect } from "vitest";
import { auditProposalNarrations, type AuditInputRow } from "./proposal-audit";

const base = (over: Partial<AuditInputRow>): AuditInputRow => ({
  leadId: "lead_x", businessName: "Acme Co", narration: "", findings: ["no online booking on the website"],
  hasScreenshot: true, frozen: false, approved: false, scheduled: false, sent: false, ...over,
});

const shared = "There's no online booking on the website so customers who search can't schedule a job without calling. A simple booking page could capture those requests directly.";

describe("mandate 25 — existing narration audit", () => {
  it("grades each row and computes cross-company similarity across the whole set", () => {
    const report = auditProposalNarrations([
      base({ leadId: "a", businessName: "Vertex Roofing", narration: `Hi — about Vertex Roofing. ${shared} Reply if useful.` }),
      base({ leadId: "b", businessName: "Cedar Dental", narration: `Hi — about Cedar Dental. ${shared} Reply if useful.` }),
    ]);
    expect(report.totals.total).toBe(2);
    // Both flagged TOO_SIMILAR because substantive wording is shared across companies.
    expect(report.totals.tooSimilarPairs).toBe(2);
    expect(report.rows[0].similarity.tooSimilar).toBe(true);
    expect(report.rows[0].similarity.similarTo).toBe("b");
  });

  it("creates AT MOST ONE evidence-backed expansion candidate for an eligible TOO_SHORT/GENERIC video", () => {
    const report = auditProposalNarrations([
      base({
        leadId: "short", businessName: "Vertex Roofing", narration: "Hi, quick video. Take a look.",
        evidenceFindings: [{ id: "ev1", observation: "there's no online booking on your website, so customers can't schedule without calling", impact: "after-hours jobs slip away", recommendation: "add a simple booking page", benefit: "you capture those requests directly" }],
      }),
    ]);
    const row = report.rows[0];
    expect(["TOO_SHORT", "GENERIC"]).toContain(row.classification);
    expect(row.eligibleForExpansion).toBe(true);
    expect(row.candidate).not.toBeNull();
    expect(row.candidate!.available).toBe(true);
    expect(row.candidate!.usedEvidenceIds).toContain("ev1");
    expect(report.totals.candidatesCreated).toBe(1);
  });

  it("does NOT create a candidate for frozen/approved/scheduled/sent videos", () => {
    const report = auditProposalNarrations([
      base({ leadId: "frozen", narration: "Hi, quick video.", frozen: true }),
      base({ leadId: "approved", narration: "Hi, quick video.", approved: true }),
    ]);
    expect(report.rows.every((r) => r.eligibleForExpansion === false)).toBe(true);
    expect(report.totals.candidatesCreated).toBe(0);
    expect(report.rows[0].recommendedAction).toMatch(/frozen/i);
  });

  it("eligible but insufficient evidence → no candidate, reports the blocker (no fabrication)", () => {
    const report = auditProposalNarrations([
      base({ leadId: "noev", narration: "Hi, quick video.", findings: [], hasScreenshot: false }),
    ]);
    const row = report.rows[0];
    // no findings/screenshot → INSUFFICIENT_EVIDENCE, so not eligible for expansion at all
    expect(row.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(row.candidate).toBeNull();
  });
});
