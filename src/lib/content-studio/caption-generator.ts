// ─────────────────────────────────────────────────────────────────────────────
// Deterministic social-caption generator. It assembles ONE general caption (Instagram / TikTok /
// LinkedIn / Reels) from a piece's OWN approved content — its title, concept, and narration lines —
// so it can never fabricate a metric, result, offer, or claim: the body is drawn verbatim from the
// script the owner already approved. Hook + context + a natural CTA + a restrained, relevant hashtag
// set, capped at 2200 characters. Pure/deterministic (same input → same caption).
// ─────────────────────────────────────────────────────────────────────────────
import type { Piece } from "./types";

export const CAPTION_MAX = 2200;

/** Input the generator reads — a subset of Piece plus an optional explicit business name (client videos). */
export interface CaptionSource {
  id: string;
  title: string;
  concept: string;
  narration: string[];
  businessName?: string | null;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isClientVideo = (id: string) => id.startsWith("client-");

/** A small, relevant, non-claim hashtag set. Hashtags are topical, never a fabricated result. */
function hashtagsFor(src: CaptionSource): string[] {
  if (isClientVideo(src.id)) return ["#smallbusiness", "#localbusiness", "#website", "#webdesign", "#growth"];
  return ["#buildinpublic", "#startup", "#productdesign", "#founders", "#softwaredevelopment"];
}

/** A natural call to action that makes no promise about a result. */
function ctaFor(src: CaptionSource): string {
  return isClientVideo(src.id)
    ? "If this looks familiar on your own site, I'd be glad to walk you through it — send me a message."
    : "Follow along — we share what we learn as we build this.";
}

/**
 * Build the caption from the approved script only. The HOOK is the piece's strongest opening line
 * (first narration line, else the title); the CONTEXT reuses the next couple of narration lines (else
 * the concept) verbatim — nothing invented. Returns a caption ≤ CAPTION_MAX characters.
 */
export function generateCaption(src: CaptionSource): string {
  const narration = (src.narration ?? []).map(clean).filter(Boolean);
  const title = clean(src.title ?? "");
  const concept = clean(src.concept ?? "");
  const subject = src.businessName ? clean(src.businessName) : null;

  const hook = narration[0] || title || (subject ? `A quick look at ${subject}.` : "A quick look.");
  const contextLines = narration.slice(1, 3);
  const context = contextLines.length ? contextLines.join(" ") : concept;

  const parts = [hook];
  if (context && clean(context) !== clean(hook)) parts.push(context);
  parts.push(ctaFor(src));
  const tags = hashtagsFor(src).join(" ");

  let caption = parts.filter(Boolean).join("\n\n") + "\n\n" + tags;
  if (caption.length > CAPTION_MAX) {
    // Trim the CONTEXT paragraph (never the hook or the tags) to fit, on a word boundary.
    const overflow = caption.length - CAPTION_MAX;
    const trimmed = context.slice(0, Math.max(0, context.length - overflow - 1)).replace(/\s+\S*$/, "").trim();
    caption = [hook, trimmed, ctaFor(src)].filter(Boolean).join("\n\n") + "\n\n" + tags;
    if (caption.length > CAPTION_MAX) caption = caption.slice(0, CAPTION_MAX).trim();
  }
  return caption;
}
