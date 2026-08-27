import { renderToBuffer } from "@react-pdf/renderer";
import { BriefDocument } from "./BriefDocument";
import { QuickReviewDocument } from "./QuickReviewDocument";
import type { QuickReview } from "@/lib/outreach/quick-review";
import type { Lead, Deliverable, Settings } from "@/lib/types";

/**
 * The embedded PDF font is standard Helvetica (WinAnsi), which has no glyph for
 * symbols like ★ (U+2605) — those render as broken boxes. Sanitize text before
 * rendering: turn rating stars into the safe "4.8 / 5" form and drop star/symbol
 * glyphs Helvetica cannot draw. Latin-1 (accented names, dashes, smart quotes,
 * bullets) is preserved.
 */
function sanitizeText(str: string): string {
  return str
    .replace(/(\d(?:\.\d+)?)\s*[★⭐✦✪]/g, "$1/5")
    .replace(/[★☆⭐✦✪✔✓➔➜]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return sanitizeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepSanitize(v);
    return out as T;
  }
  return value;
}

/** Render a Modernization Brief / Quick Snapshot to a PDF Buffer (Node runtime). */
export async function renderBriefPdf(lead: Lead, deliverable: Deliverable, settings: Settings): Promise<Buffer> {
  const safeLead = deepSanitize(lead);
  const safeDeliverable = deepSanitize(deliverable);
  const safeSettings = deepSanitize(settings);
  return renderToBuffer(BriefDocument({ lead: safeLead, deliverable: safeDeliverable, settings: safeSettings }) as any);
}

/** Render the one-page Artifex Quick Review to a PDF Buffer (Node runtime). Deterministic:
 *  the same review snapshot always yields the same document (WYSIWYS across preview + send). */
export async function renderQuickReviewPdf(review: QuickReview, dateStr: string): Promise<Buffer> {
  const safeReview = deepSanitize(review);
  return renderToBuffer(QuickReviewDocument({ review: safeReview, dateStr }) as any);
}
