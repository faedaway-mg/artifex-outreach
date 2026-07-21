/* eslint-disable jsx-a11y/alt-text */
/**
 * Artifex Labs — PDF Design System · Atmosphere
 * ------------------------------------------------------------------
 * A pure art-direction layer: ultra-subtle, deterministic backdrops
 * that give each page a quiet visual anchor and a sense of paper depth,
 * without touching the content layout. Everything renders BEHIND the
 * content as a `fixed` full-page backdrop, at 2–8% presence, in brand
 * colours only (warm bronze, soft ivory, charcoal, muted sapphire).
 *
 * Inspiration: Apple product documentation, marque brochures, McKinsey
 * strategy decks, Aesop packaging, architectural presentation books —
 * restrained confidence, never decoration.
 *
 * No randomness or dates: every coordinate is fixed, so rendering stays
 * deterministic. Elements are absolutely positioned and `fixed`, so they
 * never participate in flow (no layout regressions, no wrap warnings).
 */
import React from "react";
import { View, Text, Svg, Defs, RadialGradient, LinearGradient, Stop, Rect, Circle, Line, Path, G } from "@react-pdf/renderer";
import { color, page } from "./tokens";
import { ff } from "./typography";

const W = page.width;
const H = page.height;

/** Brand atmosphere palette (kept local so nothing new leaks into tokens). */
const A = {
  bronze: color.accentDeep, // #A9782F
  bronzeSoft: color.accent, // #CDA05F
  sapphire: color.info, // #2F5CE0 — the "blueprint" ink
  graphite: "#6E685D",
  ink: color.inkBg,
  ember: color.heat,
  onInkLine: "#3A342A",
} as const;

/* A fixed, full-bleed backdrop layer that never affects flow. */
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0, width: W, height: H }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>{children}</Svg>
    </View>
  );
}

/* ==================================================================
 * SHARED MOTIFS
 * ================================================================== */

/** Soft radial bronze wash — "understated paper depth" / refined lighting. */
function PaperDepth({ cx, cy, r = "58%", peak = 0.05, id }: { cx: string; cy: string; r?: string; peak?: number; id: string }) {
  return (
    <>
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} r={r}>
          <Stop offset="0%" stopColor={A.bronze} stopOpacity={peak} />
          <Stop offset="60%" stopColor={A.bronze} stopOpacity={peak * 0.35} />
          <Stop offset="100%" stopColor={A.bronze} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill={`url(#${id})`} />
    </>
  );
}

/** Architectural registration ticks in two opposite corners (print-artifact elegance). */
function RegistrationCorners({ stroke = A.graphite, opacity = 0.14 }: { stroke?: string; opacity?: number }) {
  const m = 30;
  const t = 9;
  return (
    <G stroke={stroke} strokeWidth={0.5} strokeOpacity={opacity} strokeLinecap="round">
      {/* top-right */}
      <Line x1={W - m} y1={m} x2={W - m} y2={m + t} />
      <Line x1={W - m} y1={m} x2={W - m - t} y2={m} />
      {/* bottom-left */}
      <Line x1={m} y1={H - m} x2={m} y2={H - m - t} />
      <Line x1={m} y1={H - m} x2={m + t} y2={H - m} />
    </G>
  );
}

/** Oversized, ghosted serif section numeral — the editorial anchor. */
export function GhostNumeral({ n, x, y, size = 300, opacity = 0.05, tone = A.bronze }: { n: string; x: number; y: number; size?: number; opacity?: number; tone?: string }) {
  return (
    <View fixed style={{ position: "absolute", left: x, top: y, opacity }}>
      <Text style={{ ...ff("display", 600), fontSize: size, lineHeight: 1, color: tone }}>{n}</Text>
    </View>
  );
}

/* -- themed focal geometry (one per page, in the quiet margin) -------- */

/** Trust geometry — a large faceted shield outline (Strengths). */
function ShieldMotif({ opacity = 0.07 }: { opacity?: number }) {
  // Anchored lower-right, in the whitespace. Unit path scaled by transform.
  const cx = W - 150;
  const cy = H - 250;
  const s = 150;
  const p = (dx: number, dy: number) => `${cx + dx * s} ${cy + dy * s}`;
  return (
    <G stroke={A.bronze} strokeWidth={0.7} strokeOpacity={opacity} fill="none" strokeLinejoin="round" strokeLinecap="round">
      <Path d={`M ${p(0, -1)} L ${p(0.62, -0.66)} L ${p(0.62, 0.2)} C ${p(0.62, 0.62)} ${p(0.33, 0.92)} ${p(0, 1.05)} C ${p(-0.33, 0.92)} ${p(-0.62, 0.62)} ${p(-0.62, 0.2)} L ${p(-0.62, -0.66)} Z`} />
      {/* internal facets */}
      <Path d={`M ${p(0, -1)} L ${p(0, 1.05)}`} strokeOpacity={opacity * 0.7} />
      <Path d={`M ${p(-0.62, -0.24)} L ${p(0.62, -0.24)}`} strokeOpacity={opacity * 0.7} />
      <Path d={`M ${p(0, -0.24)} L ${p(0.62, -0.66)} M ${p(0, -0.24)} L ${p(-0.62, -0.66)}`} strokeOpacity={opacity * 0.5} />
    </G>
  );
}

/** Relationship mapping — a constellation of nodes + links (Opportunities). */
function ConstellationMotif({ opacity = 0.09 }: { opacity?: number }) {
  // Deterministic node field in the lower-right quiet zone.
  const ox = W - 300;
  const oy = H - 300;
  const nodes: Array<[number, number]> = [
    [40, 40], [150, 20], [250, 70], [70, 150], [180, 130], [260, 200], [120, 230], [230, 280], [40, 250],
  ];
  const edges: Array<[number, number]> = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 1], [4, 5], [3, 6], [6, 7], [7, 5], [6, 8]];
  return (
    <G>
      {edges.map(([a, b], i) => (
        <Line key={`e${i}`} x1={ox + nodes[a][0]} y1={oy + nodes[a][1]} x2={ox + nodes[b][0]} y2={oy + nodes[b][1]} stroke={A.sapphire} strokeWidth={0.5} strokeOpacity={opacity * 0.7} />
      ))}
      {nodes.map(([x, y], i) => (
        <Circle key={`n${i}`} cx={ox + x} cy={oy + y} r={i % 3 === 0 ? 2.1 : 1.4} fill={i === 4 ? A.bronze : A.sapphire} fillOpacity={i === 4 ? opacity * 1.6 : opacity} />
      ))}
    </G>
  );
}

/** Directional flow — sweeping guide arcs left→right (Journey / Recommended path). */
function FlowMotif({ opacity = 0.08 }: { opacity?: number }) {
  const y0 = H - 240;
  return (
    <G stroke={A.bronze} fill="none" strokeLinecap="round">
      <Path d={`M 40 ${y0} C ${W * 0.35} ${y0 - 70}, ${W * 0.6} ${y0 + 60}, ${W - 40} ${y0 - 20}`} strokeWidth={0.7} strokeOpacity={opacity} />
      <Path d={`M 40 ${y0 + 40} C ${W * 0.4} ${y0 - 10}, ${W * 0.62} ${y0 + 110}, ${W - 40} ${y0 + 40}`} strokeWidth={0.6} strokeOpacity={opacity * 0.6} />
      {/* travelling nodes */}
      <Circle cx={40} cy={y0} r={2} fill={A.bronze} fillOpacity={opacity * 1.8} stroke="none" />
      <Circle cx={W - 40} cy={y0 - 20} r={2.4} fill={A.sapphire} fillOpacity={opacity * 1.8} stroke="none" />
    </G>
  );
}

/** Topographic contours — a layered financial roadmap (Investment). */
function ContourMotif({ opacity = 0.06 }: { opacity?: number }) {
  const base = H - 150;
  const lines = [0, 1, 2, 3, 4];
  return (
    <G stroke={A.bronze} fill="none" strokeLinecap="round">
      {lines.map((i) => {
        const y = base - i * 26;
        const amp = 16 + i * 3;
        return (
          <Path
            key={i}
            d={`M -10 ${y} C ${W * 0.22} ${y - amp}, ${W * 0.4} ${y + amp}, ${W * 0.58} ${y} S ${W * 0.86} ${y - amp}, ${W + 10} ${y - amp * 0.4}`}
            strokeWidth={0.6}
            strokeOpacity={opacity * (1 - i * 0.12)}
          />
        );
      })}
    </G>
  );
}

/** Executive hero framing — a soft horizon arc + faint construction lines. */
function ExecFraming({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <G>
      <Path d={`M -20 ${H * 0.5} C ${W * 0.3} ${H * 0.42}, ${W * 0.7} ${H * 0.6}, ${W + 20} ${H * 0.5}`} stroke={A.bronze} strokeWidth={0.6} strokeOpacity={opacity} fill="none" />
      <Line x1={W - 120} y1={70} x2={W - 120} y2={H - 70} stroke={A.graphite} strokeWidth={0.4} strokeOpacity={opacity * 0.6} strokeDasharray="1 5" />
    </G>
  );
}

/* ==================================================================
 * PAGE FIELD — the composed backdrop for a light content page
 * ================================================================== */

type Variant = "exec" | "strengths" | "opps" | "journey" | "path" | "investment";

const NUMERAL_TONE = "#E8DFCB"; // faint bronze-on-ivory; solid keeps it print-safe

export function PageField({ variant, numeral }: { variant: Variant; numeral?: string }) {
  const depth: Record<Variant, { cx: string; cy: string }> = {
    exec: { cx: "82%", cy: "12%" },
    strengths: { cx: "84%", cy: "80%" },
    opps: { cx: "84%", cy: "82%" },
    journey: { cx: "16%", cy: "82%" },
    path: { cx: "84%", cy: "80%" },
    investment: { cx: "84%", cy: "18%" },
  };
  const d = depth[variant];
  return (
    <>
      <Backdrop>
        <PaperDepth id={`pd-${variant}`} cx={d.cx} cy={d.cy} peak={0.045} />
        <RegistrationCorners />
        {variant === "exec" && <ExecFraming />}
        {variant === "strengths" && <ShieldMotif />}
        {variant === "opps" && <ConstellationMotif />}
        {variant === "journey" && <FlowMotif />}
        {variant === "path" && <FlowMotif opacity={0.06} />}
        {variant === "investment" && <ContourMotif />}
      </Backdrop>
      {numeral && (
        <GhostNumeral
          n={numeral}
          x={variant === "journey" ? 40 : W - 230}
          y={H - 300}
          size={250}
          opacity={1}
          tone={NUMERAL_TONE}
        />
      )}
    </>
  );
}

/* ==================================================================
 * HERO ATMOSPHERE — the dark cover & closing pages
 * ================================================================== */

export function HeroAtmosphere({ variant = "cover" }: { variant?: "cover" | "closing" }) {
  const cover = variant === "cover";
  const gx = cover ? "80%" : "22%";
  const gy = cover ? "84%" : "20%";
  return (
    <Backdrop>
      <Defs>
        <RadialGradient id={`hero-glow-${variant}`} cx={gx} cy={gy} r="55%">
          <Stop offset="0%" stopColor={A.bronze} stopOpacity={0.17} />
          <Stop offset="45%" stopColor={A.bronze} stopOpacity={0.05} />
          <Stop offset="100%" stopColor={A.ink} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`hero-ember-${variant}`} cx={gx} cy={gy} r="16%">
          <Stop offset="0%" stopColor={A.ember} stopOpacity={0.12} />
          <Stop offset="100%" stopColor={A.ink} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill={`url(#hero-glow-${variant})`} />
      <Rect x={0} y={0} width={W} height={H} fill={`url(#hero-ember-${variant})`} />
      {/* The cover carries the network constellation; the closing stays cinematically bare
          (glow + the brand mark only) for restrained, confident finality. */}
      {cover && <HeroConstellation variant={variant} />}
    </Backdrop>
  );
}

function HeroConstellation({ variant }: { variant: "cover" | "closing" }) {
  const nodes: Array<[number, number]> = variant === "cover"
    ? [[70, 120], [150, 90], [220, 150], [110, 200], [190, 230], [60, 260]]
    : [[W - 70, H - 130], [W - 150, H - 100], [W - 220, H - 160], [W - 110, H - 210], [W - 190, H - 240], [W - 60, H - 270]];
  const edges: Array<[number, number]> = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 1], [3, 5]];
  return (
    <G>
      {edges.map(([a, b], i) => (
        <Line key={`e${i}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke={A.onInkLine} strokeWidth={0.5} strokeOpacity={0.9} />
      ))}
      {nodes.map(([x, y], i) => (
        <Circle key={`n${i}`} cx={x} cy={y} r={i === 2 ? 1.8 : 1.2} fill={i === 2 ? A.bronzeSoft : A.onInkLine} />
      ))}
    </G>
  );
}
