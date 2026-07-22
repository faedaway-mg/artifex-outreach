import { describe, it, expect } from "vitest";
import type { OutcomeReviewItem, OutcomeStatus, RoadmapProgressItem, RoadmapStatus } from "../types";
import { beforeAfter, hasObservation } from "./before-after";
import { recommendationEffectiveness } from "./effectiveness";
import { buildKnowledgeGraph, MIN_SUPPORTING_ENGAGEMENTS } from "./knowledge-graph";
import { proposalEvidenceLines } from "./proposal-improvement";
import { buildEvolution } from "./evolution";
import { buildHealthNarrative } from "./health-narrative";
import { buildOutcomesDashboard } from "./index";
import { voiceViolations } from "../outreach/voice-engine";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
function review(p: Partial<OutcomeReviewItem> & { leadId: string; recommendationId: string }): OutcomeReviewItem {
  seq += 1;
  return {
    id: p.id ?? `oc${seq}`, leadId: p.leadId, recommendationId: p.recommendationId,
    title: p.title ?? "Take the pressure off the front desk's booking flow",
    status: (p.status as OutcomeStatus) ?? "Awaiting Review",
    expectedOutcome: p.expectedOutcome ?? "Fewer scheduling interruptions.",
    beforeState: p.beforeState ?? "Scheduling handled manually by the front desk.",
    observedOutcome: p.observedOutcome ?? "",
    evidence: p.evidence ?? "",
    unexpectedConsequences: p.unexpectedConsequences ?? "",
    lessonsLearned: p.lessonsLearned ?? "",
    confidence: p.confidence ?? "Medium",
    reviewedAt: p.reviewedAt ?? null,
    operatorNotes: null,
    createdAt: p.createdAt ?? "2026-05-01T00:00:00Z",
    updatedAt: p.updatedAt ?? "2026-07-10T00:00:00Z",
  };
}
function progress(leadId: string, recommendationId: string, status: RoadmapStatus): RoadmapProgressItem {
  seq += 1;
  return { id: `p${seq}`, leadId, recommendationId, title: "Take the pressure off the front desk's booking flow", status, operatorNotes: null, createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-20T00:00:00Z" };
}

const SUPPORTED = (leadId: string, recommendationId = "rec_manual-scheduling") =>
  review({ leadId, recommendationId, status: "Supported", observedOutcome: "Front desk reports fewer scheduling interruptions.", evidence: "Operator note; client conversation.", reviewedAt: "2026-07-10T00:00:00Z" });

describe("outcome discipline — nothing succeeds on its own", () => {
  it("a fresh review is Awaiting Review with no observation", () => {
    const r = review({ leadId: "L1", recommendationId: "rec_manual-scheduling" });
    expect(r.status).toBe("Awaiting Review");
    expect(hasObservation(r)).toBe(false);
  });

  it("an observation only counts with an evidence source", () => {
    expect(hasObservation(review({ leadId: "L1", recommendationId: "r", observedOutcome: "Better now." }))).toBe(false);
    expect(hasObservation(review({ leadId: "L1", recommendationId: "r", observedOutcome: "Better now.", evidence: "Operator note." }))).toBe(true);
  });

  it("before/after reads straight from the record", () => {
    const ba = beforeAfter(SUPPORTED("L1"));
    expect(ba.before).toMatch(/manually/);
    expect(ba.observed).toMatch(/fewer scheduling/i);
    expect(ba.evidenceSources.length).toBeGreaterThanOrEqual(2);
  });
});

describe("effectiveness — counts, not grades", () => {
  it("rolls up recommended / implemented / reviewed / verdicts", () => {
    const reviews = [SUPPORTED("L1"), review({ leadId: "L2", recommendationId: "rec_manual-scheduling", status: "Mixed", observedOutcome: "Some relief, some new confusion.", evidence: "Review." })];
    const prog = [progress("L1", "rec_manual-scheduling", "Completed"), progress("L2", "rec_manual-scheduling", "Completed"), progress("L3", "rec_manual-scheduling", "Recommended")];
    const rows = recommendationEffectiveness(reviews, prog);
    const row = rows.find((r) => r.recommendationId === "rec_manual-scheduling")!;
    expect(row.recommended).toBe(3);
    expect(row.implemented).toBe(2);
    expect(row.supported).toBe(1);
    expect(row.mixed).toBe(1);
  });
});

describe("knowledge graph — never from one engagement", () => {
  it("records a pattern only after ≥2 distinct supporting businesses", () => {
    expect(buildKnowledgeGraph([SUPPORTED("L1")])).toHaveLength(0); // one engagement → nothing
    const g = buildKnowledgeGraph([SUPPORTED("L1"), SUPPORTED("L2")]);
    expect(g).toHaveLength(1);
    expect(g[0].supportingLeadIds.sort()).toEqual(["L1", "L2"]);
    expect(g[0].supportedCount).toBe(MIN_SUPPORTING_ENGAGEMENTS);
  });

  it("two supports from the SAME business are still one engagement", () => {
    expect(buildKnowledgeGraph([SUPPORTED("L1"), SUPPORTED("L1")])).toHaveLength(0);
  });

  it("cites the businesses that support it", () => {
    const g = buildKnowledgeGraph([SUPPORTED("L1"), SUPPORTED("L2"), SUPPORTED("L3")]);
    expect(g[0].supportingLeadIds).toHaveLength(3);
    expect(g[0].summary).toMatch(/3 businesses/);
  });
});

describe("adaptive proposal improvement — only when supported, always cited", () => {
  it("produces an evidence-backed line citing the engagement count", () => {
    const g = buildKnowledgeGraph([SUPPORTED("L1"), SUPPORTED("L2")]);
    const lines = proposalEvidenceLines(g);
    expect(lines).toHaveLength(1);
    expect(lines[0].engagements).toBe(2);
    expect(lines[0].line).toMatch(/2 similar businesses/i);
  });

  it("says nothing without a pattern", () => {
    expect(proposalEvidenceLines(buildKnowledgeGraph([SUPPORTED("L1")]))).toHaveLength(0);
  });
});

describe("evolution timeline — real recorded change only", () => {
  it("includes implemented (journal) and observed (review) events, newest first", () => {
    const events = buildEvolution([SUPPORTED("L1")], [progress("L1", "rec_manual-scheduling", "Completed")]);
    expect(events.some((e) => e.kind === "implemented")).toBe(true);
    expect(events.some((e) => e.kind === "observed")).toBe(true);
    for (const e of events) expect(e.evidence.length).toBeGreaterThan(0);
  });

  it("ignores reviews with no evidence-backed observation", () => {
    const events = buildEvolution([review({ leadId: "L1", recommendationId: "r", observedOutcome: "vibes" })], []);
    expect(events).toHaveLength(0);
  });
});

describe("health narrative — traces to outcomes, hides nothing", () => {
  it("summarises supported change and never buries a failure", () => {
    const n = buildHealthNarrative([
      SUPPORTED("L1"),
      review({ leadId: "L1", recommendationId: "rec_x", status: "Not Supported", observedOutcome: "The team went back to the old way", evidence: "Operator note." }),
    ], NOW);
    expect(n.opening).toMatch(/over the past/i);
    expect(n.points.some((p) => /didn't hold/i.test(p))).toBe(true); // failure surfaced
    expect(n.fromReviewIds.length).toBeGreaterThan(0);
  });

  it("is honest when nothing is reviewed", () => {
    const n = buildHealthNarrative([], NOW);
    expect(n.points).toHaveLength(0);
    expect(n.opening).toMatch(/no outcomes/i);
  });

  it("reads clean in the founder voice", () => {
    const n = buildHealthNarrative([SUPPORTED("L1")], NOW);
    expect(voiceViolations(n.opening)).toHaveLength(0);
    for (const p of n.points) expect(voiceViolations(p)).toHaveLength(0);
  });
});

describe("dashboard — completed work never skips measurement", () => {
  it("surfaces completed-but-unreviewed work as awaiting review", () => {
    const d = buildOutcomesDashboard([], [progress("L1", "rec_manual-scheduling", "Completed")]);
    expect(d.awaitingReview.length).toBe(1);
    expect(d.validated).toHaveLength(0);
  });

  it("groups verdicts into the right lanes", () => {
    const d = buildOutcomesDashboard([
      SUPPORTED("L1"),
      review({ leadId: "L1", recommendationId: "rec_y", status: "Mixed", observedOutcome: "partial", evidence: "note" }),
      review({ leadId: "L1", recommendationId: "rec_z", status: "Not Supported", observedOutcome: "reverted", evidence: "note" }),
    ], []);
    expect(d.validated).toHaveLength(1);
    expect(d.mixed).toHaveLength(1);
    expect(d.needingFollowUp.length).toBeGreaterThanOrEqual(1);
  });
});
