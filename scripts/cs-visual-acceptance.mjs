// Content Studio — VISUAL ACCEPTANCE harness (section F addendum, item 6). Proves the real screenshot is
// composited into the finished MP4 during the finding it supports — not just as the poster/frame zero.
//
// For each evidence scene it: (1) extracts the frame at the evidence timestamp and at a CONTROL timestamp
// (a non-evidence scene), (2) crops the known interior-card region, (3) reduces each to a tiny colour
// signature, (4) proves the evidence-frame region matches the EXPECTED screenshot artifact far better than
// the control frame does — i.e. the screenshot appears BEYOND frame zero, in the right scene, and NOT
// everywhere. It also proves the composited screenshot is not darkened (no vignette/scrim) and sits inside
// the 1080×1920 safe area. Pure ffmpeg — no image libraries.
import { execFileSync } from "node:child_process";

// The interior evidence-card region in the 1080×1920 frame — pinned to scene-template.html .evframe
// geometry (600×880 card, inset to avoid the 2px border + rounded corners). The composited screenshot
// fills this card at an evidence timestamp.
export const CARD = { w: 560, h: 840, x: 260, y: 616 };
const SAFE_MARGIN = 40;

// Reduce an image (or a crop of a video frame) to a small rgb24 signature buffer.
//   cropFrame   → crop the frame to the card region before downscaling (video frames)
//   coverForCard→ scale+top-crop a source image the way the card's CSS object-fit:cover; object-position:top
//                 does, so the reference matches WHAT THE CARD ACTUALLY SHOWS (not the full image)
function sig(input, { seek, cropFrame, coverForCard } = {}) {
  const vf = [];
  if (cropFrame) vf.push(`crop=${CARD.w}:${CARD.h}:${CARD.x}:${CARD.y}`);
  if (coverForCard) vf.push(`scale=${CARD.w}:-1`, `crop=${CARD.w}:${CARD.h}:0:0`);
  vf.push("scale=32:48");
  const args = ["-v", "error"];
  if (seek != null) args.push("-ss", String(seek));
  args.push("-i", input, "-frames:v", "1", "-vf", vf.join(","), "-f", "rawvideo", "-pix_fmt", "rgb24", "-");
  return execFileSync("ffmpeg", args, { maxBuffer: 1 << 24 });
}

// Mean absolute per-channel difference between two equal-length rgb signatures (0..255; lower = more alike).
export function diff(a, b) {
  const n = Math.min(a.length, b.length); let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}
// Average luminance of a signature buffer (0..255).
export function luma(buf) { let s = 0; for (let i = 0; i < buf.length; i += 3) s += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]; return s / (buf.length / 3); }

// Pure verdict from precomputed metrics — the same thresholds verifyEvidenceScene applies. Exposed so the
// acceptance rules are unit-testable without a render (the end-to-end render proof lives in a runnable script).
export function judge({ dEvidence, dControl, evLuma, vignetteRatio, card = CARD }) {
  const matchesScreenshot = dEvidence < 42;
  const beatsControl = dControl - dEvidence > 12;
  const notDark = evLuma > 40;
  const noVignette = vignetteRatio > 0.82;
  const inSafeArea = card.x >= SAFE_MARGIN && card.y >= SAFE_MARGIN && card.x + card.w <= 1080 - SAFE_MARGIN && card.y + card.h <= 1920 - SAFE_MARGIN;
  return { ok: matchesScreenshot && beatsControl && notDark && noVignette && inSafeArea, checks: { matchesScreenshot, beatsControl, notDark, noVignette, inSafeArea } };
}

// Border-vs-centre luminance ratio of the card at a timestamp — a vignette/scrim darkens the border.
function vignetteRatio(mp4, at) {
  const ring = (crop) => luma(execFileSync("ffmpeg", ["-v", "error", "-ss", String(at), "-i", mp4, "-frames:v", "1", "-vf", `crop=${crop},scale=16:16`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 22 }));
  const centre = ring(`${Math.round(CARD.w * 0.4)}:${Math.round(CARD.h * 0.4)}:${CARD.x + Math.round(CARD.w * 0.3)}:${CARD.y + Math.round(CARD.h * 0.3)}`);
  const topEdge = ring(`${CARD.w}:60:${CARD.x}:${CARD.y + 20}`);
  const botEdge = ring(`${CARD.w}:60:${CARD.x}:${CARD.y + CARD.h - 80}`);
  const edge = (topEdge + botEdge) / 2;
  return centre > 0 ? +(edge / centre).toFixed(3) : 1;
}

// Verify one evidence scene. Returns a structured verdict; `ok` is the AND of every check.
export function verifyEvidenceScene({ mp4, screenshotPng, evidenceAt, controlAt }) {
  const shot = sig(screenshotPng, { coverForCard: true });
  const evRegion = sig(mp4, { seek: evidenceAt, cropFrame: true });
  const ctlRegion = sig(mp4, { seek: controlAt, cropFrame: true });
  const dEvidence = +diff(evRegion, shot).toFixed(2);   // evidence-frame card vs the real screenshot
  const dControl = +diff(ctlRegion, shot).toFixed(2);   // control-frame card vs the real screenshot
  const evLuma = +luma(evRegion).toFixed(1);
  const vig = vignetteRatio(mp4, evidenceAt);

  // The evidence-frame card must clearly match the screenshot AND clearly beat the control (so the shot is
  // in THIS scene, beyond frame zero, and not smeared across every scene), be bright (not a black tile),
  // un-vignetted, and inside the safe area. Single-sourced thresholds live in judge().
  const v = judge({ dEvidence, dControl, evLuma, vignetteRatio: vig });
  return { ok: v.ok, evidenceAt, controlAt, dEvidence, dControl, evLuma, vignetteRatio: vig, checks: v.checks };
}

// ffprobe the output the same way the render worker does (container, dims, frames, audio, duration).
export function probeOutput(mp4) {
  const j = (a) => JSON.parse(execFileSync("ffprobe", ["-v", "error", ...a, "-of", "json", mp4]).toString());
  const fmt = j(["-show_entries", "format=format_name,duration"]).format || {};
  const v = j(["-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,nb_read_packets", "-count_packets"]).streams?.[0] || {};
  const a = j(["-select_streams", "a:0", "-show_entries", "stream=codec_name"]).streams?.[0] || {};
  return { container: fmt.format_name, duration: +(+fmt.duration || 0).toFixed(2), width: +v.width, height: +v.height, vcodec: v.codec_name, frames: +v.nb_read_packets || 0, acodec: a.codec_name || null };
}

// CLI: node cs-visual-acceptance.mjs <mp4> <screenshotPng> <evidenceAt> <controlAt>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mp4, png, ev, ctl] = process.argv.slice(2);
  const probe = probeOutput(mp4);
  const verdict = verifyEvidenceScene({ mp4, screenshotPng: png, evidenceAt: +ev, controlAt: +ctl });
  console.log(JSON.stringify({ probe, verdict }, null, 2));
  process.exit(verdict.ok ? 0 : 3);
}
