import { describe, it, expect } from "vitest";
import { splitWorkspaces, assertNoContentInOutreach, proposalGroupOf, type WorkspaceVideo } from "./video-workspace";

const proposal = (over: Partial<WorkspaceVideo> = {}): WorkspaceVideo => ({
  id: "client-lead_1", businessId: "lead_1", workflow: "prospect", title: "Vertex Roofing", businessName: "Vertex Roofing",
  narration: "Hi — quick note on Vertex Roofing. Your site has no online booking so searchers can't schedule without calling. A booking page could capture those. Reply if useful.",
  findings: ["no online booking on your website"], hasScreenshot: true, renderStatus: "ready", prospectState: "READY_TO_APPROVE", ...over,
});
const content = (over: Partial<WorkspaceVideo> = {}): WorkspaceVideo => ({
  id: "004", workflow: "social", title: "Field note 004", narration: "A quick field note about small business websites.", renderStatus: "posted", ...over,
});

describe("mandate 25 — two-workspace split", () => {
  it("separates proposal from content; a record is in exactly one workspace; counts equal lists", () => {
    const s = splitWorkspaces([proposal(), proposal({ id: "client-lead_2", businessId: "lead_2", businessName: "Cedar Dental", prospectState: "SCHEDULED" }), content(), content({ id: "status-meeting", renderStatus: "ready" })]);
    expect(s.proposal.count).toBe(2);
    expect(s.content.count).toBe(2);
    expect(s.proposal.cards.length).toBe(s.proposal.count);
    expect(s.content.cards.length).toBe(s.content.count);
    // no id appears in both
    const pIds = new Set(s.proposal.cards.map((c) => c.id));
    expect(s.content.cards.every((c) => !pIds.has(c.id))).toBe(true);
  });

  it("groups proposals by canonical prospect state", () => {
    const s = splitWorkspaces([
      proposal({ id: "client-a", businessId: "a", prospectState: "NEEDS_VOICEOVER" }),
      proposal({ id: "client-b", businessId: "b", prospectState: "RENDERING" }),
      proposal({ id: "client-c", businessId: "c", prospectState: "NEEDS_ATTENTION" }),
      proposal({ id: "client-d", businessId: "d", prospectState: "READY_TO_APPROVE" }),
      proposal({ id: "client-e", businessId: "e", prospectState: "SCHEDULED" }),
      proposal({ id: "client-f", businessId: "f", prospectState: "SENT" }),
    ]);
    expect(s.proposal.groups["needs-narration"].map((c) => c.id)).toEqual(["client-a"]);
    expect(s.proposal.groups["rendering"].map((c) => c.id)).toEqual(["client-b"]);
    expect(s.proposal.groups["needs-attention"].map((c) => c.id)).toEqual(["client-c"]);
    expect(s.proposal.groups["ready-to-approve"].map((c) => c.id)).toEqual(["client-d"]);
    expect(s.proposal.groups["scheduled"].map((c) => c.id)).toEqual(["client-e"]);
    expect(s.proposal.groups["sent"].map((c) => c.id)).toEqual(["client-f"]);
  });

  it("ZERO cross-contamination: no content video reaches the proposal workspace and vice-versa", () => {
    const videos = [proposal(), content(), proposal({ id: "client-lead_2", businessId: "lead_2" }), content({ id: "status-meeting" })];
    expect(assertNoContentInOutreach(videos)).toEqual([]);
  });

  it("a CONTENT video is NEVER grouped as a proposal (structural bar); it lands in the content workspace only", () => {
    const s = splitWorkspaces([content({ id: "004" })]);
    expect(s.proposal.count).toBe(0);
    expect(s.content.count).toBe(1);
  });

  it("unclassified videos go to neither workspace until resolved", () => {
    const s = splitWorkspaces([{ id: "X_LEGACY_9", title: "mystery", narration: "", renderStatus: "needs-narration" }]);
    expect(s.proposal.count).toBe(0);
    expect(s.content.count).toBe(0);
    expect(s.unclassified.map((v) => v.id)).toEqual(["X_LEGACY_9"]);
  });

  it("frozen proposals surface an immutable next action", () => {
    const s = splitWorkspaces([proposal({ frozen: true, prospectState: "SCHEDULED" })]);
    expect(s.proposal.cards[0].frozen).toBe(true);
    expect(s.proposal.cards[0].nextAction).toMatch(/frozen/i);
  });

  it("proposalGroupOf falls back to render status when no lifecycle state is supplied", () => {
    expect(proposalGroupOf({ ...proposal(), prospectState: null, renderStatus: "failed" })).toBe("needs-attention");
    expect(proposalGroupOf({ ...proposal(), prospectState: null, renderStatus: "rendering" })).toBe("rendering");
  });
});
