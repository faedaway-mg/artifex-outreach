#!/usr/bin/env node
// Faceless Content #001 — ARTIFEX / FIELD NOTE 001 vertical slide assets (9:16, 1080×1920).
// Deterministic, self-contained SVGs reusing the Artifex "Quiet Horizon" palette + constellation
// mark (same visual system as the /review OG card). No prospect data, no screenshots, no faces.
// This is ONE artifact's assets — not a content engine. Run: node scripts/build-field-note-001.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "content", "field-note-001");
mkdirSync(OUT, { recursive: true });

const W = 1080, H = 1920;
const INK0 = "#06080C", INK1 = "#0C1220", INK2 = "#101a2e";
const CHALK = "#F6F8FC", MUTE = "#AEBBD0", AZURE = "#93B8FF", TEAL = "#7FE3C7", AMBER = "#F5B95C", FAINT = "#5A6B85";
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The constellation mark (Artifex "A") — two struts + crossbar, three nodes (one amber).
const mark = (cx, cy, s) => `
  <g transform="translate(${cx - 16 * s},${cy - 16 * s}) scale(${s})">
    <path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="${CHALK}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="4" r="2.7" fill="${CHALK}"/><circle cx="5" cy="27" r="2.5" fill="${CHALK}"/><circle cx="27" cy="27" r="2.5" fill="${AMBER}"/>
  </g>`;

const text = (x, y, s, fill, weight, str, anchor = "middle", spacing = "0") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${s}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;

function slide({ name, eyebrow = "ARTIFEX / FIELD NOTE 001", lines, footer = null, accent = AZURE }) {
  // lines: [{ t, size, fill, weight, gap, arrow }] — block centered in the band below the eyebrow
  // and above the footer, so it never drifts off-canvas regardless of line count.
  const BAND_TOP = 420, BAND_BOTTOM = 1680;
  const total = lines.reduce((a, l) => a + (l.arrow ? 44 : 0) + (l.size * 1.25) + (l.gap ?? 34), 0);
  let y = BAND_TOP + Math.max(0, ((BAND_BOTTOM - BAND_TOP) - total) / 2) + lines[0].size;
  const body = lines.map((l) => {
    const parts = [];
    if (l.arrow) { parts.push(text(W / 2, y - 18, 46, accent, 400, "↓")); y += 44; }
    parts.push(text(W / 2, y, l.size, l.fill ?? CHALK, l.weight ?? 700, l.t, "middle", l.spacing ?? "0"));
    y += l.size * 1.25 + (l.gap ?? 34);
    return parts.join("\n");
  }).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${INK0}"/><stop offset="0.6" stop-color="${INK1}"/><stop offset="1" stop-color="${INK2}"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${mark(W / 2, 180, 4.2)}
  ${text(W / 2, 300, 26, accent, 600, eyebrow, "middle", "6")}
  ${body}
  ${footer ? text(W / 2, H - 150, 30, MUTE, 500, footer) : ""}
  ${text(W / 2, H - 90, 24, FAINT, 500, "artifexlabs.tech", "middle", "2")}
</svg>`;
  writeFileSync(join(OUT, name), svg.trim());
  return name;
}

const built = [];
// 1 — HOOK
built.push(slide({ name: "01-hook.svg", accent: AZURE, lines: [
  { t: "We built software", size: 78, weight: 700 },
  { t: "to help us find clients.", size: 78, weight: 700, gap: 70 },
  { t: "Then we realized", size: 52, fill: MUTE, weight: 500 },
  { t: "we built the wrong workflow.", size: 60, fill: CHALK, weight: 700 },
] }));
// 2 — WRONG WORK
built.push(slide({ name: "02-wrong-work.svg", accent: AMBER, lines: [
  { t: "SOFTWARE", size: 66, weight: 700 },
  { t: "COLD CALL", size: 66, weight: 700, arrow: true },
  { t: "human creates interest", size: 46, fill: MUTE, weight: 500, arrow: true },
  { t: "from zero.", size: 46, fill: MUTE, weight: 500, gap: 20 },
], footer: "the operator's weakest position" }));
// 3 — DISCOVERY
built.push(slide({ name: "03-discovery.svg", accent: TEAL, lines: [
  { t: "WEBSITE", size: 66, weight: 700 },
  { t: "public email exists ✓", size: 50, fill: TEAL, weight: 700, arrow: true },
  { t: "the system wasn't using it.", size: 46, fill: MUTE, weight: 500, gap: 24 },
  { t: "wrong human work.", size: 52, fill: CHALK, weight: 700, gap: 20 },
], footer: "a sales problem that was really a data problem" }));
// 4 — REDESIGN
built.push(slide({ name: "04-redesign.svg", accent: TEAL, lines: [
  { t: "WEBSITE", size: 52, weight: 700 },
  { t: "understand the business", size: 44, fill: MUTE, weight: 500, arrow: true },
  { t: "business email", size: 44, fill: CHALK, weight: 600, arrow: true },
  { t: "personalized review", size: 44, fill: CHALK, weight: 600, arrow: true },
  { t: "value first", size: 48, fill: TEAL, weight: 700, arrow: true },
  { t: "warm conversation", size: 52, fill: CHALK, weight: 700, arrow: true },
] }));
// 5 — PRINCIPLE
built.push(slide({ name: "05-principle.svg", accent: AZURE, lines: [
  { t: "Software", size: 74, weight: 700 },
  { t: "handles scale.", size: 74, weight: 700, gap: 80 },
  { t: "Humans", size: 74, weight: 700 },
  { t: "handle intent.", size: 74, weight: 700 },
] }));
// 6 — CTA
built.push(slide({ name: "06-cta.svg", accent: AMBER, lines: [
  { t: "What is your business", size: 50, fill: MUTE, weight: 500 },
  { t: "making humans do", size: 50, fill: MUTE, weight: 500 },
  { t: "that software should handle?", size: 50, fill: CHALK, weight: 700, gap: 90 },
  { t: "Request a", size: 46, fill: CHALK, weight: 600 },
  { t: "Business Technology Review", size: 54, fill: AMBER, weight: 700, gap: 28 },
  { t: "No cost. Nothing to sign.", size: 40, fill: MUTE, weight: 500 },
], footer: "artifexlabs.tech/review" }));
// 7 — COVER / THUMBNAIL
built.push(slide({ name: "07-cover.svg", accent: AZURE, lines: [
  { t: "FIELD NOTE 001", size: 42, fill: AZURE, weight: 700, spacing: "4", gap: 90 },
  { t: "We built the", size: 82, weight: 700 },
  { t: "wrong workflow.", size: 82, weight: 700 },
], footer: "Artifex Labs" }));

console.log("Built Field Note 001 assets:\n" + built.map((b) => "  public/content/field-note-001/" + b).join("\n"));
