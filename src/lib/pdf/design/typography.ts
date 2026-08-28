/**
 * Artifex Labs — PDF Design System · Typography
 * ------------------------------------------------------------------
 * Registers the brand typefaces (Playfair Display · Inter · JetBrains
 * Mono — the exact trio the artifexlabs.tech site uses) for embedding
 * in generated PDFs, and exposes a single reusable type scale.
 *
 * Robustness: font parsing depends on fontkit, which on some broken
 * runtimes (notably a specific Node 23.4.0 build whose
 * `TextDecoder('ascii')` returns a Buffer instead of a string) throws
 * "Unknown font format" at render time. We probe that exact capability
 * up front; when it's missing (or the font files aren't present) we
 * transparently fall back to the standard PDF-14 fonts (Times / Helvetica
 * / Courier). The document renders identically-structured either way —
 * only the letterforms differ — so nothing ever breaks in CI or prod.
 */
import path from "path";
import fs from "fs";
import { Font } from "@react-pdf/renderer";
import { installTextDecoderFix } from "./textdecoder-fix";

// Restore correct single-byte TextDecoder behavior (Node 23.4.0 defect) BEFORE the
// font-parsing probe, so brand fonts embed and the PDF renders identically across
// viewers instead of falling back to unembedded standard-14 fonts.
installTextDecoderFix();

type Role = "display" | "sans" | "mono";
type Weight = 400 | 500 | 600 | 700;

/** Custom family names (only used when embedding succeeds). */
const FAM = {
  display: "ArtifexSerif",
  sans: "ArtifexSans",
  mono: "ArtifexMono",
} as const;

/** Standard PDF-14 fallbacks, one explicit variant per (role, weight). */
const STD: Record<Role, Record<Weight, string>> = {
  display: { 400: "Times-Roman", 500: "Times-Roman", 600: "Times-Bold", 700: "Times-Bold" },
  sans: { 400: "Helvetica", 500: "Helvetica", 600: "Helvetica-Bold", 700: "Helvetica-Bold" },
  mono: { 400: "Courier", 500: "Courier", 600: "Courier-Bold", 700: "Courier-Bold" },
};

/**
 * Precise probe for the runtime defect that makes fontkit reject every
 * embedded font. Returns true on healthy runtimes (Node 20/22/24, browsers).
 */
function fontParsingHealthy(): boolean {
  try {
    return new TextDecoder("ascii").decode(new Uint8Array([65, 66])) === "AB";
  } catch {
    return false;
  }
}

function fontDir(): string {
  return path.join(process.cwd(), "public", "fonts", "pdf");
}

function tryRegister(): boolean {
  const dir = fontDir();
  const files: Array<[Role, Weight, string]> = [
    ["display", 400, "Playfair-Regular.ttf"],
    ["display", 500, "Playfair-Medium.ttf"],
    ["display", 600, "Playfair-SemiBold.ttf"],
    ["display", 700, "Playfair-Bold.ttf"],
    ["sans", 400, "Inter-Regular.ttf"],
    ["sans", 500, "Inter-Medium.ttf"],
    ["sans", 600, "Inter-SemiBold.ttf"],
    ["sans", 700, "Inter-Bold.ttf"],
    ["mono", 400, "JetBrainsMono-Regular.ttf"],
    ["mono", 500, "JetBrainsMono-Medium.ttf"],
    ["mono", 700, "JetBrainsMono-Bold.ttf"],
  ];
  // Bail early (→ fallback) if the assets aren't on disk in this deploy.
  if (!files.every(([, , f]) => fs.existsSync(path.join(dir, f)))) return false;

  const byRole: Record<Role, Array<{ src: string; fontWeight: Weight }>> = {
    display: [],
    sans: [],
    mono: [],
  };
  for (const [role, weight, file] of files) {
    byRole[role].push({ src: path.join(dir, file), fontWeight: weight });
  }
  (Object.keys(byRole) as Role[]).forEach((role) => {
    Font.register({ family: FAM[role], fonts: byRole[role] });
  });
  // Keep words whole — a premium document never breaks words mid-line.
  Font.registerHyphenationCallback((word) => [word]);
  return true;
}

let registered = false;
export let FONTS_OK = false;

/** Idempotent. Safe to call from any module at import time. */
export function registerPdfFonts(): boolean {
  if (registered) return FONTS_OK;
  registered = true;
  try {
    FONTS_OK = fontParsingHealthy() && tryRegister();
  } catch {
    FONTS_OK = false;
  }
  return FONTS_OK;
}

// Register on import so callers never have to remember to.
registerPdfFonts();

/**
 * Resolve a (role, weight) into an @react-pdf style fragment. In embedded
 * mode this is a custom family + numeric weight; in fallback mode it is the
 * explicit standard-font variant (no numeric weight, which PDF-14 families
 * don't understand).
 */
export function ff(role: Role, weight: Weight = 400): { fontFamily: string; fontWeight?: Weight } {
  if (FONTS_OK) return { fontFamily: FAM[role], fontWeight: weight };
  return { fontFamily: STD[role][weight] };
}

/* ---------------------------------------------------------------- *
 * The reusable type scale. Each entry is a self-contained style     *
 * fragment (font + size + line-height + tracking). Color is applied *
 * by primitives/components so the same scale works on light & dark. *
 * ---------------------------------------------------------------- */

export const type = {
  /** Mono, uppercase, tracked — section eyebrows & data labels. */
  eyebrow: { ...ff("mono", 500), fontSize: 8, letterSpacing: 1.6, textTransform: "uppercase" as const, lineHeight: 1.3 },
  label: { ...ff("mono", 500), fontSize: 7.5, letterSpacing: 1.2, textTransform: "uppercase" as const, lineHeight: 1.35 },
  kicker: { ...ff("mono", 400), fontSize: 7, letterSpacing: 1, lineHeight: 1.4 },
  mono: { ...ff("mono", 400), fontSize: 8.5, letterSpacing: 0.2, lineHeight: 1.45 },

  /** Serif display — cover & section heroes. */
  displayXl: { ...ff("display", 700), fontSize: 40, letterSpacing: -0.6, lineHeight: 1.04 },
  displayLg: { ...ff("display", 600), fontSize: 29, letterSpacing: -0.4, lineHeight: 1.08 },
  title: { ...ff("display", 600), fontSize: 20, letterSpacing: -0.2, lineHeight: 1.16 },
  titleSm: { ...ff("display", 600), fontSize: 15.5, letterSpacing: -0.1, lineHeight: 1.2 },

  /** Serif numerals for stats / big figures. */
  stat: { ...ff("display", 600), fontSize: 25, letterSpacing: -0.3, lineHeight: 1.05 },
  statSm: { ...ff("display", 600), fontSize: 18, letterSpacing: -0.2, lineHeight: 1.05 },

  /** Sans — headings within content & UI. */
  subtitle: { ...ff("sans", 500), fontSize: 12.5, letterSpacing: 0, lineHeight: 1.45 },
  h3: { ...ff("sans", 600), fontSize: 11.5, letterSpacing: 0, lineHeight: 1.3 },
  h4: { ...ff("sans", 600), fontSize: 9.5, letterSpacing: 0.1, lineHeight: 1.3 },

  /** Sans — body copy. */
  lede: { ...ff("sans", 400), fontSize: 12, letterSpacing: 0, lineHeight: 1.55 },
  body: { ...ff("sans", 400), fontSize: 10, letterSpacing: 0, lineHeight: 1.5 },
  bodyStrong: { ...ff("sans", 600), fontSize: 10, letterSpacing: 0, lineHeight: 1.5 },
  bodySm: { ...ff("sans", 400), fontSize: 9, letterSpacing: 0, lineHeight: 1.45 },
  caption: { ...ff("sans", 400), fontSize: 8.5, letterSpacing: 0.1, lineHeight: 1.4 },
  fine: { ...ff("sans", 400), fontSize: 7.5, letterSpacing: 0.1, lineHeight: 1.4 },
} as const;

export type TypeToken = keyof typeof type;
