// ─────────────────────────────────────────────────────────────────────────────
// Acquisition provenance — where did this business come from?
//
// The smallest DURABLE first-class provenance that needs NO schema migration: it
// standardizes the existing free-text `lead.source` column into canonical channels
// and preserves a content/campaign id when there is one. That is enough to answer the
// only question this milestone requires — "did this Review request come from Content
// #001?" — without building a generalized attribution platform.
//
// A dedicated enum column is the future G1 gate (needs a coordinated migration); until
// then, `source` is the source of truth and these helpers are the reader/writer.
// ─────────────────────────────────────────────────────────────────────────────

/** The channels an acquisition can originate from. */
export type AcquisitionChannel = "outbound" | "organic-content" | "inbound" | "referral" | "paid";

// The stable prefix that marks an inbound Business Technology Review request in `source`.
const INBOUND_REVIEW_PREFIX = "inbound-review";

/** Sanitize a campaign/content ref from a URL (?ref=content-001) — lowercase, safe chars, bounded. */
export function sanitizeRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const clean = ref.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 48);
  return clean || null;
}

/**
 * The canonical `source` string for an inbound Review request. Encodes the channel implied
 * by the ref (a "content" prefix means organic content; "ref"/"referral"/"partner" means
 * referral; "paid"/"ad" means paid; otherwise plain inbound/direct) and preserves the exact
 * ref so a specific piece (content-001) is always recoverable.
 * Example: reviewRequestSource("content-001") returns "inbound-review:content-001".
 */
export function reviewRequestSource(ref: string | null | undefined): string {
  const clean = sanitizeRef(ref);
  return clean ? `${INBOUND_REVIEW_PREFIX}:${clean}` : `${INBOUND_REVIEW_PREFIX}:direct`;
}

/** Classify any lead `source` into a canonical acquisition channel. */
export function acquisitionChannelOf(source: string | null | undefined): AcquisitionChannel {
  const s = (source ?? "").toLowerCase();
  if (s.startsWith(INBOUND_REVIEW_PREFIX)) {
    const tag = s.split(":")[1] ?? "";
    if (tag.startsWith("content")) return "organic-content";
    if (tag.startsWith("ref") || tag.startsWith("referral") || tag.startsWith("partner")) return "referral";
    if (tag.startsWith("paid") || tag.startsWith("ad")) return "paid";
    return "inbound"; // direct / unattributed inbound
  }
  if (s.startsWith("paid") || s.startsWith("ad:")) return "paid";
  if (s.startsWith("referral") || s.startsWith("partner")) return "referral";
  // Everything else (Google Places auto, Manual, internal-test) is operator-initiated outbound.
  return "outbound";
}

/** The content/campaign id behind a lead, if any (e.g. "content-001"). Null for outbound. */
export function contentIdOf(source: string | null | undefined): string | null {
  const s = (source ?? "").toLowerCase();
  if (!s.startsWith(INBOUND_REVIEW_PREFIX)) return null;
  const tag = s.split(":")[1] ?? "";
  return tag && tag !== "direct" ? tag : null;
}

/** True when this lead came from Content #001 specifically. */
export function isFromContent001(source: string | null | undefined): boolean {
  return contentIdOf(source) === "content-001";
}
