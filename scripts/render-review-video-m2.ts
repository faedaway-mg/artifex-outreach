// ─────────────────────────────────────────────────────────────────────────────
// Review Video renderer (M2 — content-grade). Same motion engine as the Artifex Field Note videos: a
// pure render(t) in review-scene.html driven frame-by-frame over the Chrome DevTools Protocol, then
// muxed by ffmpeg. Real prospect surfaces (captured from the analyzed HTML, LOCAL, no crawl) are B-roll
// inside a centered editorial composition on the living-constellation background. Final = VOICE_REQUIRED
// (no Lucas). Local, PRIVATE_ONLY, no send/publish/deploy.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBusiness } from "../src/lib/intelligence/engine";
import { makeLead } from "../src/lib/test-lead";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { buildReviewVideoPlan } from "../src/lib/content/review-video/plan";
import { buildSchedule, totalDuration } from "../src/lib/content/review-video/motion";
import { buildScenePlan, type PageSurface } from "../src/lib/content/review-video/scene-plan";
import { selectSceneSurface, focalCenter, businessSurfaceCoverage, type EvidenceAsset, type FocalRegion } from "../src/lib/content/review-video/assets";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1080, H = 1920, FPS = 24, PORT = 9247;
const OUT = "/tmp/review-video-urban-americana-m2";
const TMP = join(OUT, ".frames");
const SCENE = `file://${join(ROOT, "public", "content", "review-video", "review-scene.html")}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const magick = (a: string[]) => execFileSync("magick", a, { stdio: ["ignore", "ignore", "inherit"] });
const ff = (a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: ["ignore", "ignore", "inherit"] });
const probe = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const dims = (f: string) => { const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", f]).toString().trim().split(" ").map(Number); return { width: w, height: h }; };

const CAPTURE_CSS = `<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:56px 60px;color:#161616;background:#fff;line-height:1.5}h1{font-size:52px;margin:0 0 6px}h2{font-size:30px;margin:34px 0 14px;color:#333}a{display:inline-block;color:#1a4fa0;font-size:22px;margin:0 18px 12px 0}nav a{color:#111;font-weight:600}p{font-size:20px;color:#444}.promo{display:inline-block;background:#f2efe9;color:#7a5a1e;padding:6px 12px;margin:0 8px 8px 0;font-size:18px;border-radius:4px}</style>`;

async function main() {
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });

  // 1) Real generalized Quick Review + plan.
  const ci = ["furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables", "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books", "jewelry", "clothing", "lighting-fixtures"].map((s) => `<a href="/collections/${s}">${s === "lighting-fixtures" ? "Lighting" : s.replace(/-/g, " ")}</a>`).join("");
  const BODY = `<nav><a href="/shop">Shop</a><a href="/collections">Collections</a><a href="/about">About</a><a href="/visit">Visit</a></nav><div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div><h1>Urban Americana</h1><h2>Shop Our Collections</h2>${ci}<a href="/collections/test-old-home">test-old-home</a><p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p>`;
  const HTML = `<!doctype html><html><head><title>Urban Americana — Vintage Marketplace, Long Beach</title></head><body>${BODY}</body></html>`;
  const lead = makeLead({ id: "lead_urban_americana", businessName: "Urban Americana", industry: "Vintage marketplace", normalizedCategory: "furniture-store", city: "Long Beach", state: "CA", website: "https://urbanamericana.com/?utm_source=artifex", websiteDomain: "urbanamericana.com", rating: 4.8, reviewCount: 950, publicEmail: null });
  const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
  const review = buildQuickReview(lead, bi.businessProfile, null, { approved: false });
  const plan = buildReviewVideoPlan(review, { reviewId: "rv_urban_americana_m2", leadId: lead.id, targetSeconds: 62 });

  // 2) Capture the analyzed HTML (local, no network) at desktop + mobile; trim to content.
  const capHtml = join(TMP, "_capture.html");
  writeFileSync(capHtml, `<!doctype html><html><head><meta charset="utf-8">${CAPTURE_CSS}</head><body>${BODY}</body></html>`);
  const desktopPng = join(OUT, "surface-desktop.png"), mobilePng = join(OUT, "surface-mobile.png");
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${desktopPng}`, "--window-size=1180,1400", `file://${capHtml}`], { stdio: "ignore" });
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--screenshot=${mobilePng}`, "--window-size=430,1400", `file://${capHtml}`], { stdio: "ignore" });
  const hasDesktop = existsSync(desktopPng), hasMobile = existsSync(mobilePng);
  if (hasDesktop) magick([desktopPng, "-fuzz", "6%", "-trim", "+repage", desktopPng]);
  if (hasMobile) magick([mobilePng, "-fuzz", "6%", "-trim", "+repage", mobilePng]);

  // 3) Evidence assets + surface resolution per scene.
  const topics = review.findings.map((f) => f.topic as string);
  const assets: EvidenceAsset[] = [];
  const A = (type: EvidenceAsset["type"], path: string, findingId: string | null, focal: FocalRegion | null): EvidenceAsset => ({ assetId: `${type}-${findingId ?? "site"}`, reviewId: plan.reviewId, businessId: lead.id, findingId, type, sourceUrl: "https://urbanamericana.com", localPath: path, dimensions: dims(path), focalRegion: focal, rightsState: "PRIVATE_ONLY", provenance: "chrome-headless capture of analyzed HTML (local)" });
  if (hasDesktop) { assets.push(A("desktop-capture", desktopPng, null, { x: 0, y: 0, width: 1, height: 0.55 })); const ci2 = topics.indexOf("catalog"); if (ci2 >= 0) assets.push(A("desktop-capture", desktopPng, review.findings[ci2].id, { x: 0, y: 0.3, width: 1, height: 0.6 })); }
  if (hasMobile) { const mi = topics.indexOf("mobile"); if (mi >= 0) assets.push(A("mobile-capture", mobilePng, review.findings[mi].id, { x: 0, y: 0, width: 1, height: 0.6 })); }

  const surfaces: Record<string, PageSurface> = {};
  plan.scenes.forEach((s) => {
    const fid = s.id.startsWith("finding-") ? plan.provenance.findingIds[Number(s.id.slice(-2)) - 1] ?? null : null;
    const sel = selectSceneSurface(s, fid, lead.id, assets);
    if (sel) surfaces[s.id] = { src: `file://${sel.localPath}`, kind: sel.type === "mobile-capture" ? "mobile" : "desktop", focalY: focalCenter(sel.focalRegion).cy };
  });

  // 4) Timeline (audio is master once Lucas exists; this is the provisional preview clock).
  const durs = plan.scenes.map((s) => Math.max(2.6, s.provisionalSec));
  const schedule = buildSchedule(plan.scenes.map((s) => s.id), durs);
  const total = totalDuration(schedule);
  const pagePlan = buildScenePlan(review, plan, schedule, surfaces);
  const coverage = businessSurfaceCoverage(plan, durs, assets);

  // 5) Artifacts.
  writeFileSync(join(OUT, "review-video-plan.json"), JSON.stringify({ ...plan, schedule }, null, 2));
  writeFileSync(join(OUT, "review-video-page-plan.json"), JSON.stringify(pagePlan, null, 2));
  writeFileSync(join(OUT, "review-video-narration.txt"), plan.narration.copyBlock + "\n");
  writeFileSync(join(OUT, "review-video-assets.json"), JSON.stringify({ reviewId: plan.reviewId, businessId: plan.businessId, rightsState: plan.rightsState, coverage, assets }, null, 2));

  // 6) Drive review-scene.html frame-by-frame over CDP (the content-video mechanism).
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-rv-m2", "--force-device-scale-factor=1", `--window-size=${W},${H}`, `${SCENE}?t=0`], { stdio: "ignore" });
  try {
    let wsUrl = "";
    for (let i = 0; i < 120 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as Array<{ type: string; url?: string; webSocketDebuggerUrl: string }>; const p = l.find((x) => x.type === "page" && (x.url || "").includes("review-scene.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch { /* not up yet */ } }
    if (!wsUrl) throw new Error("no CDP page");
    const ws: any = new WebSocket(wsUrl); const pend = new Map<number, (m: any) => void>(); let sq = 0;
    await new Promise<void>((res) => { ws.onopen = () => res(); });
    ws.onmessage = (e: any) => { const m = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)!(m); pend.delete(m.id); } };
    const c2 = (method: string, params: any = {}) => new Promise<any>((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
    await c2("Page.enable"); await c2("Runtime.enable");
    for (let i = 0; i < 100; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete' && typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
    await c2("Runtime.evaluate", { expression: `window.PLAN=${JSON.stringify(pagePlan)}; window.init(); true`, returnByValue: true });
    const N = Math.ceil(total * FPS);
    console.error(`Rendering ${N} frames…`);
    for (let i = 0; i < N; i++) {
      await c2("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
      const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, captureBeyondViewport: false });
      writeFileSync(join(TMP, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
    }
    ws.close();
    if (readdirSync(TMP).filter((f) => f.endsWith(".png") && f.startsWith("f_")).length < N) throw new Error("missing frames");
  } finally { chrome.kill(); }

  // 7) Assemble silent preview + QA frames.
  const preview = join(OUT, "review-video-visual-preview-m2.mp4");
  ff(["-framerate", String(FPS), "-i", join(TMP, "f_%05d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", preview]);
  const qa: Record<string, number> = { "qa-m2-opening": schedule[0].startSec + 1.2, "qa-m2-mobile": at(schedule, "finding-01", 0.6), "qa-m2-catalog-a": at(schedule, "finding-02", 0.5), "qa-m2-catalog-b": at(schedule, "finding-02", 1.6), "qa-m2-proof-a": at(schedule, "finding-03", 0.6), "qa-m2-proof-b": at(schedule, "finding-03", 1.8), "qa-m2-start": at(schedule, "starting-point", 1.2), "qa-m2-close": at(schedule, "close", 1.0) };
  const qaPaths: Record<string, string> = {};
  for (const [name, t] of Object.entries(qa)) { const p = join(OUT, `${name}.png`); ff(["-ss", t.toFixed(2), "-i", preview, "-frames:v", "1", p]); qaPaths[name] = p; }

  console.log(JSON.stringify({ status: review.status, openingHook: plan.openingHook, scenes: pagePlan.scenes.map((s) => `${s.id}:${s.type}${s.surface ? " [surface]" : ""}`), captures: { desktop: hasDesktop, mobile: hasMobile }, coverage, previewSeconds: round2(probe(preview)), previewPath: preview, final: "VOICE_REQUIRED — real Lucas MP3 needed for a sendable final render.", qaFrames: qaPaths }, null, 2));
}
function at(schedule: ReturnType<typeof buildSchedule>, id: string, off: number): number { const w = schedule.find((x) => x.id === id); return w ? Math.min(w.endSec - 0.2, w.startSec + off) : 0; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
main().catch((e) => { console.error(e); process.exit(1); });
