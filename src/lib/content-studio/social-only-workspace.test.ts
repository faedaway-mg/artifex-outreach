// §13-18 SOCIAL-ONLY refactor. The NORMAL Content Studio page feed is CONTENT (social) videos ONLY: prospect
// (proposal) cards, their count, and the "Outreach Reviews" proposal tab must NEVER surface in the normal
// workspace. This asserts the content-only projection the page uses (contentOnlyWorkspaces), while the full
// two-workspace split remains intact for Admin/Detail surfaces.
import { describe, it, expect } from "vitest";
import { contentOnlyWorkspaces } from "./studio-page-data";
import { buildStudioWorkspaces, type SnapshotItemLike, type LeadLifecycle } from "./studio-workspaces";

const prospect = (id: string, businessId: string): SnapshotItemLike => ({
  piece: { id, businessId, workflow: "prospect", title: businessId, businessName: `${businessId} Co`, narration: ["Hi.", "Bye."], revision: 1 },
  jobs: [{ status: "ready", createdAt: "2026-01-01" }],
  provenance: { approved: false },
  postedAt: null,
});
const social = (id: string): SnapshotItemLike => ({
  piece: { id, businessId: null, workflow: "social", title: `Field note ${id}`, narration: ["A social field note about small business websites."], revision: 1 },
  jobs: [{ status: "ready", createdAt: "2026-01-01" }],
  provenance: { approved: true },
  postedAt: null,
});

describe("§13-18 — normal Content Studio workspace is social/content ONLY", () => {
  const byLead: Record<string, LeadLifecycle> = {
    lead_1: { state: "READY_TO_APPROVE", finding: "no online booking" },
    lead_2: { state: "SCHEDULED", finding: "stale gallery" },
  };
  const split = buildStudioWorkspaces(
    [prospect("client-lead_1", "lead_1"), prospect("client-lead_2", "lead_2"), social("004"), social("005")],
    byLead,
  );

  it("forces the active tab to content (no proposal tab)", () => {
    expect(contentOnlyWorkspaces(split).activeType).toBe("content");
  });

  it("reports ZERO proposal count and empty proposal groups (no prospect cards in the feed)", () => {
    const ws = contentOnlyWorkspaces(split);
    expect(ws.counts.proposal).toBe(0);
    const proposalCards = Object.values(ws.proposal.groups).flat();
    expect(proposalCards).toHaveLength(0);
  });

  it("surfaces the social/content videos (and their count) unchanged", () => {
    const ws = contentOnlyWorkspaces(split);
    expect(ws.counts.content).toBe(split.content.count);
    expect(ws.counts.content).toBe(2);
    const contentIds = Object.values(ws.content.groups).flat().map((c) => c.id).sort();
    expect(contentIds).toEqual(["004", "005"]);
  });

  it("never leaks a prospect (client-*) id into the normal feed", () => {
    const ws = contentOnlyWorkspaces(split);
    const allIds = [...Object.values(ws.proposal.groups).flat(), ...Object.values(ws.content.groups).flat()].map((c) => c.id);
    expect(allIds.some((id) => id.startsWith("client-"))).toBe(false);
  });

  it("keeps the underlying two-workspace split intact for Admin/Detail surfaces", () => {
    // The prospect data model is NOT removed — the full split still carries the proposal cards, which the
    // dedicated per-company workspace + orderedCardIds continue to use.
    expect(split.proposal.count).toBe(2);
  });
});
