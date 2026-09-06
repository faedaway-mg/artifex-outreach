import { describe, it, expect } from "vitest";
import { resolveOutreachVideoBinding } from "./prospect-package-store";
import type { RenderJob } from "../content-studio/types";

// Minimal READY render job for a piece.
const readyJob = (pieceId: string): RenderJob => ({
  id: "csjob_" + pieceId, pieceId, inputVersion: "v" + pieceId, status: "ready", progress: 1,
  stage: "Ready", mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: "a", audioSha: "sha",
  audioLabel: "vo", outputFile: null, outputRel: null, outputKey: "out/" + pieceId, posterKey: null,
  thumbRel: null, error: null, attempt: 1, pid: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
});
const meta = async () => ({ sha256: "deadbeef" });

describe("mandate 25 — structural outreach boundary at the video-binding seam", () => {
  it("binds a PROPOSAL video (client-<leadId> piece) into the package", async () => {
    const leadId = "lead_ABC";
    const binding = await resolveOutreachVideoBinding(leadId, {
      jobs: async () => [readyJob(`client-${leadId}`)],
      getMeta: meta,
    });
    expect(binding).not.toBeNull();
    expect(binding!.videoKey).toBe(`out/client-${leadId}`);
  });

  it("only ever looks up the lead's own client-<leadId> piece (a stray CONTENT render is never bound)", async () => {
    // A CONTENT field-note render ("004") coexists in the store. Because the resolver keys strictly on the
    // lead's own client-<leadId> piece, the stray CONTENT render is invisible to outreach — the resolver
    // returns null (no client- render for this lead), never the content one.
    const leadId = "lead_ABC";
    const binding = await resolveOutreachVideoBinding(leadId, {
      jobs: async () => [readyJob("004"), readyJob("status-meeting")],
      getMeta: meta,
    });
    expect(binding).toBeNull();
    // The bar predicate itself refuses those content pieces (backstop for any future caller).
    const { outreachBarReason } = await import("../content-studio/video-classification");
    expect(outreachBarReason({ id: "004" })).toMatch(/content/i);
    expect(outreachBarReason({ id: "status-meeting" })).toMatch(/content/i);
  });

  it("returns null when there is no ready render at all (nothing to bind)", async () => {
    const binding = await resolveOutreachVideoBinding("lead_X", { jobs: async () => [], getMeta: meta });
    expect(binding).toBeNull();
  });
});
