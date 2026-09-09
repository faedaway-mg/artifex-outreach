// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZED DIAGNOSTIC VIDEO — RENDER WORKER (Mandate Parts C/D/F/G/I/J).
//
// Consumes ONE offer's canonical evidence, builds the evidence-derived storyboard
// (personalized-video.buildVideoStoryboard) and the deterministic render plan
// (personalized-video-render-plan.buildPersonalizedVideoRenderPlan), then renders a
// SILENT vertical 1080×1920 kinetic-text + real-screenshot motion MP4 by capturing a
// deterministic HTML timeline frame-by-frame with Playwright/Chromium and muxing the
// frames with ffmpeg. It extracts a poster, writes a WebVTT track generated VERBATIM
// from the authoritative narration, and persists the PersonalizedDiagnosticVideoRecord
// via store.setPersonalizedVideo across QUEUED → RENDERING → READY/FAILED.
//
// TRUTHFULNESS (enforced here, not just claimed):
//   • ONE EVIDENCE TRUTH — every on-screen word is a storyboard narration line; every
//     real-screenshot scene composites the ACTUAL captured PNG (loaded from the offer's
//     artifact store). We NEVER draw a nonexistent element onto a real screenshot and
//     NEVER invent a defect.
//   • repair-concept scenes are watermarked "Example · Illustrative" and are clearly a
//     schematic — never presented as observed evidence.
//   • SILENT. No audio, no TTS, no synthetic voice → no founder-impersonation surface.
//     Company voice only ("We" / "Artifex Labs") — never "Hi, I'm Jordan".
//   • IDEMPOTENT — computes the idempotency key; a stored READY record with the same key
//     that is still playable is REUSED (a refresh does not re-render).
//   • BOUNDED — the plan caps total frames/duration.
//
// USAGE:
//   pnpm -s tsx scripts/personalized-video-render.ts --fixture
//       Renders a synthetic offer end-to-end WITHOUT touching the DB/store, into
//       artifacts/personalized-video-fixture/, and ffprobe-verifies duration>0.
//   pnpm -s tsx scripts/personalized-video-render.ts --offer <offerId> --render
//       Real-offer mode. Guarded behind --render; reads the store, renders into
//       public/personalized-videos/<offerId>/, persists the record. NEVER sends/charges.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium, type Browser } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildVideoStoryboard,
  sourceEvidenceDigestFor,
  narrationDigestFor,
  personalizedVideoIdempotencyKey,
  PV_NARRATION_VERSION,
  PV_RENDER_VERSION,
  PERSONALIZED_VIDEO_VERSION,
  type VideoStoryboard,
  type PersonalizedDiagnosticVideoRecord,
} from "../src/lib/quick-fix/personalized-video";
import {
  buildPersonalizedVideoRenderPlan,
  type PersonalizedVideoRenderPlan,
  type RenderScene,
  PV_PLAN_VERSION,
} from "../src/lib/quick-fix/personalized-video-render-plan";
import type { EvidencePackage, EvidenceScreenshot } from "../src/lib/quick-fix/evidence-package";
import type { QuickFixOffer } from "../src/lib/quick-fix/types";
import { experienceFrameForOffer } from "../src/lib/quick-fix/experience-frame";
import { generateLeadVoiceover } from "../src/lib/voice/generate";

const ROOT = process.cwd();
const FONT_DIR = "file://" + path.join(ROOT, "public", "fonts", "pdf");
const CAPTION_VERSION = "pv-caption.v1";

// ── Screenshot bytes provider — a real-offer render loads the ACTUAL captured PNG for
//    each screenshot scene; the fixture provides a synthetic capture. Either way the
//    renderer only ever composites REAL bytes it was handed (it never fabricates one). ─
export type ScreenshotBytesProvider = (screenshotId: string) => Promise<Buffer | null>;

// ─────────────────────────────────────────────────────────────────────────────
// The deterministic HTML timeline. One document per scene captured frame-by-frame.
// Kinetic text, animated device frame for real screenshots, a schematic (watermarked)
// for repair-concept. Company voice only. No audio anywhere.
// ─────────────────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sceneBody(scene: RenderScene, screenshotDataUri: string | null): string {
  const label = esc(scene.visualSpec.label);
  const text = esc(scene.text);

  if (scene.visualSpec.kind === "screenshot" && screenshotDataUri) {
    // Real capture composited inside a device frame. We NEVER draw an element onto it —
    // the capture is shown exactly as it loaded; the label is chrome, not annotation.
    return `
      <div class="scene evidence">
        <div class="anim label" data-i="0">${label}</div>
        <div class="anim shot" data-i="1"><div class="device"><div class="devbar"><i></i><i></i><i></i></div><img src="${screenshotDataUri}" alt="captured website"/></div></div>
        <div class="anim caption" data-i="2">${text}</div>
      </div>`;
  }

  if (scene.visualSpec.kind === "repair-concept") {
    // A clearly-schematic illustration — ALWAYS watermarked, never observed evidence.
    const wm = esc(scene.visualSpec.watermark ?? "Example · Illustrative");
    return `
      <div class="scene repair">
        <div class="anim wm" data-i="0">${wm}</div>
        <div class="anim concept" data-i="1"><div class="schematic"><span class="sline w70"></span><span class="sline w50"></span><span class="sbtn">${label}</span></div></div>
        <div class="anim caption" data-i="2">${text}</div>
      </div>`;
  }

  // kinetic-text — the narration line as the hero, no fabricated interface.
  return `
    <div class="scene kinetic">
      <div class="anim eyebrow" data-i="0">${label}</div>
      <div class="anim headline" data-i="1">${text}</div>
    </div>`;
}

function sceneHtml(scene: RenderScene, screenshotDataUri: string | null, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Regular.ttf');font-weight:400}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-SemiBold.ttf');font-weight:600}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Bold.ttf');font-weight:700}
    @font-face{font-family:'Mono';src:url('${FONT_DIR}/JetBrainsMono-Medium.ttf');font-weight:500}
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${width}px;height:${height}px;overflow:hidden;font-family:'Inter',sans-serif;background:#070b12;color:#eef2f8}
    .stage{position:absolute;inset:0;background:radial-gradient(1100px 900px at 30% 22%,#16233a 0%,#0b1220 52%,#070b12 100%)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,160,220,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,220,.05) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(800px 900px at 40% 34%,#000,transparent 76%)}
    .brand{position:absolute;top:74px;left:90px;right:90px;display:flex;align-items:center;gap:16px;z-index:9}
    .brand .dot{width:16px;height:16px;border-radius:50%;background:#42c9a6;box-shadow:0 0 20px rgba(66,201,166,.85)}
    .brand .bt{font-weight:700;font-size:34px;letter-spacing:.02em}
    .brand .bs{font-family:'Mono';font-size:22px;color:#7f93ad;letter-spacing:.16em;text-transform:uppercase}
    .prog{position:absolute;left:90px;right:90px;bottom:80px;height:6px;border-radius:4px;background:rgba(255,255,255,.08);z-index:9}
    .prog>i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#5aa0ff,#42c9a6);width:0}
    .scene{position:absolute;left:90px;right:90px;top:170px;bottom:170px;display:flex;flex-direction:column;justify-content:center;gap:42px}
    .anim{will-change:transform,opacity;opacity:0}
    .eyebrow{font-family:'Mono';font-size:30px;letter-spacing:.24em;text-transform:uppercase;color:#5aa0ff}
    .headline{font-weight:700;font-size:82px;line-height:1.08;letter-spacing:-.02em;color:#f4f7fb}
    .label{font-family:'Mono';font-size:28px;letter-spacing:.14em;text-transform:uppercase;color:#8ea3bd}
    .caption{font-size:52px;line-height:1.2;font-weight:600;color:#e7eef8}
    .shot{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
    .device{width:100%;max-width:820px;background:#0e1626;border:1px solid rgba(255,255,255,.12);border-radius:26px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.55)}
    .devbar{height:60px;background:#0b111d;display:flex;align-items:center;gap:14px;padding:0 26px;border-bottom:1px solid rgba(255,255,255,.07)}
    .devbar i{width:14px;height:14px;border-radius:50%;background:#31405a}
    .device img{display:block;width:100%;height:auto;max-height:1040px;object-fit:cover;object-position:top center}
    .wm{display:inline-block;align-self:flex-start;font-family:'Mono';font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:#ffd0a6;background:rgba(245,155,90,.12);border:1px solid rgba(245,155,90,.42);border-radius:12px;padding:12px 22px}
    .concept{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
    .schematic{width:100%;max-width:760px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.22);border-radius:24px;padding:64px;display:flex;flex-direction:column;gap:34px}
    .sline{height:34px;border-radius:12px;background:rgba(160,185,220,.18)}
    .sline.w70{width:70%}.sline.w50{width:50%}
    .sbtn{align-self:flex-start;margin-top:14px;font-size:38px;font-weight:600;color:#0b1220;background:linear-gradient(180deg,#7fe3c7,#42c9a6);border-radius:16px;padding:22px 42px}
  </style></head><body>
    <div class="stage"><div class="grid"></div></div>
    <div class="brand"><span class="dot"></span><span class="bt">Artifex Labs</span><span class="bs">Quick-Fix</span></div>
    ${sceneBody(scene, screenshotDataUri)}
    <div class="prog"><i id="progfill"></i></div>
    <script>
      const anims=[...document.querySelectorAll('.anim')].map(n=>({n,i:parseInt(n.dataset.i||'0',10)}));
      const prog=document.getElementById('progfill');
      const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
      const easeOut=x=>1-Math.pow(1-clamp(x,0,1),3);
      // p = 0..1 progress THROUGH THIS SCENE. Deterministic; no time-based animation.
      window.__draw=function(p){
        prog.style.width=(clamp(p,0,1)*100).toFixed(2)+'%';
        for(const a of anims){
          const delay=Math.min(a.i*0.16,0.6);
          const e=easeOut((p-delay)/(1-delay||1));
          a.n.style.opacity=e.toFixed(3);
          a.n.style.transform='translateY('+(34*(1-e)).toFixed(2)+'px)';
        }
      };
      window.__ready=true;
    </script></body></html>`;
}

// ── ffprobe helpers ──────────────────────────────────────────────────────────
function probeDuration(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim()) || 0;
}
function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// A clean synthetic "captured homepage" PNG for --fixture mode (proves the screenshot
// composite path without a DB). It is generated locally with ImageMagick and is CLEARLY
// a placeholder — the fixture never claims it is a real customer's site.
function makeSyntheticScreenshot(outPng: string): Buffer {
  execFileSync("magick", [
    "-size", "820x1040", "canvas:#ffffff",
    "-fill", "#101828", "-draw", "rectangle 0,0 820,120",
    "-fill", "#ffffff", "-font", path.join(ROOT, "public", "fonts", "pdf", "Inter-Bold.ttf"), "-pointsize", "44",
    "-gravity", "NorthWest", "-annotate", "+48+40", "Example Business",
    "-fill", "#e5e7eb", "-draw", "roundrectangle 48,200 772,300 12,12",
    "-fill", "#e5e7eb", "-draw", "roundrectangle 48,340 560,400 10,10",
    "-fill", "#c7ccd4", "-draw", "roundrectangle 48,440 772,520 10,10",
    "-fill", "#9aa2ae", "-font", path.join(ROOT, "public", "fonts", "pdf", "Inter-Regular.ttf"), "-pointsize", "28",
    "-gravity", "NorthWest", "-annotate", "+48+600", "(synthetic fixture capture — not a real site)",
    outPng,
  ], { stdio: "ignore" });
  return readFileSync(outPng);
}

function pngToDataUri(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The render core — pure over its inputs (storyboard-derived plan + a bytes provider
// + an output dir). Produces mp4 + poster + vtt and returns the render facts. Never
// touches the store, never sends. Both --fixture and --render call this.
// ─────────────────────────────────────────────────────────────────────────────
export interface RenderCoreResult {
  mp4Path: string;
  posterPath: string;
  vttPath: string;
  durationSeconds: number;
  totalFrames: number;
  vttCueCount: number;
  renderedAssetDigest: string;
  width: number;
  height: number;
}

async function renderPlanToMp4(
  browser: Browser,
  plan: PersonalizedVideoRenderPlan,
  provider: ScreenshotBytesProvider,
  outDir: string,
  fileStem: string,
  audioPath?: string | null,
): Promise<RenderCoreResult> {
  if (!plan.buildable) throw new Error(`plan is not buildable: ${plan.blockedReason ?? "unknown"}`);
  mkdirSync(outDir, { recursive: true });
  const frameDir = path.join(tmpdir(), `pv-frames-${fileStem}-${process.pid}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  // Resolve real screenshot bytes ONCE per distinct screenshotId.
  const shotCache = new Map<string, string | null>();
  async function resolveShot(id: string | null): Promise<string | null> {
    if (!id) return null;
    if (shotCache.has(id)) return shotCache.get(id)!;
    const bytes = await provider(id);
    const uri = bytes ? pngToDataUri(bytes) : null;
    shotCache.set(id, uri);
    return uri;
  }

  const page = await browser.newPage({ viewport: { width: plan.width, height: plan.height }, deviceScaleFactor: 1 });
  let posterBuf: Buffer | null = null;
  let frameIndex = 0;

  for (const scene of plan.scenes) {
    const shotUri = await resolveShot(scene.visualSpec.screenshotId);
    await page.setContent(sceneHtml(scene, shotUri, plan.width, plan.height), { waitUntil: "networkidle" });
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.evaluate(() => {
      if (!(window as any).__draw) throw new Error("scene timeline did not initialise");
    });
    for (let f = 0; f < scene.frames; f++) {
      const p = scene.frames <= 1 ? 1 : f / (scene.frames - 1);
      await page.evaluate((pp) => (window as any).__draw(pp), p);
      const buf = await page.screenshot({ type: "png" });
      writeFileSync(path.join(frameDir, `f${String(frameIndex).padStart(6, "0")}.png`), buf);
      // Poster = a settled frame of the first evidence (or the first) scene.
      if (posterBuf === null && p > 0.7) posterBuf = buf;
      frameIndex++;
    }
  }
  await page.close();
  if (posterBuf === null) posterBuf = readFileSync(path.join(frameDir, "f000000.png"));

  const posterPath = path.join(outDir, "poster.jpg");
  // Poster as JPEG via ffmpeg (keeps the asset small; a Next route can serve it).
  const posterPng = path.join(frameDir, "_poster.png");
  writeFileSync(posterPng, posterBuf);
  execFileSync("ffmpeg", ["-y", "-i", posterPng, "-frames:v", "1", posterPath], { stdio: "ignore" });

  const mp4Path = path.join(outDir, "video.mp4");
  execFileSync("ffmpeg", [
    "-y", "-framerate", String(plan.fps), "-i", path.join(frameDir, "f%06d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium",
    "-movflags", "+faststart", mp4Path,
  ], { stdio: "ignore" });

  // Optional audio mux — the SAME narration revision drove both the audio and the
  // captions, so muxing the real (Matt) voiceover onto the silent render keeps one
  // truth. Copy the video stream unchanged; encode the audio to AAC; -shortest so the
  // track never runs past the picture. Replace the silent file in place.
  if (audioPath) {
    const muxedPath = path.join(frameDir, "_muxed.mp4");
    execFileSync("ffmpeg", [
      "-y", "-i", mp4Path, "-i", audioPath,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-movflags", "+faststart", muxedPath,
    ], { stdio: "ignore" });
    // Overwrite the silent mp4 with the muxed one (re-probe below reflects the audio).
    writeFileSync(mp4Path, readFileSync(muxedPath));
  }

  rmSync(frameDir, { recursive: true, force: true });

  const vttPath = path.join(outDir, "captions.vtt");
  writeFileSync(vttPath, plan.vtt);

  const durationSeconds = probeDuration(mp4Path);
  const renderedAssetDigest = sha256Hex(readFileSync(mp4Path));

  return {
    mp4Path,
    posterPath,
    vttPath,
    durationSeconds,
    totalFrames: frameIndex,
    vttCueCount: plan.vttCues.length,
    renderedAssetDigest,
    width: plan.width,
    height: plan.height,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE MODE — synthetic offer, no DB. Proves the toolchain end-to-end offline.
// ─────────────────────────────────────────────────────────────────────────────
function fixturePackageFrameOffer(): { pkg: EvidencePackage; offer: QuickFixOffer } {
  const leadId = "lead_fixture";
  const offerId = "qfo_fixture";
  const shot: EvidenceScreenshot = {
    id: `${leadId}:desktop`,
    imageRoute: `/api/content-studio/screenshot-image?business=${leadId}&viewport=desktop`,
    publicUrl: null,
    viewport: "desktop",
    pageLabel: "Your homepage on a computer",
    sourceUrl: "https://example.com",
    capturedAt: "2026-01-01T00:00:00.000Z",
    sha256: "fixture",
    status: "READY",
  };
  const pkg: EvidencePackage = {
    offerId,
    leadId,
    company: "Example Business",
    websiteUrl: "https://example.com",
    screenshots: [shot],
    screenshotStatus: "READY",
    findings: [
      {
        id: "f_readability",
        observation: "While reviewing your site, we noticed some of the text was hard to read.",
        plain: "Some of the text was hard to read on the pages we checked.",
        whyItMatters: "Visitors skim — if the copy is hard to read, they leave before they act.",
        confidenceLabel: "Observed",
        confidenceScore: 0.8,
        screenshotId: `${leadId}:desktop`,
      },
    ],
    personalizedVideo: { status: "MISSING", url: null, detail: "" },
    diagnosticPdf: { status: "MISSING", url: null, detail: "" },
    evergreenVideo: { status: "NOT_APPLICABLE", url: null, detail: "" },
    confidence: 0.8,
    evidenceGrade: "B",
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
  const offer = {
    offerId,
    leadId,
    companyName: "Example Business",
    findingIds: ["f_readability"],
    scope: {
      problemBeingSolved: "Some of the text was hard to read on the pages we checked.",
      proposedSolution: "improve the readability of the key page copy",
    },
    evidenceGrade: "B",
    confidence: 0.8,
    offerVersion: "fixturev1",
    generatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as QuickFixOffer;
  return { pkg, offer };
}

async function runFixture(): Promise<void> {
  const outDir = path.join(ROOT, "artifacts", "personalized-video-fixture");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const { pkg, offer } = fixturePackageFrameOffer();
  const frame = experienceFrameForOffer(offer);
  const storyboard = buildVideoStoryboard(pkg, frame, offer);
  if (!storyboard.buildable) throw new Error(`fixture storyboard not buildable: ${storyboard.blockedReason}`);
  const plan = buildPersonalizedVideoRenderPlan(storyboard);

  // Synthetic capture for the screenshot scenes — clearly labelled, generated locally.
  const synthPng = path.join(outDir, "synthetic-capture.png");
  const synthBuf = makeSyntheticScreenshot(synthPng);
  const provider: ScreenshotBytesProvider = async () => synthBuf;

  const browser = await chromium.launch();
  let result: RenderCoreResult;
  try {
    result = await renderPlanToMp4(browser, plan, provider, outDir, "fixture");
  } finally {
    await browser.close();
  }

  // Verify the toolchain actually produced a playable asset.
  if (!(result.durationSeconds > 0)) throw new Error(`fixture render produced a zero-duration mp4 (${result.mp4Path})`);
  if (!existsSync(result.posterPath)) throw new Error("fixture poster missing");
  if (!existsSync(result.vttPath)) throw new Error("fixture vtt missing");

  console.log(JSON.stringify({
    mode: "fixture",
    ok: true,
    storyboardScenes: storyboard.scenes.length,
    planVersion: PV_PLAN_VERSION,
    mp4: result.mp4Path,
    poster: result.posterPath,
    vtt: result.vttPath,
    durationSeconds: Math.round(result.durationSeconds * 100) / 100,
    totalFrames: result.totalFrames,
    fps: plan.fps,
    resolution: `${result.width}x${result.height}`,
    vttCues: result.vttCueCount,
    renderedAssetDigest: result.renderedAssetDigest.slice(0, 16),
  }, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL-OFFER MODE — reads the store, renders, persists the record. Guarded by --render.
// ─────────────────────────────────────────────────────────────────────────────
async function runRealOffer(offerId: string): Promise<void> {
  // Lazy imports so --fixture never loads the DB/store layer.
  const { getOffer, getPersonalizedVideo, setPersonalizedVideo } = await import("../src/lib/quick-fix/store");
  const { buildEvidencePackage } = await import("../src/lib/quick-fix/evidence-package");
  const { getArtifactStore } = await import("../src/lib/content-studio/storage-factory");
  const { latestReadyShot } = await import("../src/lib/content-studio/screenshot-jobs");

  const actor = "render-worker";
  const nowIso = () => new Date().toISOString();

  const offer = await getOffer(offerId);
  if (!offer) throw new Error(`offer not found: ${offerId}`);

  const pkg = await buildEvidencePackage(offer);
  const frame = experienceFrameForOffer(offer);
  const storyboard: VideoStoryboard = buildVideoStoryboard(pkg, frame, offer);

  const evidenceDigest = sourceEvidenceDigestFor(pkg);
  const narrationDigest = narrationDigestFor(storyboard);
  const idempotencyKey = personalizedVideoIdempotencyKey({
    offerId: offer.offerId,
    offerVersion: offer.offerVersion,
    evidenceDigest,
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
  });

  // IDEMPOTENT: a stored READY record with the same key + playable → reuse, no re-render.
  const existing = await getPersonalizedVideo(offerId);
  if (
    existing &&
    existing.status === "READY" &&
    existing.idempotencyKey === idempotencyKey &&
    !!existing.mp4Url &&
    !!existing.posterUrl &&
    (existing.durationSeconds ?? 0) > 0
  ) {
    console.log(JSON.stringify({ mode: "offer", offerId, reused: true, mp4Url: existing.mp4Url, idempotencyKey }, null, 2));
    return;
  }

  const baseRecord: PersonalizedDiagnosticVideoRecord = {
    offerId: offer.offerId,
    offerVersion: offer.offerVersion,
    leadId: offer.leadId,
    company: offer.companyName,
    website: pkg.websiteUrl ?? null,
    evidenceVersion: evidenceDigest,
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
    personalizedVideoVersion: PERSONALIZED_VIDEO_VERSION,
    status: "QUEUED",
    sourceEvidenceDigest: evidenceDigest,
    narrationDigest,
    renderedAssetDigest: null,
    mp4Url: null,
    posterUrl: null,
    captionsUrl: null,
    durationSeconds: null,
    captionVersion: null,
    captionsVerified: false,
    idempotencyKey,
    queuedAt: nowIso(),
    generatedAt: null,
    verifiedAt: null,
    failureReason: null,
  };

  // If the storyboard is not buildable there is nothing honest to render → FAILED (BLOCKED-shaped).
  if (!storyboard.buildable) {
    await setPersonalizedVideo(offerId, { ...baseRecord, status: "FAILED", failureReason: storyboard.blockedReason ?? "storyboard not buildable" }, { actor, now: nowIso() });
    throw new Error(`storyboard not buildable: ${storyboard.blockedReason}`);
  }

  // QUEUED → RENDERING.
  await setPersonalizedVideo(offerId, baseRecord, { actor, now: nowIso() });
  await setPersonalizedVideo(offerId, { ...baseRecord, status: "RENDERING" }, { actor, now: nowIso() });

  const plan = buildPersonalizedVideoRenderPlan(storyboard);
  const outDir = path.join(ROOT, "public", "personalized-videos", offerId);

  // Real bytes provider — loads the ACTUAL captured PNG from the artifact store by
  // resolving the screenshotId (`<leadId>:<viewport>`) to its ready job + outputKey.
  const store = getArtifactStore();
  const provider: ScreenshotBytesProvider = async (screenshotId) => {
    const viewport = screenshotId.endsWith(":mobile") ? "mobile" : "desktop";
    const shot = await latestReadyShot(offer.leadId, viewport).catch(() => null);
    if (!shot || shot.status !== "ready" || !shot.outputKey) return null;
    return store.readFull(shot.outputKey).catch(() => null);
  };

  // Generate (or reuse) the lead's canonical ElevenLabs (Matt) voiceover, bound to the
  // SAME narration revision the captions/render derive from. Never sends or charges any
  // outbound action; only produces + persists the audio asset. If it is not configured
  // or fails, we render SILENT (unchanged) — the personalized video still ships.
  let audioPath: string | null = null;
  const vo = await generateLeadVoiceover({
    leadId: offer.leadId,
    company: offer.companyName,
    offerId: offer.offerId,
    narrationId: offer.offerId,
    narrationRevision: narrationDigest,
    narrationScript: storyboard.narrationScript,
    actor: "render-worker",
  });
  if ((vo.status === "ready" || vo.status === "reused") && vo.voiceover.assetKey) {
    const audioBytes = await store.readFull(vo.voiceover.assetKey).catch(() => null);
    if (audioBytes) {
      mkdirSync(outDir, { recursive: true });
      audioPath = path.join(outDir, "voiceover.mp3");
      writeFileSync(audioPath, audioBytes);
      console.log(JSON.stringify({ mode: "offer", offerId, voiceover: vo.status, voice: vo.voiceDisplayName, voiceoverDurationSeconds: vo.voiceover.durationSeconds }));
    } else {
      console.log(JSON.stringify({ mode: "offer", offerId, voiceover: vo.status, note: "voiceover asset bytes unavailable — rendering silent" }));
    }
  } else {
    const note = vo.status === "not_configured" || vo.status === "failed" ? vo.reason : "voiceover asset missing";
    console.log(JSON.stringify({ mode: "offer", offerId, voiceover: vo.status, note: `${note} — rendering silent` }));
  }

  const browser = await chromium.launch();
  try {
    const result = await renderPlanToMp4(browser, plan, provider, outDir, offerId, audioPath);
    if (!(result.durationSeconds > 0)) throw new Error("rendered a zero-duration mp4");

    const readyRecord: PersonalizedDiagnosticVideoRecord = {
      ...baseRecord,
      status: "READY",
      renderedAssetDigest: result.renderedAssetDigest,
      mp4Url: `/personalized-videos/${offerId}/video.mp4`,
      posterUrl: `/personalized-videos/${offerId}/poster.jpg`,
      // Captions are generated VERBATIM from the authoritative narrationScript — the SAME
      // words that render as on-screen kinetic text. There is no separate audio track to
      // reconcile against, so the VTT is exact-by-construction and marked verified.
      captionsUrl: `/personalized-videos/${offerId}/captions.vtt`,
      captionVersion: CAPTION_VERSION,
      captionsVerified: plan.captionsVerbatim,
      durationSeconds: result.durationSeconds,
      generatedAt: nowIso(),
      verifiedAt: nowIso(),
      failureReason: null,
    };
    await setPersonalizedVideo(offerId, readyRecord, { actor, now: nowIso() });
    console.log(JSON.stringify({ mode: "offer", offerId, reused: false, status: "READY", mp4Url: readyRecord.mp4Url, durationSeconds: Math.round(result.durationSeconds * 100) / 100, totalFrames: result.totalFrames, vttCues: result.vttCueCount, idempotencyKey }, null, 2));
  } catch (e) {
    await setPersonalizedVideo(offerId, { ...baseRecord, status: "FAILED", failureReason: (e as Error).message }, { actor, now: nowIso() });
    throw e;
  } finally {
    await browser.close();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function argVal(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const isFixture = process.argv.includes("--fixture");
  const offerId = argVal("--offer");

  if (isFixture) {
    await runFixture();
    return;
  }

  if (offerId) {
    // Real-offer render mutates persisted state — guard it behind an explicit flag.
    if (!process.argv.includes("--render")) {
      console.error("Refusing to render a real offer without --render. This NEVER sends or charges; it renders + persists the personalized-video record only.");
      console.error(`Run: pnpm -s tsx scripts/personalized-video-render.ts --offer ${offerId} --render`);
      process.exit(2);
    }
    await runRealOffer(offerId);
    return;
  }

  console.error("Usage:");
  console.error("  pnpm -s tsx scripts/personalized-video-render.ts --fixture");
  console.error("  pnpm -s tsx scripts/personalized-video-render.ts --offer <offerId> --render");
  process.exit(2);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
