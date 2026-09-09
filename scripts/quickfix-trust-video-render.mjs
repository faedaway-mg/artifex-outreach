// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX TRUST-VIDEO RENDER — turns the (externally generated) evergreen
// narration MP3s into branded, servable MP4s using the existing render tooling:
// headless Chromium (Playwright) renders a clean Artifex-branded 1080p frame per
// scope, then ffmpeg muxes it with the narration audio. Outputs to
// public/trust-videos/<family>-v<ver>.mp4 (+ poster) and writes a manifest with
// per-asset QA. Evergreen + non-lead-specific: opening/process/trust language is
// shared; only the scope title/descriptor changes per family.
//
//   node scripts/quickfix-trust-video-render.mjs [familyKey]
//   (no arg = render all)
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const AUDIO_DIR = "/Users/jordanjackson/Downloads/Artifex Labs - Quick Fix Naratives";
const OUT_DIR = path.join(ROOT, "public", "trust-videos");
const FONT_DIR = "file://" + path.join(ROOT, "public", "fonts", "pdf");
const VERSION = 1;
const SCRIPT_VERSION = "qf-trust-v1-2026-09";

// scope key → { title, descriptor, audio file, scope module (spoken) }
const SCOPES = {
  "contact-form-lead-capture": { title: "Contact Form & Lead Capture", descriptor: "Repairing the path that turns visitors into inquiries.", audio: "Artifex Evergreen - Contact form _ lead capture.mp3", tag: "01" },
  "cta-conversion":            { title: "CTA & Conversion",            descriptor: "Fixing the friction between a visitor and the action you want.", audio: "Artifex Evergreen - CTA _ conversion.mp3", tag: "02" },
  "mobile-responsive":         { title: "Mobile & Responsive Layout",  descriptor: "Correcting how the experience behaves across screen sizes.", audio: "Artifex Evergreen - Mobile _ layout.mp3", tag: "03" },
  "accessibility":             { title: "Accessibility",               descriptor: "Remediating a specific issue that makes the site harder to use.", audio: "Artifex Evergreen - Accessibility.mp3", tag: "04" },
  "analytics-tracking":        { title: "Analytics & Tracking",        descriptor: "Making the activity you care about measurable — and verified.", audio: "Artifex Evergreen - Analytics _ tracking.mp3", tag: "05" },
  "cms-technical":             { title: "CMS & Technical",             descriptor: "Isolating and correcting a specific technical issue in your CMS.", audio: "Artifex Evergreen - CMS _ technical.mp3", tag: "06" },
  "seo-metadata":              { title: "SEO & Metadata",              descriptor: "Correcting a defined technical search-visibility issue.", audio: "Artifex Evergreen - SEO _ metadata cleanup.mp3", tag: "07" },
  "homepage-sprint":           { title: "Homepage Conversion Sprint",  descriptor: "One contained sprint on your highest-value page.", audio: "Artifex Evergreen - Homepage _ conversion sprint.mp3", tag: "08" },
  "fix-scan":                  { title: "Fix Scan",                    descriptor: "Inspect first. Diagnose the real problem. Recommend the right fix.", audio: "Artifex Evergreen - Fix Scan.mp3", tag: "09" },
};

function frameHtml(s) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Regular.ttf');font-weight:400}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Medium.ttf');font-weight:500}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Bold.ttf');font-weight:700}
    @font-face{font-family:'Mono';src:url('${FONT_DIR}/JetBrainsMono-Medium.ttf');font-weight:500}
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;font-family:'Inter',sans-serif}
    .stage{width:1920px;height:1080px;position:relative;
      background:radial-gradient(1200px 800px at 22% 18%, #16233a 0%, #0b1220 46%, #070b12 100%);}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,160,220,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,220,.05) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(900px 600px at 30% 30%,#000 0%,transparent 75%)}
    .glow{position:absolute;width:520px;height:520px;border-radius:50%;right:-80px;bottom:-120px;background:radial-gradient(circle,rgba(56,132,255,.18),transparent 60%);filter:blur(8px)}
    .wrap{position:absolute;inset:0;padding:150px 150px;display:flex;flex-direction:column;justify-content:space-between}
    .brand{display:flex;align-items:center;gap:16px}
    .dot{width:14px;height:14px;border-radius:50%;background:#42c9a6;box-shadow:0 0 18px rgba(66,201,166,.8)}
    .brandtxt{font-weight:700;font-size:30px;letter-spacing:.04em;color:#eef2f8}
    .brandsub{font-family:'Mono';font-size:20px;color:#7f93ad;letter-spacing:.14em;text-transform:uppercase;margin-left:6px}
    .center{max-width:1500px}
    .eyebrow{font-family:'Mono';font-size:26px;letter-spacing:.32em;text-transform:uppercase;color:#5aa0ff;margin-bottom:26px}
    .title{font-weight:700;font-size:118px;line-height:1.02;letter-spacing:-.02em;color:#f4f7fb}
    .desc{margin-top:34px;font-size:40px;line-height:1.4;color:#aab8cc;font-weight:400;max-width:1300px}
    .foot{display:flex;align-items:center;justify-content:space-between}
    .accent{height:5px;width:340px;border-radius:4px;background:linear-gradient(90deg,#5aa0ff,#42c9a6)}
    .tag{font-family:'Mono';font-size:24px;color:#6b7f98;letter-spacing:.12em}
    .qf{font-family:'Mono';font-size:24px;color:#8ea3bd;letter-spacing:.10em}
  </style></head><body>
  <div class="stage"><div class="grid"></div><div class="glow"></div>
    <div class="wrap">
      <div class="brand"><span class="dot"></span><span class="brandtxt">Artifex Labs</span><span class="brandsub">Quick-Fix</span></div>
      <div class="center">
        <div class="eyebrow">Evergreen · How Quick-Fix works</div>
        <div class="title">${s.title}</div>
        <div class="desc">${s.descriptor}</div>
      </div>
      <div class="foot"><div class="accent"></div><span class="qf">Fixed scope · Fixed price · Confirmed completion</span><span class="tag">${s.tag} / 09</span></div>
    </div>
  </div></body></html>`;
}

function ffprobe(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,codec_name", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out);
}
function sha256File(f) { return createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16); }

async function main() {
  const only = process.argv[2];
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const manifest = [];
  const keys = only ? [only] : Object.keys(SCOPES);

  for (const key of keys) {
    const s = SCOPES[key];
    const audioPath = path.join(AUDIO_DIR, s.audio);
    if (!existsSync(audioPath)) { console.log(`  ✗ ${key}: audio missing (${s.audio})`); continue; }

    // 1. Branded frame → PNG (poster too)
    await page.setContent(frameHtml(s), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const posterPath = path.join(OUT_DIR, `${key}-v${VERSION}-poster.jpg`);
    await page.screenshot({ path: posterPath, type: "jpeg", quality: 90 });
    const framePng = path.join(OUT_DIR, `.${key}-frame.png`);
    await page.screenshot({ path: framePng, type: "png" });

    // 2. ffmpeg: still frame + narration → MP4 (H.264 yuv420p + AAC, faststart)
    const outMp4 = path.join(OUT_DIR, `${key}-v${VERSION}.mp4`);
    execFileSync("ffmpeg", ["-y", "-loop", "1", "-i", framePng, "-i", audioPath,
      "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "25",
      "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", outMp4], { stdio: "ignore" });
    fs.rmSync(framePng, { force: true });

    // 3. QA
    const probe = ffprobe(outMp4);
    const v = (probe.streams || []).find((x) => x.codec_type === "video");
    const a = (probe.streams || []).find((x) => x.codec_type === "audio");
    const dur = Number(probe.format?.duration || 0);
    const qa = { hasVideo: !!v, res: v ? `${v.width}x${v.height}` : "none", hasAudio: !!a, audioCodec: a?.codec_name, durationSec: Math.round(dur * 10) / 10 };
    const ok = qa.hasVideo && qa.res === "1920x1080" && qa.hasAudio && dur > 30;
    console.log(`  ${ok ? "✓" : "✗"} ${key}: ${qa.res} ${qa.durationSec}s audio=${qa.audioCodec} → public/trust-videos/${key}-v${VERSION}.mp4`);
    manifest.push({ scope: key, title: s.title, file: `/trust-videos/${key}-v${VERSION}.mp4`, poster: `/trust-videos/${key}-v${VERSION}-poster.jpg`, version: VERSION, scriptVersion: SCRIPT_VERSION, durationSeconds: qa.durationSec, audioSha16: sha256File(audioPath), qa, active: ok, createdAt: new Date().toISOString() });
  }
  await browser.close();
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const merged = { generatedWith: "playwright-chromium + ffmpeg (libx264/aac)", scriptVersion: SCRIPT_VERSION, assets: manifest };
  writeFileSync(manifestPath, JSON.stringify(merged, null, 2));
  const okCount = manifest.filter((m) => m.active).length;
  console.log(`\n════════ ${okCount}/${manifest.length} assets QA-passed → ${manifestPath} ════════\n`);
  process.exit(manifest.length && okCount === manifest.length ? 0 : 1);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
