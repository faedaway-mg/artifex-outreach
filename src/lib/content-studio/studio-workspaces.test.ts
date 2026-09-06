import { describe, it, expect } from "vitest";
import { assembleWorkspaceVideos, buildStudioWorkspaces, focusStateToProspect, type SnapshotItemLike, type LeadLifecycle } from "./studio-workspaces";

const item = (over: Partial<SnapshotItemLike["piece"]> & { jobs?: any[]; provenance?: any; postedAt?: string | null }): SnapshotItemLike => ({
  piece: { id: over.id ?? "client-lead_1", businessId: "businessId" in over ? over.businessId : "lead_1", workflow: over.workflow ?? "prospect", title: over.title ?? "Vertex", businessName: over.businessName ?? "Vertex Roofing", narration: over.narration ?? ["Hi.", "Bye."], revision: over.revision ?? 1 },
  jobs: over.jobs ?? [],
  provenance: over.provenance ?? { approved: false },
  postedAt: over.postedAt ?? null,
});

describe("mandate 25 — studio workspace server assembly", () => {
  it("maps focus states to canonical prospect states", () => {
    expect(focusStateToProspect("needs-voiceover")).toBe("NEEDS_VOICEOVER");
    expect(focusStateToProspect("ready-to-schedule")).toBe("READY_TO_APPROVE");
    expect(focusStateToProspect("scheduled")).toBe("SCHEDULED");
    expect(focusStateToProspect("sent")).toBe("SENT");
    expect(focusStateToProspect("bogus")).toBeNull();
  });

  it("derives render status from jobs + posted marker", () => {
    const byLead: Record<string, LeadLifecycle> = { lead_1: { state: "RENDERING", finding: "no online booking" } };
    const vids = assembleWorkspaceVideos([
      item({ id: "client-lead_1", businessId: "lead_1", jobs: [{ status: "rendering", createdAt: "2026-01-01" }] }),
    ], byLead);
    expect(vids[0].renderStatus).toBe("rendering");
    expect(vids[0].prospectState).toBe("RENDERING");
    expect(vids[0].evidenceSummary).toBe("no online booking");
  });

  it("scheduled/sent proposals are marked frozen", () => {
    const byLead: Record<string, LeadLifecycle> = { lead_1: { state: "SCHEDULED", finding: null } };
    const vids = assembleWorkspaceVideos([item({ id: "client-lead_1", businessId: "lead_1" })], byLead);
    expect(vids[0].frozen).toBe(true);
  });

  it("buildStudioWorkspaces splits proposal vs content with no overlap", () => {
    const split = buildStudioWorkspaces([
      item({ id: "client-lead_1", businessId: "lead_1", workflow: "prospect" }),
      item({ id: "004", businessId: null, workflow: "social", title: "Field note", narration: ["A field note."] }),
    ], { lead_1: { state: "READY_TO_APPROVE", finding: "x" } });
    expect(split.proposal.count).toBe(1);
    expect(split.content.count).toBe(1);
  });
});
