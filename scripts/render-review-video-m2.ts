// ─────────────────────────────────────────────────────────────────────────────
// Review Video renderer (M2 — content-grade). ONE renderer for both the CLI and the batch queue: the
// pure render(t) in review-scene.html driven frame-by-frame over CDP, muxed by ffmpeg. The render CORE
// (renderReviewVideoCore) is JOB-DRIVEN — it takes a lead identity + canonical Quick Review + the
// persisted SANITIZED surface HTML (no re-crawl) + output dir + optional Lucas audio, and produces the
// visual preview (mode "visual") or the audio-master final (mode "final"). The CLI's main() is just one
// caller (the Urban Americana canonical fixture); the queue's render-core is another. No fixture
// assumptions live in the core. Local, PRIVATE_ONLY, no send/publish/deploy.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import type { QuickReview } from "../src/lib/outreach/quick-review";
import { buildReviewVideoPlan } from "../src/lib/content/review-video/plan";
import { buildSchedule, totalDuration } from "../src/lib/content/review-video/motion";
import { buildScenePlan, type PageSurface } from "../src/lib/content/review-video/scene-plan";
import { selectSceneSurface, focalCenter, businessSurfaceCoverage, type EvidenceAsset, type FocalRegion } from "../src/lib/content/review-video/assets";
import { planFraming, type FramingMode, type Rect } from "../src/lib/content/review-video/framing";
import { deriveSoundEvents, sfxRecipe } from "../src/lib/content/review-video/sound";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1080, H = 1920, FPS = 24;
const SCENE = `file://${join(ROOT, "public", "content", "review-video", "review-scene.html")}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const magick = (a: string[]) => execFileSync("magick", a, { stdio: ["ignore", "ignore", "inherit"] });
const ff = (a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: ["ignore", "ignore", "inherit"] });
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const dims = (f: string) => { const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", f]).toString().trim().split(" ").map(Number); return { width: w, height: h }; };

const CAPTURE_CSS = `<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:56px 60px;color:#161616;background:#fff;line-height:1.5}h1{font-size:52px;margin:0 0 6px}h2{font-size:30px;margin:34px 0 14px;color:#333}a{display:inline-block;color:#1a4fa0;font-size:22px;margin:0 18px 12px 0}nav a{color:#111;font-weight:600}p{font-size:20px;color:#444}.promo{display:inline-block;background:#f2efe9;color:#7a5a1e;padding:6px 12px;margin:0 8px 8px 0;font-size:18px;border-radius:4px}</style>`;

// ── The job-driven render core — the ONE renderer the CLI + queue share. ────────────────────────────
export type RenderCoreErrorKind = "SURFACE_PACKAGE_MISSING" | "INVALID_SNAPSHOT" | "INVALID_PLAN" | "CHROME_FAILED" | "AUDIO_MISSING" | "MUX_FAILED" | "UNKNOWN";
export interface RenderCoreInput {
  leadId: string;
  businessName: string;
  review: QuickReview;
  /** Sanitized analyzed surface body HTML (from the persisted package). Null → text-only fallback. */
  bodyHtml: string | null;
  reviewId: string;
  mode: "visual" | "final";
  audioPath?: string | null;   // required for mode "final"
  outDir: string;
  sourceUrl?: string | null;
  targetSeconds?: number;
  /** CDP debug port (unique per concurrent render to avoid collisions). */
  port?: number;
}
export interface RenderCoreResult {
  success: boolean; mode: "visual" | "final"; leadId: string; reviewId: string;
  previewPath?: string; finalPath?: string; sfxPath?: string;
  durationSeconds?: number; width?: number; height?: number; fileSizeBytes?: number; framesRendered?: number;
  surfaceCoverage?: number; renderMs: number; error?: string; errorKind?: RenderCoreErrorKind;
}

export async function renderReviewVideoCore(input: RenderCoreInput): Promise<RenderCoreResult> {
  const t0 = Date.now();
  const { review, mode, outDir } = input;
  const port = input.port ?? 9247;
  const fail = (errorKind: RenderCoreErrorKind, error: string): RenderCoreResult => ({ success: false, mode, leadId: input.leadId, reviewId: input.reviewId, renderMs: Date.now() - t0, error, errorKind });
  try {
    if (mode === "final" && !(input.audioPath && existsSync(input.audioPath))) return fail("AUDIO_MISSING", "final render requires an existing Lucas audio file");
    if (!review || !review.findings?.length) return fail("INVALID_PLAN", "review has no findings to render");
    const TMP = join(outDir, ".frames");
    rmSync(outDir, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });

    // 1) Canonical plan from the provided review (no analysis here — pure projection).
    const plan = buildReviewVideoPlan(review, { reviewId: input.reviewId, leadId: input.leadId, targetSeconds: input.targetSeconds ?? 62 });

    // 2) Capture the SANITIZED analyzed surface (local, no crawl). No body → no surfaces (text fallback).
    let hasDesktop = false, hasMobile = false;
    const desktopPng = join(outDir, "surface-desktop.png"), mobilePng = join(outDir, "surface-mobile.png");
    if (input.bodyHtml && input.bodyHtml.trim()) {
      const capHtml = join(TMP, "_capture.html");
      writeFileSync(capHtml, `<!doctype html><html><head><meta charset="utf-8">${CAPTURE_CSS}</head><body>${input.bodyHtml}</body></html>`);
      try {
        execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${desktopPng}`, "--window-size=1180,1400", `file://${capHtml}`], { stdio: "ignore" });
        execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${mobilePng}`, "--window-size=430,1400", `file://${capHtml}`], { stdio: "ignore" });
      } catch (e) { return fail("CHROME_FAILED", `surface capture failed: ${(e as Error).message}`); }
      hasDesktop = existsSync(desktopPng); hasMobile = existsSync(mobilePng);
      if (hasDesktop) magick([desktopPng, "-fuzz", "6%", "-trim", "+repage", desktopPng]);
      if (hasMobile) magick([mobilePng, "-fuzz", "6%", "-trim", "+repage", mobilePng]);
    }

    // 3) Evidence assets + surface resolution per scene (role-driven framing — unchanged M2.1/M2.2).
    const topics = review.findings.map((f) => f.topic as string);
    const sourceUrl = input.sourceUrl ?? review.website ?? null;
    const assets: EvidenceAsset[] = [];
    const A = (type: EvidenceAsset["type"], path: string, findingId: string | null, focal: FocalRegion | null): EvidenceAsset => ({ assetId: `${type}-${findingId ?? "site"}`, reviewId: plan.reviewId, businessId: input.leadId, findingId, type, sourceUrl, localPath: path, dimensions: dims(path), focalRegion: focal, rightsState: "PRIVATE_ONLY", provenance: "chrome-headless capture of persisted sanitized surface (local, no crawl)" });
    if (hasDesktop) { assets.push(A("desktop-capture", desktopPng, null, { x: 0, y: 0, width: 1, height: 0.55 })); const ci2 = topics.indexOf("catalog"); if (ci2 >= 0) assets.push(A("desktop-capture", desktopPng, review.findings[ci2].id, { x: 0, y: 0.3, width: 1, height: 0.6 })); }
    if (hasMobile) { const mi = topics.indexOf("mobile"); if (mi >= 0) assets.push(A("mobile-capture", mobilePng, review.findings[mi].id, { x: 0, y: 0, width: 1, height: 0.6 })); }

    const modeFor = (type: string): FramingMode => (type === "STRUCTURE" || type === "STAT_REVEAL" || type === "MOBILE_VIEW" || type === "TEXT") ? "EVIDENCE_FRAME" : "CINEMATIC_CROP";
    const EVIDENCE_BOUNDS: Rect = { x: 0, y: 0, width: 1, height: 0.95 };
    const surfaces: Record<string, PageSurface> = {};
    plan.scenes.forEach((s) => {
      const fid = s.id.startsWith("finding-") ? plan.provenance.findingIds[Number(s.id.slice(-2)) - 1] ?? null : null;
      const sel = selectSceneSurface(s, fid, input.leadId, assets);
      if (!sel) return;
      const fmode = modeFor(s.type);
      const focal: Rect | null = sel.focalRegion ? { x: sel.focalRegion.x, y: sel.focalRegion.y, width: sel.focalRegion.width, height: sel.focalRegion.height } : null;
      const fr = planFraming(fmode, focal, fmode === "EVIDENCE_FRAME" ? EVIDENCE_BOUNDS : null);
      const treatment = fmode === "EVIDENCE_FRAME" ? "EVIDENCE_SURFACE" : s.type === "COMPARISON" ? "BACKGROUND_SURFACE" : "ATMOSPHERIC_SURFACE";
      surfaces[s.id] = { src: `file://${sel.localPath}`, kind: sel.type === "mobile-capture" ? "mobile" : "desktop", focalY: focalCenter(sel.focalRegion).cy, mode: fr.mode, scaleStart: fr.scaleStart, scaleEnd: fr.scaleEnd, focusStart: fr.focusStart, originX: fr.originX, originY: fr.originY, treatment };
    });

    // 4) Timeline — provisional (visual) or audio-master (final).
    const audioDur = mode === "final" ? probe(input.audioPath!) : null;
    let durs = plan.scenes.map((s) => Math.max(2.6, s.provisionalSec));
    if (audioDur) {
      const CLOSE_TAIL = 2.4;
      const shareTotal = plan.scenes.filter((s) => s.type !== "CLOSE").reduce((a, s) => a + Math.max(2.6, s.provisionalSec), 0) || 1;
      durs = plan.scenes.map((s) => s.type === "CLOSE" ? CLOSE_TAIL : (Math.max(2.6, s.provisionalSec) / shareTotal) * audioDur);
    }
    const schedule = buildSchedule(plan.scenes.map((s) => s.id), durs);
    const total = totalDuration(schedule);
    const pagePlan = buildScenePlan(review, plan, schedule, surfaces);
    const coverage = businessSurfaceCoverage(plan, durs, assets);
    if (!pagePlan.scenes.length) return fail("INVALID_PLAN", "empty scene plan");

    // 5) Intermediate artifacts.
    writeFileSync(join(outDir, "review-video-plan.json"), JSON.stringify({ ...plan, schedule }, null, 2));
    writeFileSync(join(outDir, "review-video-page-plan.json"), JSON.stringify(pagePlan, null, 2));
    writeFileSync(join(outDir, "review-video-narration.txt"), plan.narration.copyBlock + "\n");
    writeFileSync(join(outDir, "review-video-assets.json"), JSON.stringify({ reviewId: plan.reviewId, businessId: plan.businessId, rightsState: plan.rightsState, coverage, assets }, null, 2));

    // 6) Drive review-scene.html frame-by-frame over CDP.
    const userDataDir = join(TMP, "_cr");
    const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, "--force-device-scale-factor=1", `--window-size=${W},${H}`, `${SCENE}?t=0`], { stdio: "ignore" });
    let framesRendered = 0;
    try {
      let wsUrl = "";
      for (let i = 0; i < 120 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url?: string; webSocketDebuggerUrl: string }>; const p = l.find((x) => x.type === "page" && (x.url || "").includes("review-scene.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch { /* not up yet */ } }
      if (!wsUrl) return fail("CHROME_FAILED", "no CDP page (Chrome did not start)");
      const ws: any = new WebSocket(wsUrl); const pend = new Map<number, (m: any) => void>(); let sq = 0;
      await new Promise<void>((res) => { ws.onopen = () => res(); });
      ws.onmessage = (e: any) => { const m = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)!(m); pend.delete(m.id); } };
      const c2 = (method: string, params: any = {}) => new Promise<any>((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
      await c2("Page.enable"); await c2("Runtime.enable");
      for (let i = 0; i < 100; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete' && typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
      await c2("Runtime.evaluate", { expression: `window.PLAN=${JSON.stringify(pagePlan)}; window.init(); true`, returnByValue: true });
      const N = Math.ceil(total * FPS);
      for (let i = 0; i < N; i++) {
        await c2("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
        const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, captureBeyondViewport: false });
        writeFileSync(join(TMP, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
      }
      ws.close();
      framesRendered = readdirSync(TMP).filter((f) => f.endsWith(".png") && f.startsWith("f_")).length;
      if (framesRendered < N) return fail("CHROME_FAILED", `missing frames (${framesRendered}/${N})`);
    } catch (e) { return fail("CHROME_FAILED", `CDP render failed: ${(e as Error).message}`); } finally { try { chrome.kill(); } catch { /* */ } }

    // 7) Assemble the silent (audio-master when final) video.
    const preview = join(outDir, mode === "final" ? "review-video-final-silent.mp4" : "review-video-visual-preview.mp4");
    ff(["-framerate", String(FPS), "-i", join(TMP, "f_%05d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", preview]);

    if (mode === "visual") {
      return { success: true, mode, leadId: input.leadId, reviewId: input.reviewId, previewPath: preview, durationSeconds: round2(probe(preview)), width: W, height: H, fileSizeBytes: statSync(preview).size, framesRendered, surfaceCoverage: coverage.fraction, renderMs: Date.now() - t0 };
    }

    // 8) Final: synthesized SFX bed mixed UNDER Lucas (voice dominant, limited), muxed onto the video.
    const events = deriveSoundEvents(pagePlan.scenes, schedule);
    const sfxPath = join(outDir, "review-video-sfx.wav");
    try {
      const clips: string[] = [];
      events.forEach((e, i) => { const r = sfxRecipe(e.type); const clip = join(TMP, `sfx_${i}.wav`); ff(["-f", "lavfi", "-i", r.src, "-af", `${r.filter},volume=${e.gain.toFixed(3)}`, "-ar", "44100", "-ac", "1", clip]); clips.push(clip); });
      if (events.length) {
        const inputs: string[] = []; events.forEach((_, i) => inputs.push("-i", clips[i]));
        const delays = events.map((e, i) => `[${i}:a]adelay=${Math.round(e.at * 1000)}:all=1[d${i}]`).join(";");
        const mix = events.map((_, i) => `[d${i}]`).join("") + `amix=inputs=${events.length}:normalize=0:duration=longest,apad,atrim=0:${total.toFixed(3)}[sfx]`;
        ff([...inputs, "-filter_complex", `${delays};${mix}`, "-map", "[sfx]", "-ar", "44100", "-ac", "1", sfxPath]);
      } else { ff(["-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`, "-t", total.toFixed(3), sfxPath]); }
      const finalPath = join(outDir, "review-video-final.mp4");
      ff(["-i", preview, "-i", input.audioPath!, "-i", sfxPath, "-filter_complex", "[1:a]aformat=channel_layouts=mono[v];[2:a]aformat=channel_layouts=mono[s];[v][s]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95:level=disabled[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", finalPath]);
      return { success: true, mode, leadId: input.leadId, reviewId: input.reviewId, finalPath, sfxPath, previewPath: preview, durationSeconds: round2(probe(finalPath)), width: W, height: H, fileSizeBytes: statSync(finalPath).size, framesRendered, surfaceCoverage: coverage.fraction, renderMs: Date.now() - t0 };
    } catch (e) { return fail("MUX_FAILED", `final mux failed: ${(e as Error).message}`); }
  } catch (e) { return fail("UNKNOWN", (e as Error).message); }
}

// ── CLI: the Urban Americana canonical fixture is just ONE caller of the core. ─────────────────────
async function main() {
  const ci = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"].map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s.replace(/-/g, " ")}</a>`).join("");
  const BODY = `<nav><a href="/shop">Shop</a><a href="/collections">Collections</a><a href="/about">About</a><a href="/visit">Visit</a></nav><div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${ci}<a href="/collections/test-old-home">test-old-home</a><p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p>`;
  const HTML = `<!doctype html><html><head><title>Urban Americana — Vintage Marketplace, Long Beach</title></head><body>${BODY}</body></html>`;
  const lead = makeLead({ id: "lead_urban_americana", businessName: "Urban Americana", industry: "Vintage marketplace", normalizedCategory: "furniture-store", city: "Long Beach", state: "CA", website: "https://urbanamericana.com/?utm_source=artifex", websiteDomain: "urbanamericana.com", rating: 4.8, reviewCount: 950, publicEmail: null });
  const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
  const review = buildQuickReview(lead, bi.businessProfile, null, { approved: false });
  const audioArg = process.argv.includes("--audio") ? process.argv[process.argv.indexOf("--audio") + 1] : null;
  const outDir = "/tmp/review-video-urban-americana-m2";
  const res = await renderReviewVideoCore({ leadId: lead.id, businessName: lead.businessName, review, bodyHtml: BODY, reviewId: "rv_urban_americana_m2", mode: audioArg ? "final" : "visual", audioPath: audioArg, outDir, sourceUrl: "https://urbanamericana.com" });
  console.log(JSON.stringify(res, null, 2));
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Run main() only when invoked directly as a CLI (not when imported by the queue/render-core).
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
