// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — IDEA FEED ASSEMBLER (mandate D). Enriches the persisted idea records
// with their LIVE Zero-Touch state (queued/rendering/ready) + the finished video's
// canonical media/poster URLs, so each idea card can show Generate → Creating… → the
// playable video + Download without the operator ever leaving the feed. Read-only.
// ─────────────────────────────────────────────────────────────────────────────
import { getPieces, listJobs } from "./store";
import { getActiveIdeas, type IdeaState } from "./idea-store";

export interface IdeaCard {
  id: string;
  title: string;
  hook: string;
  brief: string;
  targetSeconds: number;
  aspectRatio: "9:16";
  theme: string;
  state: IdeaState;          // display state (reconciled with the live render job)
  pieceId: string | null;
  finished: boolean;
  mediaUrl: string | null;   // canonical durable media route (never a raw storage path)
  downloadUrl: string | null;
  posterUrl: string | null;
  jobStatus: "none" | "queued" | "rendering" | "ready" | "failed";
}

export async function loadIdeaFeed(nowIso = new Date().toISOString()): Promise<IdeaCard[]> {
  const [ideas, pieces, jobs] = await Promise.all([getActiveIdeas(nowIso), getPieces(), listJobs()]);
  const pieceById = new Map(pieces.map((p) => [p.id, p]));

  return ideas.map((idea) => {
    const piece = idea.pieceId ? pieceById.get(idea.pieceId) ?? null : null;
    const pieceJobs = idea.pieceId ? jobs.filter((j) => j.pieceId === idea.pieceId) : [];
    const ready = pieceJobs.some((j) => j.status === "ready") || !!piece?.recommendedRel;
    const rendering = pieceJobs.some((j) => j.status === "rendering");
    const queued = pieceJobs.some((j) => j.status === "queued");
    const failed = !ready && pieceJobs.length > 0 && pieceJobs.every((j) => j.status === "failed");
    const jobStatus: IdeaCard["jobStatus"] = ready ? "ready" : rendering ? "rendering" : queued ? "queued" : failed ? "failed" : "none";

    // Reconcile the display state with live signals (a finished worker render shows READY
    // even if the stored record hasn't been patched yet).
    let state: IdeaState = idea.state;
    if (ready) state = "READY";
    else if (rendering || queued) state = "GENERATING";
    else if (failed) state = "FAILED";

    const mediaUrl = idea.pieceId
      ? (piece?.recommendedRel || (ready ? `/api/content-studio/media/${encodeURIComponent(idea.pieceId)}` : null))
      : null;

    return {
      id: idea.id,
      title: idea.title,
      hook: idea.hook,
      brief: idea.brief,
      targetSeconds: idea.targetSeconds,
      aspectRatio: idea.aspectRatio,
      theme: idea.theme,
      state,
      pieceId: idea.pieceId,
      finished: ready,
      mediaUrl,
      downloadUrl: mediaUrl,
      posterUrl: piece?.thumbRel || null,
      jobStatus,
    };
  });
}
