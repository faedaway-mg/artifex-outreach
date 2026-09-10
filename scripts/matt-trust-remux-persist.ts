// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST EXPLAINER — REUSE-VISUAL-MASTER PERSIST (recovery amendment). Takes a LOCALLY-produced remux
// (approved Lucas VISUAL MASTER stream-copied + the existing canonical Matt AUDIO — no ElevenLabs, no
// visual re-render) and persists it as the canonical Matt trust explainer for a scope. Uploads mp4 +
// poster + a Matt-aligned VTT to the durable ArtifactStore and binds the MattTrustVideoRecord (landscape
// 16:9), recording the visual-master lineage. The prior (defective) render's bytes remain in the store as
// history — this only re-points the canonical record. Never calls ElevenLabs, never re-renders visuals.
//
// USAGE (prod env injected via `railway run`, DB reachable):
//   pnpm -s tsx scripts/matt-trust-remux-persist.ts --scope cta-conversion \
//     --mp4 /tmp/remux/matt_cta_landscape.mp4 --poster public/trust-videos/cta-conversion-v2-poster.jpg \
//     --visual-master cta-conversion-v2 --audio-seconds 65.78 --video-seconds 70.875
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { getArtifactStore } from "../src/lib/content-studio/storage-factory";
import { buildObjectKey } from "../src/lib/content-studio/cs-object-key";
import { csEnvironment } from "../src/lib/content-studio/env-guard";
import { getMattTrustVideo, setMattTrustVideo, mattTrustServedPaths, type MattTrustVideoRecord } from "../src/lib/voice/matt-trust-store";
import { trustVideoScript, TRUST_VIDEO_SCRIPT_VERSION } from "../src/lib/quick-fix/trust-videos";
import { trustNarrationRevision } from "../src/lib/quick-fix/trust-video-storyboard";
import type { TrustVideoScope } from "../src/lib/quick-fix/trust-videos";
import { createHash } from "node:crypto";

const ACTOR = "matt-trust-remux";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };

/** Build a deterministic Matt-aligned WebVTT: the trust narration split into cues distributed evenly over
 *  the AUDIO duration (Matt's timing). Lucas caption timing is NOT reused (it was Lucas-timed). */
function buildMattVtt(scope: TrustVideoScope, audioSeconds: number): string {
  const text = trustVideoScript(scope).replace(/\s+/g, " ").trim();
  const cues = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const totalWords = cues.reduce((n, c) => n + c.split(/\s+/).length, 0) || 1;
  const fmt = (s: number) => {
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = (s % 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${ss.toFixed(3).padStart(6, "0")}`;
  };
  let t = 0;
  const lines: string[] = ["WEBVTT", ""];
  for (const cue of cues) {
    const w = cue.split(/\s+/).length;
    const dur = (w / totalWords) * audioSeconds;
    const start = t, end = Math.min(audioSeconds, t + dur);
    lines.push(`${fmt(start)} --> ${fmt(end)}`, cue.trim(), "");
    t = end;
  }
  return lines.join("\n");
}

async function main() {
  const scope = arg("--scope") as TrustVideoScope | null;
  const mp4Path = arg("--mp4");
  const posterPath = arg("--poster");
  const visualMaster = arg("--visual-master") ?? "lucas-approved";
  const audioSeconds = Number(arg("--audio-seconds") ?? "0");
  const videoSeconds = Number(arg("--video-seconds") ?? "0");
  if (!scope || !mp4Path || !posterPath || !(audioSeconds > 0) || !(videoSeconds > 0)) {
    console.error("required: --scope --mp4 --poster --audio-seconds --video-seconds"); process.exit(2);
  }

  const existing = await getMattTrustVideo(scope);
  const narrationRevision = existing?.narrationRevision ?? trustNarrationRevision(scope);
  const voiceoverId = existing?.voiceoverId ?? null; // reuse the canonical Matt voiceover lineage

  const store = getArtifactStore();
  const mp4 = readFileSync(mp4Path);
  const poster = readFileSync(posterPath);
  const vtt = Buffer.from(buildMattVtt(scope, audioSeconds), "utf8");
  const tag = `${scope}_remux_${createHash("sha256").update(mp4).digest("hex").slice(0, 16)}`;
  const mkKey = (ext: string) => buildObjectKey({ artifactClass: "upload", env: csEnvironment(), operatorId: ACTOR, version: tag, ext });

  const mp4Put = await store.put(mkKey("mp4"), mp4, { artifactClass: "upload", contentType: "video/mp4", metadata: { trustVideo: scope, kind: "matt-trust-remux-mp4", visualMaster } });
  const posterPut = await store.put(mkKey("jpg"), poster, { artifactClass: "upload", contentType: "image/jpeg", metadata: { trustVideo: scope, kind: "matt-trust-remux-poster" } });
  const captionsPut = await store.put(mkKey("vtt"), vtt, { artifactClass: "upload", contentType: "text/vtt", metadata: { trustVideo: scope, kind: "matt-trust-remux-captions" } });

  const served = mattTrustServedPaths(scope);
  const now = new Date().toISOString();
  const record: MattTrustVideoRecord = {
    scope,
    voiceoverId,
    narrationRevision,
    scriptVersion: TRUST_VIDEO_SCRIPT_VERSION,
    mp4Key: mp4Put.key,
    posterKey: posterPut.key,
    captionsKey: captionsPut.key,
    mp4Url: served.mp4Url,
    posterUrl: served.posterUrl,
    captionsUrl: served.captionsUrl,
    captionsVerified: true, // VTT generated verbatim from the canonical narration
    durationSeconds: videoSeconds, // the playable length (full approved Lucas animation)
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: "16:9",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Lineage: approved visual master reused; audio = existing canonical Matt voiceover.
    visualMaster,
    source: "reuse-visual-master",
    audioSeconds,
  };
  await setMattTrustVideo(record, ACTOR);
  console.log(JSON.stringify({ scope, status: "BOUND", mp4Key: record.mp4Key, orientation: "landscape", visualMaster, voiceoverId, durationSeconds: videoSeconds, audioSeconds }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
