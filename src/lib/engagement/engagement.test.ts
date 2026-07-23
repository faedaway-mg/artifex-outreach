import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, MemoryCategory, MemoryStatus, RoadmapProgressItem, RoadmapStatus, OutcomeReviewItem, Lead, Meeting } from "../types";
import { assembleEngagementContext, buildCommandCenter, pendingWork, engagementTimeline, buildPortfolioRow, composeSnapshot, parseSnapshot } from "./index";
import type { EngagementContext } from "./types";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
const mem = (category: MemoryCategory, value: string, status: MemoryStatus = "Verified"): RelationshipMemoryItem => {
  seq += 1;
  return { id: `m${seq}`, leadId: "L1", category, title: value.slice(0, 20), value, status, confidence: "High", source: "Discovery Meeting", supportingContext: null, operatorNotes: null, createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z" };
};
const lead = (): Lead => ({ id: "L1", businessName: "Bright Smiles Dental" } as unknown as Lead);
const meeting = (at: string): Meeting => ({ id: "mt1", leadId: "L1", contactId: null, scheduledAt: at, meetingUrl: null, discoveryQuestions: [], likelyObjections: [], notes: "Great chat", nextStep: "Send recap", outcome: "held" as Meeting["outcome"], createdAt: at, updatedAt: at });
const prog = (recommendationId: string, status: RoadmapStatus): RoadmapProgressItem => { seq += 1; return { id: `p${seq}`, leadId: "L1", recommendationId, title: "Take the pressure off the front desk's booking flow", status, operatorNotes: null, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-20T00:00:00Z" }; };
const review = (recommendationId: string, status: OutcomeReviewItem["status"]): OutcomeReviewItem => { seq += 1; return { id: `oc${seq}`, leadId: "L1", recommendationId, title: "Booking flow", status, expectedOutcome: "Fewer interruptions", beforeState: "manual", observedOutcome: status === "Awaiting Review" ? "" : "Fewer interruptions reported", evidence: status === "Awaiting Review" ? "" : "Operator note", unexpectedConsequences: "", lessonsLearned: "", confidence: "Medium", reviewedAt: status === "Awaiting Review" ? null : "2026-07-21T00:00:00Z", operatorNotes: null, createdAt: "2026-07-20T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z" }; };

// A business with enough memory to produce recommendations.
function fullMemory(): RelationshipMemoryItem[] {
  return [
    mem("Existing Systems", "We use Square for checkout."),
    mem("Existing Systems", "We use QuickBooks for the books."),
    mem("Existing Systems", "No online booking — every appointment is by phone."),
    mem("Decision Makers", "The owner personally handles scheduling."),
    mem("Current Priorities", "The front desk is overwhelmed with phone calls."),
    mem("Business Goals", "We're trying to hire another hygienist."),
    mem("Known Constraints", "The team is completely overwhelmed already."),
  ];
}

function ctx(over: Partial<Parameters<typeof assembleEngagementContext>[0]> = {}): EngagementContext {
  return assembleEngagementContext({
    lead: lead(), memory: fullMemory(), meetings: [], proposals: [], plans: [],
    progress: [], reviews: [], outreach: [], inbound: [], snapshots: [], now: NOW, ...over,
  });
}

describe("engagement context assembly", () => {
  it("composes reasoning + plan from raw memory (no new inference)", () => {
    const c = ctx();
    expect(c.reasoning.recommendations.length).toBeGreaterThan(0);
    expect(c.plan.items.length + c.plan.completed.length).toBeGreaterThan(0);
  });
});

describe("follow-up workflow — surface pending work, cite evidence", () => {
  it("surfaces an outcome review for completed-but-unmeasured work", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "Completed")] });
    const pending = pendingWork(c);
    const item = pending.find((p) => p.kind === "outcome-review");
    expect(item).toBeTruthy();
    expect(item!.evidence.length).toBeGreaterThan(0);
    expect(item!.nextHref).toContain("/outcomes");
  });

  it("every pending item explains why, evidence, and a next step", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "Completed")] });
    for (const p of pendingWork(c)) {
      expect(p.why.length).toBeGreaterThan(0);
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.nextLabel.length).toBeGreaterThan(0);
      expect(p.nextHref).toMatch(/^\/leads\//);
    }
  });

  it("an untouched engagement with no work has nothing (or only gentle) pending", () => {
    const empty = assembleEngagementContext({ lead: lead(), memory: [], meetings: [], proposals: [], plans: [], progress: [], reviews: [], outreach: [], inbound: [], snapshots: [], now: NOW });
    expect(pendingWork(empty)).toHaveLength(0);
  });
});

describe("engagement timeline — one chronological story", () => {
  it("merges meetings, memory, roadmap, and outcomes, newest first", () => {
    const c = ctx({ meetings: [meeting("2026-07-15T00:00:00Z")], progress: [prog("rec_integration-over-replacement", "Completed")], reviews: [review("rec_integration-over-replacement", "Supported")] });
    const tl = engagementTimeline(c);
    const sources = new Set(tl.map((e) => e.source));
    expect(sources.has("meeting")).toBe(true);
    expect(sources.has("memory")).toBe(true);
    expect(sources.has("roadmap")).toBe(true);
    expect(sources.has("outcome")).toBe(true);
    for (let i = 1; i < tl.length; i++) expect(Date.parse(tl[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(tl[i].at));
  });
});

describe("command center — composes the whole engagement", () => {
  it("reports stage, health, priorities, awaiting reviews, and pending work", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "Completed")], meetings: [meeting("2026-08-01T00:00:00Z")] });
    const cc = buildCommandCenter(c);
    expect(cc.healthTotal).toBeGreaterThan(0);
    expect(cc.awaitingReviewCount).toBeGreaterThanOrEqual(1); // completed-without-review
    expect(cc.upcomingFollowUp?.scheduledAt).toBe("2026-08-01T00:00:00Z");
    expect(cc.timeline.length).toBeGreaterThan(0);
    expect(cc.momentum.label).toBeTruthy();
  });
});

describe("baseline snapshot — immutable 'before'", () => {
  it("captures memory, strategist read, placement, and narratives", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "In Progress")] });
    const snap = composeSnapshot(c, "rec_integration-over-replacement", "In Progress");
    expect(snap.capturedFor).toBe("rec_integration-over-replacement");
    expect(snap.memory.length).toBeGreaterThan(0);
    expect(snap.strategist.inferences.length).toBeGreaterThan(0);
    expect(snap.businessNarrative.length).toBeGreaterThan(0);
  });

  it("round-trips through JSON (as stored)", () => {
    const c = ctx();
    const snap = composeSnapshot(c, "rec_manual-scheduling", "Approved");
    const parsed = parseSnapshot(JSON.stringify(snap));
    expect(parsed?.capturedFor).toBe("rec_manual-scheduling");
    expect(parseSnapshot("not json")).toBeNull();
  });
});

describe("portfolio row — executive read per business", () => {
  it("summarises stage, health, progress, and risk flags", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "Completed")], reviews: [review("rec_integration-over-replacement", "Supported")] });
    const row = buildPortfolioRow(c);
    expect(row.businessName).toBe("Bright Smiles Dental");
    expect(row.recommendationCount).toBeGreaterThan(0);
    expect(row.implementedCount).toBeGreaterThanOrEqual(1);
    expect(row.recentWin).toBe(true);
    expect(typeof row.atRisk).toBe("boolean");
  });
});
