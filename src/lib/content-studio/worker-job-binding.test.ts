import { describe, it, expect } from "vitest";
// The production render worker is plain ESM under scripts/. We import its pure boundary function directly.
import { dbToFileJob } from "../../../scripts/worker-loop.mjs";

// REGRESSION (mandate II): in production the render worker reads a FILE job rebuilt from the claimed DB row
// by dbToFileJob. The prior implementation forwarded only audio — dropping screenshotKey/screenshotSha and
// the evidence storyboard — so compositeStoryboard injected ZERO evidence scenes and the SHA-verified
// website screenshot appeared nowhere in the production MP4 (not interior, not even the cover). These tests
// pin the boundary so the evidence binding can never be silently dropped again.
describe("dbToFileJob — evidence binding survives the DB→file-job boundary (mandate II)", () => {
  const row = {
    id: "csjob_abc123",
    piece_id: "client-lead_9",
    input_version: "v-xyz",
    mode: "uploaded-vo",
    audio_key: "content-studio/production/audio/csjob_abc123/vo.mp3",
    audio_sha: "aa".repeat(32),
    screenshot_key: "content-studio/production/screenshot/lead_9/home.png",
    screenshot_sha: "bb".repeat(32),
    // postgres.js returns jsonb already parsed — an array of storyboard scenes.
    storyboard: [
      { scene: 2, narrationLine: 0, purpose: "page-reviewed", screenshotKey: "k", screenshotSha: "bb".repeat(32) },
      { scene: 4, narrationLine: 2, purpose: "evidence", screenshotKey: "k", screenshotSha: "bb".repeat(32), onScreenContext: "What visitors see" },
    ],
    attempt: 1,
    created_at: "2026-09-02T12:30:00.000Z",
  };

  it("forwards screenshotKey and screenshotSha (the interior cover + evidence binding)", () => {
    const fj = dbToFileJob(row);
    expect(fj.screenshotKey).toBe(row.screenshot_key);
    expect(fj.screenshotSha).toBe(row.screenshot_sha);
  });

  it("forwards the evidence storyboard as an array the renderer's compositeStoryboard can consume", () => {
    const fj = dbToFileJob(row);
    expect(Array.isArray(fj.storyboard)).toBe(true);
    const evidence = fj.storyboard.filter((s: any) => s && s.purpose === "evidence" && s.screenshotKey);
    expect(evidence.length).toBeGreaterThan(0); // compositeStoryboard would inject >=1 evidenceShot beat
    expect(evidence[0].screenshotSha).toBe(row.screenshot_sha);
  });

  it("carries the audio binding through as before (no regression to the VO path)", () => {
    const fj = dbToFileJob(row);
    expect(fj.audioKey).toBe(row.audio_key);
    expect(fj.audioSha).toBe(row.audio_sha);
    expect(fj.pieceId).toBe(row.piece_id);
  });

  it("degrades safely when a job has no evidence (social piece: null screenshot + null storyboard)", () => {
    const social = { id: "csjob_soc", piece_id: "007", input_version: "v1", mode: "uploaded-vo", audio_key: "k", audio_sha: "c", attempt: 1, created_at: "2026-09-02T00:00:00.000Z" };
    const fj = dbToFileJob(social);
    expect(fj.screenshotKey).toBeNull();
    expect(fj.screenshotSha).toBeNull();
    expect(fj.storyboard).toBeNull();
  });
});
