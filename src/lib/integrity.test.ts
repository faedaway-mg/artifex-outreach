import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, RoadmapProgressItem, OutcomeReviewItem, EngagementSnapshotItem } from "./types";
import { checkIntegrity } from "./integrity";

const mem = (id: string, leadId: string, over: Partial<RelationshipMemoryItem> = {}): RelationshipMemoryItem => ({
  id, leadId, category: "Existing Systems", title: "t", value: "v", status: "Verified", confidence: "High", source: "Discovery Meeting", supportingContext: null, operatorNotes: null, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", ...over,
});
const prog = (id: string, leadId: string, recommendationId: string, over: Partial<RoadmapProgressItem> = {}): RoadmapProgressItem => ({
  id, leadId, recommendationId, title: "t", status: "Recommended", operatorNotes: null, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", ...over,
});
const rev = (id: string, leadId: string, recommendationId: string, over: Partial<OutcomeReviewItem> = {}): OutcomeReviewItem => ({
  id, leadId, recommendationId, title: "t", status: "Awaiting Review", expectedOutcome: "", beforeState: "", observedOutcome: "", evidence: "", unexpectedConsequences: "", lessonsLearned: "", confidence: "Low", reviewedAt: null, operatorNotes: null, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", ...over,
});
const snap = (id: string, leadId: string, recommendationId: string, trigger = "Approved", payload = "{}"): EngagementSnapshotItem => ({ id, leadId, recommendationId, trigger, payload, createdAt: "2026-07-01T00:00:00Z" });

const LEADS = new Set(["L1", "L2"]);

describe("integrity — a clean dataset passes every check", () => {
  it("passes with sound data", () => {
    const r = checkIntegrity({
      leadIds: LEADS,
      memory: [mem("m1", "L1"), mem("m2", "L2")],
      progress: [prog("p1", "L1", "rec_a")],
      reviews: [rev("o1", "L1", "rec_a")],
      snapshots: [snap("s1", "L1", "rec_a")],
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("integrity — catches every failure mode", () => {
  it("flags duplicate ids", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [mem("m1", "L1"), mem("m1", "L1")], progress: [], reviews: [], snapshots: [] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "No duplicate record ids")!.ok).toBe(false);
  });

  it("flags orphaned records", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [mem("m1", "GHOST")], progress: [], reviews: [], snapshots: [] });
    expect(r.checks.find((c) => c.name === "No orphaned records")!.ok).toBe(false);
  });

  it("flags duplicate journal entries per recommendation", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [], progress: [prog("p1", "L1", "rec_a"), prog("p2", "L1", "rec_a")], reviews: [], snapshots: [] });
    expect(r.checks.find((c) => c.name === "One journal entry per recommendation")!.ok).toBe(false);
  });

  it("flags impossible states", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [], progress: [prog("p1", "L1", "rec_a", { status: "Teleported" as RoadmapProgressItem["status"] })], reviews: [], snapshots: [] });
    expect(r.checks.find((c) => c.name === "No impossible states")!.ok).toBe(false);
  });

  it("flags lost provenance and unreadable snapshots", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [mem("m1", "L1", { source: "" as RelationshipMemoryItem["source"] })], progress: [], reviews: [], snapshots: [snap("s1", "L1", "rec_a", "Approved", "{not json")] });
    expect(r.checks.find((c) => c.name === "Provenance intact")!.ok).toBe(false);
  });

  it("flags duplicate baselines (immutability breach)", () => {
    const r = checkIntegrity({ leadIds: LEADS, memory: [], progress: [], reviews: [], snapshots: [snap("s1", "L1", "rec_a"), snap("s2", "L1", "rec_a")] });
    expect(r.checks.find((c) => c.name === "No duplicate baselines")!.ok).toBe(false);
  });
});
