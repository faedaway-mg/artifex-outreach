/**
 * Artifex Labs — PDF Design System · Tokens
 * ------------------------------------------------------------------
 * The single source of truth for color, spacing, radius, and page
 * geometry used across every generated document (Business Technology
 * Review, and any future deliverable). Values are derived directly
 * from the Artifex Labs website design language (warm matte charcoal
 * "ink", bronze accent, "chalk"/bone neutrals, restrained sapphire,
 * ember forge-heat) so print artifacts feel like they came from the
 * same studio as the product.
 *
 * These are plain constants (no @react-pdf dependency) so the palette
 * can be imported anywhere and unit-tested in isolation.
 */

/* ---------------------------------------------------------------- *
 * 1. Brand ramps — lifted 1:1 from artifex-labs/tailwind.config.ts  *
 * ---------------------------------------------------------------- */

/** Matte charcoal, warm-neutral — the brand's structural dark. */
export const ink = {
  950: "#0B0A09",
  900: "#0E0D0B",
  850: "#13110E",
  800: "#191612",
  700: "#221D18",
  600: "#2D2820",
  500: "#3B352B",
} as const;

/** Warmed off-white "bone" — typography & light surfaces. */
export const chalk = {
  50: "#F7F6F4",
  100: "#ECEAE6",
  200: "#D8D4CD",
  300: "#B4AEA3",
  400: "#8A8577",
  500: "#837C6B",
} as const;

/** Bronze — the primary Artifex accent. */
export const bronze = {
  300: "#E6C594",
  400: "#CDA05F",
  500: "#A9782F",
  600: "#855C22",
} as const;

/** Sapphire — restrained, informational cool (the "improved / future" cue). */
export const sapphire = {
  300: "#93B4FF",
  400: "#5A82EE",
  500: "#2F5CE0",
  600: "#2342A8",
} as const;

/** Graphite — warm-neutral grey for borders & secondary marks. */
export const graphite = {
  300: "#9A9488",
  400: "#6E685D",
  500: "#4B463D",
  600: "#332E27",
} as const;

/** Ember — forge heat, reserved for the single hottest moment on a page. */
export const ember = {
  300: "#FBC98A",
  400: "#F59A3C",
  500: "#E8792A",
} as const;

/** Verdigris — a calm, warm-leaning positive for "what's working". */
export const verdigris = {
  400: "#4E9A82",
  500: "#2E7D68",
} as const;

/* ---------------------------------------------------------------- *
 * 2. Semantic aliases — how the ramps are actually used.            *
 *    Components reference THESE, never raw ramp steps, so the whole *
 *    system re-themes from one place.                               *
 * ---------------------------------------------------------------- */

export const color = {
  /* Light "paper" surfaces (the body of the report) */
  paper: "#FBFAF7", // warm near-white page field
  surface: "#FFFFFF", // raised cards
  surfaceSubtle: "#F4F1EA", // inset / secondary fills
  surfaceSunken: "#EFEBE1",

  /* Ink on light */
  textPrimary: "#17130D", // warm near-black — headings
  textBody: "#39342B", // body copy
  textMuted: "#7C7568", // captions, secondary
  textFaint: "#A7A093", // meta, disabled

  /* Hairlines on light */
  hairline: "#E8E3D8",
  hairlineStrong: "#D8D2C5",

  /* Dark "hero" surfaces (cover, section dividers, investment, CTA) */
  inkBg: ink[950],
  inkBgRaised: ink[850],
  inkBgCard: "#17140F",
  onInkPrimary: chalk[50],
  onInkBody: "#C9C3B6",
  onInkMuted: "#8A8577",
  onInkFaint: "#5F5A4F",
  hairlineOnInk: "#2A251E",
  hairlineOnInkStrong: "#3A342A",

  /* Accents */
  accent: bronze[400], // primary bronze
  accentDeep: bronze[500],
  accentSoft: bronze[300],
  accentBgTint: "#F6EEDF", // bronze wash on paper
  info: sapphire[500], // "improved / future"
  infoSoft: sapphire[300],
  infoBgTint: "#EAF0FE",
  heat: ember[500], // ember — key financial / CTA moment
  heatSoft: ember[300],
  positive: verdigris[500],
  positiveSoft: verdigris[400],
  positiveBgTint: "#E7F1EC",
} as const;

/* ---------------------------------------------------------------- *
 * 3. Spacing scale — 4pt base rhythm.                               *
 * ---------------------------------------------------------------- */

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
  huge: 56,
  giant: 72,
} as const;

/* ---------------------------------------------------------------- *
 * 4. Radius scale.                                                  *
 * ---------------------------------------------------------------- */

export const radius = {
  xs: 3,
  sm: 5,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

/* ---------------------------------------------------------------- *
 * 5. Page geometry — A4, generous editorial margins.               *
 * ---------------------------------------------------------------- */

export const page = {
  size: "A4" as const,
  width: 595.28,
  height: 841.89,
  marginX: 56,
  marginTop: 54,
  marginBottom: 50,
  /** Usable content width inside the margins. */
  contentWidth: 595.28 - 56 * 2,
} as const;

/** Hairline stroke width used for rules & 1px borders. */
export const HAIRLINE = 0.75;

export type ColorToken = keyof typeof color;
