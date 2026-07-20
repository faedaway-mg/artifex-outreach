/* eslint-disable jsx-a11y/alt-text */
/**
 * Artifex Labs — PDF Design System · Primitives
 * ------------------------------------------------------------------
 * Low-level, reusable atoms: layout helpers, typographic text atoms,
 * the Artifex brand mark, and a crisp line-icon set (drawn as vector
 * SVG so they stay sharp at any zoom). Higher-level blocks in
 * components.tsx are composed entirely from these.
 */
import React from "react";
import { View, Text, Svg, Path, Circle, Line, Rect, G } from "@react-pdf/renderer";
import { color, space } from "./tokens";
import { type } from "./typography";

type Style = Record<string, any>;
type SX = Style | Style[] | undefined;

/* ------------------------------ layout ------------------------------ */

export function Row({ children, style, gap, wrap }: { children: React.ReactNode; style?: SX; gap?: number; wrap?: boolean }) {
  return <View wrap={wrap} style={[{ flexDirection: "row", alignItems: "flex-start" }, gap != null ? { gap } : {}, ...toArr(style)]}>{children}</View>;
}

export function Col({ children, style, gap, wrap }: { children: React.ReactNode; style?: SX; gap?: number; wrap?: boolean }) {
  return <View wrap={wrap} style={[{ flexDirection: "column" }, gap != null ? { gap } : {}, ...toArr(style)]}>{children}</View>;
}

export function Spacer({ h = space.md }: { h?: number }) {
  return <View style={{ height: h }} />;
}

/** A hairline rule. `on="dark"` picks the dark-surface hairline color. */
export function Rule({ on = "light", color: c, style }: { on?: "light" | "dark"; color?: string; style?: SX }) {
  const stroke = c ?? (on === "dark" ? color.hairlineOnInk : color.hairline);
  return <View style={[{ height: 0.75, backgroundColor: stroke, width: "100%" }, ...toArr(style)]} />;
}

/** A short accent tick — used to open a section. */
export function AccentTick({ color: c = color.accent, w = 26 }: { color?: string; w?: number }) {
  return <View style={{ width: w, height: 2.5, backgroundColor: c, borderRadius: 2 }} />;
}

/* ------------------------------ text ------------------------------ */

function toArr(s: SX): Style[] {
  return s == null ? [] : Array.isArray(s) ? s : [s];
}

export function Eyebrow({ children, color: c = color.accentDeep, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.eyebrow, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Display({ children, color: c = color.textPrimary, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.displayLg, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Title({ children, color: c = color.textPrimary, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.title, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Lede({ children, color: c = color.textBody, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.lede, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Body({ children, color: c = color.textBody, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.body, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Label({ children, color: c = color.textMuted, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.label, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Caption({ children, color: c = color.textMuted, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.caption, { color: c }, ...toArr(style)]}>{children}</Text>;
}

export function Mono({ children, color: c = color.textMuted, style }: { children: React.ReactNode; color?: string; style?: SX }) {
  return <Text style={[type.mono, { color: c }, ...toArr(style)]}>{children}</Text>;
}

/* --------------------------- brand mark --------------------------- */

/**
 * The Artifex mark — an abstract "A" from three connected nodes, echoing
 * the site's network motif. `tone` sets the linework color; the lower-right
 * node always burns bronze/ember as the fixed accent.
 */
export function BrandMark({ size = 18, tone = color.textPrimary, accent = color.accent }: { size?: number; tone?: string; accent?: string }) {
  return (
    <Svg viewBox="0 0 32 32" style={{ width: size, height: size }}>
      <Path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" stroke={tone} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={16} cy={4} r={2.7} fill={tone} />
      <Circle cx={5} cy={27} r={2.5} fill={tone} />
      <Circle cx={27} cy={27} r={2.5} fill={accent} />
    </Svg>
  );
}

/** Horizontal lockup: mark + wordmark. */
export function Wordmark({ tone = color.textPrimary, accent = color.accent, size = 16 }: { tone?: string; accent?: string; size?: number }) {
  return (
    <Row style={{ alignItems: "center", gap: 8 }}>
      <BrandMark size={size} tone={tone} accent={accent} />
      <Text style={[type.h4, { color: tone, letterSpacing: 2.2, fontSize: 9.5 }]}>ARTIFEX LABS</Text>
    </Row>
  );
}

/* ------------------------------ icons ------------------------------ */

/**
 * Feather-style line icons on a 24×24 grid. Reusable across documents;
 * add new glyphs here and they're available everywhere.
 */
const ICONS: Record<string, React.ReactNode> = {
  check: <Path d="M20 6 L9 17 L4 12" />,
  arrowRight: (
    <G>
      <Line x1={4} y1={12} x2={20} y2={12} />
      <Path d="M14 6 L20 12 L14 18" />
    </G>
  ),
  trend: (
    <G>
      <Path d="M3 17 L9 11 L13 15 L21 7" />
      <Path d="M15 7 L21 7 L21 13" />
    </G>
  ),
  target: (
    <G>
      <Circle cx={12} cy={12} r={8} />
      <Circle cx={12} cy={12} r={3.4} />
    </G>
  ),
  route: (
    <G>
      <Circle cx={6} cy={19} r={2.4} />
      <Circle cx={18} cy={5} r={2.4} />
      <Path d="M8.4 19 H14 a3.5 3.5 0 0 0 0 -7 H10 a3.5 3.5 0 0 1 0 -7 H15.6" />
    </G>
  ),
  spark: <Path d="M12 3 C12.6 8 15.9 11.3 21 12 C15.9 12.7 12.6 16 12 21 C11.4 16 8.1 12.7 3 12 C8.1 11.3 11.4 8 12 3 Z" />,
  globe: (
    <G>
      <Circle cx={12} cy={12} r={8.5} />
      <Line x1={3.5} y1={12} x2={20.5} y2={12} />
      <Path d="M12 3.5 C15 6.5 15 17.5 12 20.5 C9 17.5 9 6.5 12 3.5 Z" />
    </G>
  ),
  calendar: (
    <G>
      <Rect x={4} y={5.5} width={16} height={15} rx={2} />
      <Line x1={4} y1={10} x2={20} y2={10} />
      <Line x1={8.5} y1={3} x2={8.5} y2={7} />
      <Line x1={15.5} y1={3} x2={15.5} y2={7} />
    </G>
  ),
  mail: (
    <G>
      <Rect x={3.5} y={5.5} width={17} height={13} rx={2} />
      <Path d="M4 7 L12 13 L20 7" />
    </G>
  ),
  shield: <Path d="M12 3 L19 6 V11 C19 16 15.8 19.4 12 21 C8.2 19.4 5 16 5 11 V6 Z" />,
  star: <Path d="M12 3.5 L14.6 9 L20.5 9.7 L16.2 13.8 L17.4 19.6 L12 16.7 L6.6 19.6 L7.8 13.8 L3.5 9.7 L9.4 9 Z" />,
  layers: (
    <G>
      <Path d="M12 3.5 L21 8 L12 12.5 L3 8 Z" />
      <Path d="M3 12 L12 16.5 L21 12" />
      <Path d="M3 16 L12 20.5 L21 16" />
    </G>
  ),
  chat: <Path d="M4.5 5.5 H19.5 V16 H10 L5.5 20 V16 H4.5 Z" />,
  gauge: (
    <G>
      <Path d="M4 17 A8 8 0 1 1 20 17" />
      <Line x1={12} y1={13} x2={15.5} y2={9.5} />
      <Circle cx={12} cy={13} r={1.3} />
    </G>
  ),
  phone: <Path d="M6 3.5 H9 L10.5 8 L8.5 9.5 C9.5 12 12 14.5 14.5 15.5 L16 13.5 L20.5 15 V18 C20.5 19.5 19.5 20.5 18 20.5 C10.5 20 4 13.5 3.5 6 C3.5 4.5 4.5 3.5 6 3.5 Z" />,
  mapPin: (
    <G>
      <Path d="M12 21 C16 16.5 18.5 13 18.5 9.5 A6.5 6.5 0 0 0 5.5 9.5 C5.5 13 8 16.5 12 21 Z" />
      <Circle cx={12} cy={9.5} r={2.4} />
    </G>
  ),
  search: (
    <G>
      <Circle cx={11} cy={11} r={6.5} />
      <Line x1={16} y1={16} x2={20.5} y2={20.5} />
    </G>
  ),
  bolt: <Path d="M13 3 L5 13.5 H11 L10 21 L19 10 H13 Z" />,
  monitor: (
    <G>
      <Rect x={3.5} y={4.5} width={17} height={12} rx={1.6} />
      <Line x1={9} y1={20.5} x2={15} y2={20.5} />
      <Line x1={12} y1={16.5} x2={12} y2={20.5} />
    </G>
  ),
  clock: (
    <G>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7 V12 L15.5 14" />
    </G>
  ),
  compass: (
    <G>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M15.5 8.5 L13.2 13.2 L8.5 15.5 L10.8 10.8 Z" />
    </G>
  ),
  handshake: <Path d="M3 9 L7 6 L12 9 L17 6 L21 9 M7 12 L10.5 15.5 M12 9 L9 12 M12 15 L14 17 M15 13 L17 15" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 14, color: c = color.accentDeep, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg viewBox="0 0 24 24" style={{ width: size, height: size }}>
      <G stroke={c} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </G>
    </Svg>
  );
}

/** A rounded icon chip — icon inside a soft tinted square. */
export function IconChip({ name, size = 26, icon = 14, bg = color.accentBgTint, fg = color.accentDeep, radius = 7 }: { name: IconName; size?: number; icon?: number; bg?: string; fg?: string; radius?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={icon} color={fg} strokeWidth={1.9} />
    </View>
  );
}
