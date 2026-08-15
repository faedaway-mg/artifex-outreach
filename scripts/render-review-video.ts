// ─────────────────────────────────────────────────────────────────────────────
// Review Video renderer (M1.1 — evidence-footage pass). Same architecture as M1, but the prospect's
// REAL business surfaces become the primary visual material: the analyzed HTML is captured (Chrome
// headless, LOCAL file — no live crawl) at desktop + mobile viewports, associated to findings as
// EvidenceAssets, and composited as the scene subject with Artifex type only framing/annotating it.
// Scenes fall back to the M1 abstract composition when no real surface exists (never fabricated).
//
// Output: vertical 1080×1920 SILENT preview + QA frames. Final audio VOICE_REQUIRED (no Lucas). Local,
// PRIVATE_ONLY, no send/publish/deploy.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { buildReviewVideoPlan, buildSrt, type VideoScene } from "../src/lib/content/review-video/plan";
import { sceneLayers, surfaceOverlayLayers, sceneMotion, focalZoompan, PALETTE, FONT, artifactNames, type Layer } from "../src/lib/content/review-video/render";
import { selectSceneSurface, businessSurfaceCoverage, clampFocal, focalCenter, type EvidenceAsset, type FocalRegion } from "../src/lib/content/review-video/assets";

const W = 1080, H = 1920, FPS = 24, MX = 120;
const OUT = "/tmp/review-video-urban-americana";
const TMP = join(OUT, ".frames");
const MARK_SVG = join(OUT, "_mark.svg");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const magick = (args: string[]) => execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const dims = (f: string) => { const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", f]).toString().trim().split(" ").map(Number); return { width: w, height: h }; };

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 32 32"><path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="${PALETTE.ink}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="4" r="2.7" fill="${PALETTE.ink}"/><circle cx="5" cy="27" r="2.4" fill="${PALETTE.ink}"/><circle cx="27" cy="27" r="2.4" fill="${PALETTE.gold}"/></svg>`;

// Neutral, readable rendering of the analyzed HTML (font + spacing only — NOT a reconstructed
// storefront; all text is the real captured content). This is how a browser renders the page legibly.
const CAPTURE_CSS = `<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:56px 60px;color:#161616;background:#ffffff;line-height:1.5}h1{font-size:52px;margin:0 0 6px}h2{font-size:30px;margin:34px 0 14px;color:#333}a{display:inline-block;color:#1a4fa0;font-size:22px;margin:0 18px 12px 0}nav a{color:#111;font-weight:600}p{font-size:20px;color:#444}.promo{display:inline-block;background:#f2efe9;color:#7a5a1e;padding:6px 12px;margin:0 8px 8px 0;font-size:18px;border-radius:4px}</style>`;

function baseCanvas(out: string) {
  magick(["-size", `${W}x${H}`, `gradient:${PALETTE.bgTop}-${PALETTE.bgBot}`,
    "-fill", "#0E1B30", "-draw", "circle 540,760 540,300", "-blur", "0x120",
    "-fill", PALETTE.hair, "-draw", "circle 210,320 210,323", "-draw", "circle 880,470 880,472",
    "-draw", "circle 300,1500 300,1503", "-draw", "circle 820,1620 820,1622", "-draw", "circle 960,1180 960,1182", out]);
}

function renderLayer(canvas: string, l: Layer) {
  if (l.kind === "rule" || l.kind === "focusbox") {
    magick([canvas, "-fill", l.fill ?? PALETTE.gold, "-draw", `rectangle ${l.dx},${l.dy} ${l.dx + (l.w ?? 90)},${l.dy + (l.h ?? 5)}`, canvas]); return;
  }
  if (l.kind === "connector") { // a drawn ↓ (stem + chevron) — font-safe, no glyph dependency
    const x = l.dx, y = l.dy, hh = l.h ?? 40, ww = l.w ?? 18;
    magick([canvas, "-stroke", l.fill ?? PALETTE.gold, "-strokewidth", "4", "-fill", "none",
      "-draw", `line ${x + ww / 2},${y} ${x + ww / 2},${y + hh}`,
      "-draw", `line ${x},${y + hh - 12} ${x + ww / 2},${y + hh}`,
      "-draw", `line ${x + ww},${y + hh - 12} ${x + ww / 2},${y + hh}`, canvas]); return;
  }
  if (l.kind === "mark") {
    const gravity = l.gravity === "Center" ? "Center" : "North";
    magick([canvas, "(", "-background", "none", MARK_SVG, "-resize", `${l.w}x${l.h}`, ")", "-gravity", gravity, "-geometry", `+${l.dx}+${l.dy}`, "-composite", canvas]); return;
  }
  const text = spaced(l.text ?? "", l.tracking ?? 0);
  if (!text.trim()) return;
  const sub = join(TMP, "_layer.png");
  if (l.kind === "caption") {
    magick(["-background", "none", "-fill", l.fill ?? PALETTE.ink, "-font", FONT, "-pointsize", String(l.fontSize ?? 48), "-size", `${l.boxW ?? W - MX * 2}x`, "-gravity", "NorthWest", `caption:${text}`, sub]);
  } else {
    magick(["-background", "none", "-fill", l.fill ?? PALETTE.ink, "-font", FONT, "-pointsize", String(l.fontSize ?? 40), "-gravity", "NorthWest", `label:${text}`, sub]);
  }
  magick([canvas, sub, "-gravity", l.gravity, "-geometry", `+${l.dx}+${l.dy}`, "-composite", canvas]);
}
function spaced(s: string, tracking: number): string { return tracking <= 0 ? s : s.split("").join(" ".repeat(Math.max(1, Math.round(tracking / 2)))); }

// Crop a capture to its focal region, then frame it as the scene subject. Desktop surfaces fit the
// panel WIDTH (a wide site slice); mobile surfaces fit the panel HEIGHT (a tall phone panel). The
// image is never distorted; it is shown as it really is (dims come from the trimmed content capture).
function surfacePanel(asset: EvidenceAsset, out: string) {
  const f = clampFocal(asset.focalRegion);
  const { width: iw, height: ih } = asset.dimensions;
  const cx = Math.round(iw * f.x), cy = Math.round(ih * f.y), cw = Math.round(iw * f.width), ch = Math.round(ih * f.height);
  const cropped = join(TMP, "_crop.png");
  magick([asset.localPath, "-crop", `${cw}x${ch}+${cx}+${cy}`, "+repage", cropped]);
  const panelMaxH = 1000;
  if (asset.type === "mobile-capture") {
    magick([cropped, "-resize", `x${panelMaxH}`, "-bordercolor", PALETTE.hair, "-border", "2", out]); // tall phone panel
  } else {
    // Fit to width 900; if the resulting slice is taller than the panel, keep the top.
    magick([cropped, "-resize", "900x", "-gravity", "North", "-crop", `900x${panelMaxH}>+0+0`, "+repage", "-bordercolor", PALETTE.hair, "-border", "2", out]);
  }
}

function composeSurfaceScene(scene: VideoScene, asset: EvidenceAsset, out: string) {
  baseCanvas(out);
  const panel = join(TMP, "_panel.png");
  surfacePanel(asset, panel);
  // Place the panel as the middle subject; top band (0..420) + bottom band (~1460..) carry the type.
  magick([out, panel, "-gravity", "North", "-geometry", "+0+420", "-composite", out]);
  // A faint gold rule under the panel top-left ties the annotation to the surface.
  for (const layer of surfaceOverlayLayers(scene)) renderLayer(out, layer);
}

function composeAbstractScene(scene: VideoScene, out: string) {
  baseCanvas(out);
  for (const layer of sceneLayers(scene)) renderLayer(out, layer);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(MARK_SVG, MARK);

  // 1) Real generalized Quick Review for Urban Americana.
  const ci = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"]
    .map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s.replace(/-/g, " ")}</a>`).join("");
  const BODY = `<nav><a href="/shop">Shop</a><a href="/collections">Collections</a><a href="/about">About</a><a href="/visit">Visit</a></nav><div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${ci}<a href="/collections/test-old-home">test-old-home</a><p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p>`;
  const HTML = `<!doctype html><html><head><title>Urban Americana — Vintage Marketplace, Long Beach</title></head><body>${BODY}</body></html>`;
  const lead = makeLead({ id: "lead_urban_americana", businessName: "Urban Americana", industry: "Vintage marketplace", normalizedCategory: "furniture-store", city: "Long Beach", state: "CA", website: "https://urbanamericana.com/?utm_source=artifex", websiteDomain: "urbanamericana.com", rating: 4.8, reviewCount: 950, publicEmail: null });
  const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
  const review = buildQuickReview(lead, bi.businessProfile, null, { approved: false });
  const plan = buildReviewVideoPlan(review, { reviewId: "rv_urban_americana_m11", leadId: lead.id, targetSeconds: 60 });
  const A: Record<string, string> = { ...artifactNames(), preview: "review-video-visual-preview-m1.1.mp4" };

  // 2) Capture the ANALYZED HTML (local file, no network) at desktop + mobile viewports.
  const capHtml = join(TMP, "_capture.html");
  writeFileSync(capHtml, `<!doctype html><html><head><meta charset="utf-8">${CAPTURE_CSS}</head><body>${BODY}</body></html>`);
  const desktopPng = join(OUT, "surface-desktop.png"), mobilePng = join(OUT, "surface-mobile.png");
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${desktopPng}`, "--window-size=1180,1400", `file://${capHtml}`], { stdio: "ignore" });
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${mobilePng}`, "--window-size=430,1400", `file://${capHtml}`], { stdio: "ignore" });
  // Trim the surrounding whitespace so the capture is content-tight → focal fractions map to real content.
  const hasDesktop = existsSync(desktopPng), hasMobile = existsSync(mobilePng);
  if (hasDesktop) magick([desktopPng, "-fuzz", "6%", "-trim", "+repage", desktopPng]);
  if (hasMobile) magick([mobilePng, "-fuzz", "6%", "-trim", "+repage", mobilePng]);

  // 3) Evidence assets — associate captures to findings, with generalized focal-region metadata.
  const findingTopics = review.findings.map((f) => f.topic as string);
  const idxOf = (t: string) => findingTopics.indexOf(t);
  const assets: EvidenceAsset[] = [];
  const asset = (type: EvidenceAsset["type"], path: string, findingId: string | null, focal: FocalRegion | null): EvidenceAsset =>
    ({ assetId: `${type}-${findingId ?? "site"}`, reviewId: plan.reviewId, businessId: lead.id, findingId, type, sourceUrl: "https://urbanamericana.com", localPath: path, dimensions: dims(path), focalRegion: focal, rightsState: "PRIVATE_ONLY", provenance: "chrome-headless capture of analyzed HTML (local)" });
  if (hasDesktop) {
    assets.push(asset("desktop-capture", desktopPng, null, { x: 0, y: 0, width: 1, height: 0.5 })); // site header for the opening
    const catI = idxOf("catalog"); if (catI >= 0) assets.push(asset("desktop-capture", desktopPng, review.findings[catI].id, { x: 0, y: 0.32, width: 1, height: 0.6 })); // the collections list
  }
  if (hasMobile) { const mI = idxOf("mobile"); if (mI >= 0) assets.push(asset("mobile-capture", mobilePng, review.findings[mI].id, { x: 0, y: 0, width: 1, height: 0.6 })); }

  // 4) Provisional timing + artifacts.
  const durs = plan.scenes.map((s) => Math.max(2.2, s.provisionalSec));
  const timings = cumulative(durs);
  const coverage = businessSurfaceCoverage(plan, durs, assets);
  writeFileSync(join(OUT, A.plan), JSON.stringify({ ...plan, provisionalTotalSeconds: round2(timings.at(-1)!.endSec) }, null, 2));
  writeFileSync(join(OUT, A.narration), plan.narration.copyBlock + "\n");
  const segTimings = plan.narration.segments.map((seg) => { const sc = plan.scenes.findIndex((s) => s.segmentId === seg.id); return timings[sc] ?? { startSec: 0, endSec: 0 }; });
  writeFileSync(join(OUT, A.captions), buildSrt(plan.narration.segments, segTimings));
  writeFileSync(join(OUT, A.assets), JSON.stringify({ reviewId: plan.reviewId, businessId: plan.businessId, businessName: plan.businessName, rightsState: plan.rightsState, coverage, assets }, null, 2));

  // 5) Render scenes — prefer a real surface; fall back to the abstract Artifex composition.
  const clips: string[] = [];
  const sceneMeta: Array<{ id: string; type: string; surface: string | null }> = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    const findingId = scene.id.startsWith("finding-") ? plan.provenance.findingIds[Number(scene.id.slice(-2)) - 1] ?? null : null;
    const surface = selectSceneSurface(scene, findingId, plan.businessId, assets);
    const png = join(TMP, `scene-${i}.png`);
    if (surface) composeSurfaceScene(scene, surface, png); else composeAbstractScene(scene, png);
    sceneMeta.push({ id: scene.id, type: scene.type, surface: surface ? surface.assetId : null });

    const clip = join(TMP, `clip-${i}.mp4`);
    const d = durs[i], frames = Math.round(d * FPS);
    const m = sceneMotion(scene.type);
    let zx: { z: string; x: string; y: string };
    if (surface) { const { cx, cy } = focalCenter(surface.focalRegion); zx = focalZoompan(cx, cy, 1.0, 1.06, frames, W, H); }
    else { const z = m.zoomFrom === m.zoomTo ? String(m.zoomFrom) : `${m.zoomFrom}+(${(m.zoomTo - m.zoomFrom).toFixed(4)})*on/${frames}`; zx = { z, x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }; }
    const fadeOut = Math.max(0, d - 0.4).toFixed(2);
    ff(["-loop", "1", "-i", png, "-t", String(d), "-r", String(FPS),
      "-vf", `scale=${W}:${H},zoompan=z='${zx.z}':x='${zx.x}':y='${zx.y}':d=1:s=${W}x${H}:fps=${FPS},fade=t=in:d=0.4,fade=t=out:st=${fadeOut}:d=0.4,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", clip]);
    clips.push(clip);
  }

  // 6) Concat → silent preview + QA frames.
  const list = join(TMP, "concat.txt"); writeFileSync(list, clips.map((c) => `file '${c}'`).join("\n") + "\n");
  const preview = join(OUT, A.preview); ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", preview]);
  const qa: Record<string, string> = {};
  const qaMap: Array<[string, string]> = [["qa-opening", "opening"], ["qa-mobile", "finding-01"], ["qa-catalog", "finding-02"], ["qa-proof", "finding-03"], ["qa-start", "starting-point"]];
  for (const [name, sceneId] of qaMap) {
    const si = plan.scenes.findIndex((s) => s.id === sceneId); if (si < 0) continue;
    const mid = round2(timings[si].startSec + (durs[si] / 2));
    const p = join(OUT, `${name}.png`); ff(["-ss", String(mid), "-i", preview, "-frames:v", "1", p]); qa[name] = p;
  }

  console.log(JSON.stringify({
    status: review.status, openingHook: plan.openingHook,
    scenes: sceneMeta.map((s) => `${s.id}:${s.type}${s.surface ? " [surface]" : ""}`),
    captures: { desktop: hasDesktop, mobile: hasMobile },
    coverage, previewSeconds: round2(probe(preview)), previewPath: preview,
    final: "VOICE_REQUIRED — real Lucas MP3 needed for a sendable final render.",
    qaFrames: qa, artifacts: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, join(OUT, v)])),
  }, null, 2));
}

function cumulative(durs: number[]) { const out: Array<{ startSec: number; endSec: number }> = []; let c = 0; for (const d of durs) { out.push({ startSec: round2(c), endSec: round2(c + d) }); c += d; } return out; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
main().catch((e) => { console.error(e); process.exit(1); });
