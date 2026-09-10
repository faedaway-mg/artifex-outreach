import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth + the heavy zero-touch pipeline + the piece/job store; the idea store/feed run
// for real against the in-memory Settings singleton.
const { generateZeroTouch, getPieces, listJobs } = vi.hoisted(() => ({
  generateZeroTouch: vi.fn(),
  getPieces: vi.fn(async () => [] as any[]),
  listJobs: vi.fn(async () => [] as any[]),
}));
vi.mock("@/lib/auth", () => ({ isAuthenticated: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./zero-touch-actions", () => ({ generateZeroTouch }));
vi.mock("./store", async (orig) => ({ ...(await orig() as any), getPieces, listJobs }));

import { getIdeaRecords, getActiveIdeas, addIdeas, archiveIdea, setIdea, activeIdeaTitles } from "./idea-store";
import { loadIdeaFeed } from "./idea-feed";
import { generateIdeaVideoAction, archiveIdeaAction } from "./idea-actions";
import { generateSocialIdeas } from "./social-ideas";

describe("idea queue store + feed (mandate D)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds a curated starter feed once, all in IDEA state", async () => {
    const recs = await getIdeaRecords("2026-09-10T00:00:00.000Z");
    expect(recs.length).toBeGreaterThanOrEqual(4);
    expect(recs.every((r) => r.state === "IDEA" || r.state === "ARCHIVED")).toBe(true);
  });

  it("adds new ideas and dedupes on repeat", async () => {
    const before = (await getActiveIdeas()).length;
    const fresh = generateSocialIdeas({ existingKeys: (await activeIdeaTitles()).keys, existingTitles: (await activeIdeaTitles()).titles, count: 2, seed: 42 });
    const added = await addIdeas(fresh);
    const again = await addIdeas(fresh); // exact re-add → no duplicates
    expect(again).toHaveLength(0);
    expect((await getActiveIdeas()).length).toBe(before + added.length);
  });

  it("archived ideas leave the active feed", async () => {
    const recs = await getActiveIdeas();
    const target = recs[0];
    await archiveIdea(target.id);
    expect((await getActiveIdeas()).find((r) => r.id === target.id)).toBeUndefined();
  });

  it("feed surfaces a finished video (canonical media url, never a raw path) once a piece is ready", async () => {
    const recs = await getActiveIdeas();
    const idea = recs[0];
    await setIdea(idea.id, { state: "GENERATING", pieceId: "zt-piece-xyz" });
    getPieces.mockResolvedValue([{ id: "zt-piece-xyz", recommendedRel: "/api/content-studio/media/zt-piece-xyz", thumbRel: "/api/content-studio/poster/zt-piece-xyz" }]);
    listJobs.mockResolvedValue([{ pieceId: "zt-piece-xyz", status: "ready" }]);
    const feed = await loadIdeaFeed();
    const card = feed.find((c) => c.id === idea.id)!;
    expect(card.state).toBe("READY");
    expect(card.finished).toBe(true);
    expect(card.downloadUrl).toBe("/api/content-studio/media/zt-piece-xyz");
    expect(card.downloadUrl).not.toMatch(/rlwy|postgres|amazonaws/i);
  });
});

describe("idea → video action (mandate D §11/§13/§16)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes the idea's auto-written brief into Zero-Touch (operator never re-describes it)", async () => {
    const idea = (await getActiveIdeas())[0];
    generateZeroTouch.mockResolvedValue({ ok: true, pieceId: "zt-new", stage: "BUILDING_VIDEO" });
    const res = await generateIdeaVideoAction(idea.id, false);
    expect(res.ok).toBe(true);
    const call = generateZeroTouch.mock.calls[0][0];
    expect(call.title).toBe(idea.title);
    expect(call.brief).toBe(idea.brief); // the system's brief is the input — not a re-typed prompt
    // The idea links to its render piece + moves to GENERATING.
    const updated = (await getIdeaRecords()).find((r) => r.id === idea.id)!;
    expect(updated.pieceId).toBe("zt-new");
    expect(updated.state).toBe("GENERATING");
  });

  it("reserve boundary → needsOverride passes through and nothing is linked/spent", async () => {
    const idea = (await getActiveIdeas())[1];
    generateZeroTouch.mockResolvedValue({ ok: false, needsOverride: true, stage: "NEEDS_OVERRIDE", reason: "reserved" });
    const res = await generateIdeaVideoAction(idea.id, false);
    expect(res.needsOverride).toBe(true);
    const updated = (await getIdeaRecords()).find((r) => r.id === idea.id)!;
    expect(updated.pieceId).toBeNull();
    expect(updated.state).not.toBe("GENERATING");
  });

  it("archive action removes an idea from the feed", async () => {
    const idea = (await getActiveIdeas())[0];
    await archiveIdeaAction(idea.id);
    expect((await getActiveIdeas()).find((r) => r.id === idea.id)).toBeUndefined();
  });
});
