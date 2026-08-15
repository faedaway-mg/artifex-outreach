// ─────────────────────────────────────────────────────────────────────────────
// Count-up primitive (M2.2) — a reusable Artifex number-reveal shared by review videos (and, later,
// public content + case studies). The measured NUMERIC value animates from a baseline to the exact
// evidence value on the content easing grammar, then the suffix/symbol (+, ★) is appended — symbols are
// never counted. NUMERICAL TRUTH: the endpoint always equals the exact evidence; the eased rise never
// overshoots (ease-out ≤ 1), and intermediate values are clearly reveal-only, not measurements.
// Pure + deterministic → drives the HTML per frame and is unit-testable without a browser.
// ─────────────────────────────────────────────────────────────────────────────
import { EASE, bezier, clamp01, type Bezier } from "./motion";

export interface CountSpec {
  from: number;
  to: number;
  startSec: number;
  endSec: number;
  decimals: number;
  prefix: string;
  suffix: string;
}

/** Parse a stat string into a count spec: "19"→19, "950+"→950 suffix "+", "4.8"→4.8 dec 1,
 *  "4.8★"→4.8 suffix " ★". Returns null when there's no leading number to count. Baseline is 0. */
export function parseStat(s: string): CountSpec | null {
  const m = (s || "").trim().match(/^([^\d.-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const prefix = m[1] ?? "";
  const num = m[2].replace(/,/g, "");
  const rawSuffix = (m[3] ?? "").trim();
  const decimals = num.includes(".") ? (num.split(".")[1]?.length ?? 0) : 0;
  const to = parseFloat(num);
  if (!Number.isFinite(to)) return null;
  // "+" hugs the number ("950+"); a symbol like "★" gets a hair space ("4.8 ★").
  const suffix = !rawSuffix ? "" : rawSuffix.startsWith("+") ? rawSuffix : ` ${rawSuffix}`;
  return { from: 0, to, startSec: 0, endSec: 0, decimals, prefix, suffix };
}

/** The numeric value at `now`, eased. Exactly `from` before start and exactly `to` at/after end — no
 *  overshoot, monotonic. Pure. */
export function countAt(spec: CountSpec, now: number, ease: Bezier = EASE.out): number {
  if (spec.endSec <= spec.startSec) return now >= spec.endSec ? spec.to : spec.from;
  if (now <= spec.startSec) return spec.from;
  if (now >= spec.endSec) return spec.to;
  const u = clamp01((now - spec.startSec) / (spec.endSec - spec.startSec));
  return spec.from + (spec.to - spec.from) * bezier(ease, u);
}

/** Render the counted value with its fixed decimals + prefix/suffix. The suffix ("+"/"★") is applied
 *  to the final string only — never counted. */
export function formatCount(value: number, spec: CountSpec): string {
  const v = spec.decimals > 0 ? value.toFixed(spec.decimals) : String(Math.round(value));
  return `${spec.prefix}${v}${spec.suffix}`;
}

/** Convenience: the displayed string at `now`. */
export function countText(spec: CountSpec, now: number, ease: Bezier = EASE.out): string {
  return formatCount(countAt(spec, now, ease), spec);
}
