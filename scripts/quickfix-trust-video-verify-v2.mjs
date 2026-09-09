// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX TRUST-VIDEO v2 QA — verifies the DELIVERED artifacts (no re-render).
// For each scope's v2 asset it checks: 1080p video + AAC audio + duration, REAL
// MOTION (three frames sampled straight from the mp4 at 10/50/90% must differ),
// a poster, and WebVTT captions (valid header + cue count). Rewrites manifest-v2.json
// with the authoritative active flags. Exit 0 iff every scope passes.
//   node scripts/quickfix-trust-video-verify-v2.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "trust-videos");
const SCOPES = ["contact-form-lead-capture", "cta-conversion", "mobile-responsive", "accessibility", "analytics-tracking", "cms-technical", "seo-metadata", "homepage-sprint", "fix-scan"];
const TITLES = {
  "contact-form-lead-capture": "Contact Form & Lead Capture", "cta-conversion": "CTA & Conversion",
  "mobile-responsive": "Mobile & Responsive Layout", "accessibility": "Accessibility",
  "analytics-tracking": "Analytics & Tracking", "cms-technical": "CMS & Technical",
  "seo-metadata": "SEO & Metadata", "homepage-sprint": "Homepage Conversion Sprint", "fix-scan": "Fix Scan",
};
const sha16 = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
function ffprobeJson(f) { return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,codec_name", "-of", "json", f], { encoding: "utf8" })); }

function main() {
  const manifest = [];
  for (const scope of SCOPES) {
    const mp4 = path.join(OUT_DIR, `${scope}-v2.mp4`);
    const poster = path.join(OUT_DIR, `${scope}-v2-poster.jpg`);
    const vtt = path.join(OUT_DIR, `${scope}-v2.vtt`);
    if (!existsSync(mp4)) { console.log(`  ✗ ${scope}: mp4 missing`); manifest.push({ scope, active: false, qa: { missing: true } }); continue; }
    const probe = ffprobeJson(mp4);
    const v = (probe.streams || []).find((x) => x.codec_type === "video");
    const a = (probe.streams || []).find((x) => x.codec_type === "audio");
    const dur = Number(probe.format?.duration || 0);
    const nSamples = 4;
    const distinct = new Set([0.2, 0.4, 0.6, 0.8].map((f) => {
      const png = path.join(tmpdir(), `qfv-${scope}-${Math.round(f * 100)}.png`);
      execFileSync("ffmpeg", ["-y", "-ss", String(dur * f), "-i", mp4, "-frames:v", "1", png], { stdio: "ignore" });
      const h = sha16(readFileSync(png)); rmSync(png, { force: true }); return h;
    })).size;
    let cues = 0, vttOk = false;
    if (existsSync(vtt)) { const t = readFileSync(vtt, "utf8"); vttOk = t.startsWith("WEBVTT"); cues = (t.match(/-->/g) || []).length; }
    const qa = {
      hasVideo: !!v, res: v ? `${v.width}x${v.height}` : "none", hasAudio: !!a, audioCodec: a?.codec_name,
      durationSec: Math.round(dur * 10) / 10, hasMotion: distinct === nSamples, motionFrames: `${distinct}/${nSamples}`,
      hasPoster: existsSync(poster), hasCaptions: vttOk, captionCues: cues,
    };
    const active = qa.hasVideo && qa.res === "1920x1080" && qa.hasAudio && dur > 30 && qa.hasMotion && qa.hasPoster && qa.hasCaptions && cues > 0;
    console.log(`  ${active ? "✓" : "✗"} ${scope}: ${qa.res} ${qa.durationSec}s audio=${qa.audioCodec} motion=${qa.motionFrames} poster=${qa.hasPoster} captions=${cues}cue`);
    manifest.push({ scope, title: TITLES[scope], file: `/trust-videos/${scope}-v2.mp4`, poster: `/trust-videos/${scope}-v2-poster.jpg`, captions: `/trust-videos/${scope}-v2.vtt`, version: 2, scriptVersion: "qf-trust-v2-2026-09", durationSeconds: qa.durationSec, qa, active });
  }
  const okCount = manifest.filter((m) => m.active).length;
  writeFileSync(path.join(OUT_DIR, "manifest-v2.json"), JSON.stringify({ generatedWith: "playwright-chromium frame-by-frame + ffmpeg (libx264/aac)", scriptVersion: "qf-trust-v2-2026-09", fps: 24, verifiedAt: process.env.QF_STAMP || "", assets: manifest }, null, 2));
  console.log(`\n════════ v2 QA: ${okCount}/${manifest.length} passed ════════\n`);
  process.exit(okCount === manifest.length ? 0 : 1);
}
main();
