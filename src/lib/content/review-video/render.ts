// ─────────────────────────────────────────────────────────────────────────────
// Review Video renderer — turns a ReviewVideoPlan into a vertical (1080×1920) MP4 in the Artifex
// content aesthetic (dark constellation, ink type, gold accent, the triangle-A mark), WITHOUT Chrome:
// type is composed with ImageMagick, motion + assembly with ffmpeg. Each scene is a bounded editorial
// composition, so the story reads sound-off; ffmpeg adds fades + a scene-appropriate push so it feels
// active, not a slideshow. The narration audio is the master clock — timings come from the plan
// (provisional) or from imported audio. Nothing is sent or published; output is a local artifact.
//
// The LAYOUT is pure and testable (sceneLayers); the orchestrator (renderReviewVideo) shells out and is
// used only by the render script — never imported by an app route.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoPlan, VideoScene } from "./plan";

// Artifex content palette (matches the field-note constellation master, not the light PDF).
export const PALETTE = {
  bgTop: "#070B14", bgBot: "#0F1A2E", ink: "#EDF1F8", mute: "#93A2BE", faint: "#54648A",
  gold: "#E8B25A", teal: "#7FE3C7", hair: "#22304A",
};
export const FONT = "/System/Library/Fonts/Helvetica.ttc";
const W = 1080, H = 1920, MX = 120; // canvas + horizontal margin

export type LayerKind = "caption" | "label" | "rule" | "mark" | "image" | "wordmark" | "connector" | "focusbox";
export interface Layer {
  role: string;
  kind: LayerKind;
  text?: string;
  fontSize?: number;
  fill?: string;
  /** wrap width for caption blocks. */
  boxW?: number;
  /** letter tracking for label/eyebrow rows. */
  tracking?: number;
  gravity: "North" | "NorthWest" | "Center" | "South" | "SouthWest";
  dx: number;
  dy: number;
  /** rule width/height, or image source path. */
  w?: number;
  h?: number;
  src?: string;
}

const cap = (role: string, text: string, fontSize: number, fill: string, dy: number, extra: Partial<Layer> = {}): Layer =>
  ({ role, kind: "caption", text, fontSize, fill, boxW: W - MX * 2, gravity: "NorthWest", dx: MX, dy, ...extra });
const eyebrow = (role: string, text: string, fill: string, dy: number): Layer =>
  ({ role, kind: "label", text, fontSize: 30, fill, tracking: 6, gravity: "NorthWest", dx: MX, dy });
// A long footer provenance line — tight tracking + smaller so it never runs off the right margin.
const footer = (role: string, text: string, fill: string, dy: number): Layer =>
  ({ role, kind: "label", text, fontSize: 22, fill, tracking: 2, gravity: "SouthWest", dx: MX, dy: 120 });
const rule = (dy: number, w = 90): Layer => ({ role: "rule", kind: "rule", gravity: "NorthWest", dx: MX, dy, w, h: 5, fill: PALETTE.gold });

/** The bounded, deterministic layer layout for a scene. PURE — this is what tests assert on. Every
 *  featured value/excerpt/comparison is taken from the plan; nothing is invented. Pattern interruption
 *  comes from each scene type composing differently. */
export function sceneLayers(scene: VideoScene): Layer[] {
  const L: Layer[] = [];
  switch (scene.type) {
    case "OPENING_HOOK":
      L.push({ role: "mark", kind: "mark", gravity: "North", dx: 0, dy: 150, w: 96, h: 96 });
      L.push(eyebrow("kicker", "QUICK REVIEW", PALETTE.gold, 300));
      L.push(cap("business", scene.subline ?? "", 40, PALETTE.mute, 360));
      L.push(cap("hook", scene.headline, 92, PALETTE.ink, 480));
      if (scene.evidence) L.push(footer("evidence", scene.evidence.sourceLabel.toUpperCase(), PALETTE.faint, 1640));
      break;
    case "STAT_REVEAL":
      L.push({ role: "stat", kind: "label", text: scene.primaryValue ?? "", fontSize: 360, fill: PALETTE.gold, gravity: "North", dx: 0, dy: 430 });
      L.push(eyebrow("statLabel", (scene.primaryLabel ?? "").toUpperCase(), PALETTE.ink, 900));
      L.push(rule(1000));
      L.push(cap("hook", scene.headline, 74, PALETTE.ink, 1050));
      break;
    case "STRUCTURE":
      L.push({ role: "stat", kind: "label", text: scene.primaryValue ?? "", fontSize: 300, fill: PALETTE.gold, gravity: "North", dx: 0, dy: 360 });
      L.push(eyebrow("statLabel", (scene.primaryLabel ?? "").toUpperCase(), PALETTE.ink, 760));
      (scene.structure ?? []).slice(1).forEach((line, i) => {
        const dy = 880 + i * 84;
        L.push({ role: `arrow-${i}`, kind: "connector", gravity: "NorthWest", dx: MX + 4, dy, w: 18, h: 40, fill: PALETTE.gold }); // drawn ↓, no glyph dependency
        L.push(cap(`flow-${i}`, line, 44, PALETTE.mute, dy - 4, { dx: MX + 44 }));
      });
      L.push(cap("hook", scene.headline, 66, PALETTE.ink, 1120));
      break;
    case "COMPARISON":
      L.push({ role: "cmpL", kind: "label", text: scene.comparison?.left ?? "", fontSize: 210, fill: PALETTE.ink, gravity: "North", dx: 0, dy: 380 });
      L.push(eyebrow("cmpLlabel", (scene.comparison?.leftLabel ?? "").toUpperCase(), PALETTE.mute, 640));
      L.push({ role: "vs", kind: "label", text: "VS", fontSize: 40, fill: PALETTE.gold, tracking: 8, gravity: "North", dx: 0, dy: 730 });
      L.push({ role: "cmpR", kind: "label", text: scene.comparison?.right ?? "", fontSize: 210, fill: PALETTE.faint, gravity: "North", dx: 0, dy: 820 });
      L.push(eyebrow("cmpRlabel", (scene.comparison?.rightLabel ?? "").toUpperCase(), PALETTE.mute, 1080));
      L.push(cap("hook", scene.headline, 68, PALETTE.ink, 1200));
      break;
    case "EVIDENCE_EXCERPT":
      L.push(eyebrow("kicker", "FOUND LIVE", PALETTE.gold, 520));
      L.push({ role: "excerpt", kind: "caption", text: scene.excerpt ?? "", fontSize: 100, fill: PALETTE.ink, boxW: W - MX * 2, gravity: "NorthWest", dx: MX, dy: 600 });
      L.push(cap("hook", scene.headline, 64, PALETTE.mute, 900));
      break;
    case "SCREENSHOT_FOCUS":
    case "MOBILE_VIEW":
      if (scene.evidence?.screenshotRef) {
        L.push({ role: "shot", kind: "image", src: scene.evidence.screenshotRef, gravity: "North", dx: 0, dy: 320, w: 760, h: 1000 });
        L.push(cap("hook", scene.headline, 64, PALETTE.ink, 1360));
      } else {
        // No real capture → fall back to a clean text scene. Never fabricate a screenshot.
        L.push(rule(430));
        L.push(cap("hook", scene.headline, 84, PALETTE.ink, 480));
        if (scene.subline) L.push(cap("obs", scene.subline, 44, PALETTE.mute, 760));
      }
      break;
    case "STARTING_POINT":
      L.push(rule(360, 120));
      L.push(eyebrow("kicker", "WHERE WE'D START", PALETTE.gold, 420));
      L.push(cap("label", scene.headline, 84, PALETTE.ink, 500));
      if (scene.subline) L.push(cap("why", scene.subline, 46, PALETTE.mute, 720));
      if (scene.evidence) L.push(footer("proof", `PROOF · ${scene.evidence.sourceLabel.toUpperCase()}`, PALETTE.faint, 1640));
      break;
    case "CLOSE":
      L.push({ role: "mark", kind: "mark", gravity: "Center", dx: 0, dy: -80, w: 150, h: 150 });
      L.push({ role: "wordmark", kind: "wordmark", text: "ARTIFEX LABS", fontSize: 46, fill: PALETTE.ink, tracking: 10, gravity: "Center", dx: 0, dy: 120 });
      L.push({ role: "private", kind: "label", text: "PRIVATE REVIEW · NOT FOR DISTRIBUTION", fontSize: 22, fill: PALETTE.faint, tracking: 3, gravity: "South", dx: 0, dy: 150 });
      break;
    case "TEXT":
    default:
      L.push(rule(430));
      L.push(cap("hook", scene.headline, 84, PALETTE.ink, 480));
      if (scene.subline) L.push(cap("obs", scene.subline, 44, PALETTE.mute, 760));
      break;
  }
  return L;
}

/** OVERLAY layers for a scene that is BACKED BY A REAL SURFACE (M1.1). The captured business surface
 *  is the subject; Artifex only frames it. So we keep the type minimal and pushed to the edges (a top
 *  kicker/stat, a bottom hook, one annotation) so the prospect's own page stays visible underneath. */
export function surfaceOverlayLayers(scene: VideoScene): Layer[] {
  const L: Layer[] = [];
  // A bottom scrim caption (the hook) reads over any surface; top-left carries the number/annotation.
  const isStat = scene.type === "STRUCTURE" || scene.type === "STAT_REVEAL" || scene.type === "COMPARISON";
  if (scene.type === "OPENING_HOOK") {
    L.push(eyebrow("kicker", "QUICK REVIEW", PALETTE.gold, 96));
    L.push(cap("business", scene.subline ?? "", 40, PALETTE.mute, 150));
    L.push(cap("hook", scene.headline, 84, PALETTE.ink, 1480));
  } else if (isStat && scene.primaryValue) {
    L.push({ role: "stat", kind: "label", text: scene.primaryValue, fontSize: 220, fill: PALETTE.gold, gravity: "NorthWest", dx: MX, dy: 110 });
    if (scene.primaryLabel) L.push({ role: "statLabel", kind: "caption", text: scene.primaryLabel.toUpperCase(), fontSize: 26, fill: PALETTE.ink, boxW: W - MX * 2, tracking: 2, gravity: "NorthWest", dx: MX, dy: 350 });
    L.push({ role: "annot", kind: "focusbox", gravity: "NorthWest", dx: MX, dy: 460, w: 300, h: 6, fill: PALETTE.gold });
    L.push(cap("hook", scene.headline, 62, PALETTE.ink, 1490));
  } else if (scene.type === "COMPARISON" && scene.comparison) {
    L.push({ role: "cmpL", kind: "label", text: scene.comparison.left, fontSize: 150, fill: PALETTE.gold, gravity: "NorthWest", dx: MX, dy: 110 });
    L.push({ role: "cmpLlabel", kind: "caption", text: scene.comparison.leftLabel.toUpperCase(), fontSize: 24, fill: PALETTE.ink, boxW: W - MX * 2, tracking: 2, gravity: "NorthWest", dx: MX, dy: 290 });
    L.push(cap("hook", scene.headline, 60, PALETTE.ink, 1490));
  } else {
    L.push(cap("hook", scene.headline, 74, PALETTE.ink, 1440));
  }
  return L;
}

/** ffmpeg zoompan toward a focal center (fractions 0..1). Pushes INTO the region of interest so the
 *  eye is guided to the evidence, not the middle. Pure — returns z/x/y expressions for one scene. */
export function focalZoompan(cx: number, cy: number, zoomFrom: number, zoomTo: number, frames: number, w = 1080, h = 1920): { z: string; x: string; y: string } {
  const z = zoomFrom === zoomTo ? String(zoomFrom) : `${zoomFrom}+(${(zoomTo - zoomFrom).toFixed(4)})*on/${frames}`;
  const fx = Math.min(1, Math.max(0, cx)), fy = Math.min(1, Math.max(0, cy));
  // Center the zoom window on the focal point (clamped inside the frame by zoompan itself).
  const x = `(iw*${fx.toFixed(3)})-(iw/zoom/2)`;
  const y = `(ih*${fy.toFixed(3)})-(ih/zoom/2)`;
  return { z, x, y };
}

/** ffmpeg motion per scene type — a gentle, purposeful move (never motion for its own sake). Returns
 *  the zoompan/scale expression parameters. Pure + testable. */
export function sceneMotion(type: VideoScene["type"]): { zoomFrom: number; zoomTo: number } {
  switch (type) {
    case "SCREENSHOT_FOCUS": case "MOBILE_VIEW": return { zoomFrom: 1.0, zoomTo: 1.08 }; // push into the capture
    case "STAT_REVEAL": case "STRUCTURE": case "COMPARISON": return { zoomFrom: 1.06, zoomTo: 1.0 }; // settle the number
    case "CLOSE": return { zoomFrom: 1.0, zoomTo: 1.0 };
    default: return { zoomFrom: 1.03, zoomTo: 1.0 }; // slow editorial drift
  }
}

/** The list of intermediate artifact paths a render produces (for the manifest/report). */
export function artifactNames(): Record<string, string> {
  return {
    plan: "review-video-plan.json",
    narration: "review-video-narration.txt",
    captions: "review-video-captions.srt",
    assets: "review-video-assets.json",
    preview: "review-video-visual-preview.mp4",
    final: "review-video-final.mp4",
  };
}
