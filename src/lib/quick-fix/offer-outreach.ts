// ─────────────────────────────────────────────────────────────────────────────
// OFFER OUTREACH — compose the FIRST-TOUCH message body for an eligible offer.
//
// The first-touch email is EVIDENCE-FIRST / VALUE-BEFORE-PRICE. Its job is:
//
//   OPEN → RELEVANCE → PROOF OF EFFORT → CLICK
//
//   • OPEN: the FIRST sentence is experienceFrameForOffer(offer).emailOpener — the
//     ONE shared attempted-use / observed-friction claim (never fabricated; honest
//     observation when the defect implies no attempt). It is NEVER a default like
//     "We reviewed your website" / "We analyzed…" / "During our audit…".
//   • PROOF OF EFFORT: a single line signalling real work — but only claiming the
//     video and/or PDF that ACTUALLY exist for this offer (the personalized video is
//     always MISSING today, so we do not claim a video unless one exists; we only
//     claim the PDF when it is attached or linked).
//   • CLICK: friendly link LABELS only ("Watch the website review →" / "See what I
//     found →" / optional "Prefer to talk first? Book a conversation →"). NO raw
//     offer/video/booking URLs appear in the customer-visible body; hrefs stay right.
//
// PRICE is REMOVED from the default first-touch body — the email earns the click, the
// offer page does the selling. The signature (configured sender identity) and the
// downstream CAN-SPAM unsubscribe footer are preserved.
//
// PURE. It returns text/html; it does NOT send. The existing compliant transport
// + safe-hold + recipient gates remain the only path that can ever dispatch. When
// an offer is NOT quick-fix eligible, the composer emits a book-a-conversation
// message with no purchase CTA — the system knowing when not to productize.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { containsFabricatedClaim } from "./evidence-gate";
import { generateSubjectCandidates } from "./subject-engine";
import { experienceFrameForOffer } from "./experience-frame";
import type { PdfDisposition, VideoDisposition } from "./email-attachment-policy";
import { ARTIFEX_IDENTITY } from "../identity";

/**
 * The single source of the first-touch subject for an offer. SUPERSEDES the old
 * `"${offerName} — ${price}"` / `"A quick note on ${company}"` branches: a subject
 * is now DERIVED (via the curiosity-first engine) from the same real, evidence-
 * graded defect the offer is built on — never the price, never the company name.
 * Pure; returns the engine's deterministic primary.
 */
export function offerSubject(offer: QuickFixOffer): string {
  return generateSubjectCandidates({
    observation: offer.scope.problemBeingSolved,
    context: `${offer.scope.proposedSolution} ${offer.scope.offerName}`,
    // No category available on the assembled offer; the observation text carries the
    // evidence. Company name stays OFF by construction (default first-touch).
  }).primary;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export interface OfferOutreachLinks {
  buyUrl: string; // Path A — the customer offer/checkout page ("Watch the review →")
  bookingUrl: string; // Path B — book a conversation
  /** Optional dedicated URL where the personalized video plays. Falls back to buyUrl. */
  videoUrl?: string;
}

/**
 * Which proof-of-effort assets ACTUALLY exist for this offer, so the effort line only
 * claims what's real. Defaults are conservative: the personalized video is MISSING
 * (no pipeline) and the PDF is LINKED (the offer page always hosts a renderable PDF
 * when findings exist). Callers with a built manifest should pass the real values.
 */
export interface OutreachAssets {
  pdf: PdfDisposition; // ATTACHED | LINKED | MISSING
  video: VideoDisposition; // LINKED | MISSING
}

const DEFAULT_ASSETS: OutreachAssets = { pdf: "LINKED", video: "MISSING" };

/** Configured sender identity for the signature. Defaults to the Artifex identity. */
export interface SenderIdentity {
  name: string;
  company: string;
}

const DEFAULT_SENDER: SenderIdentity = {
  name: ARTIFEX_IDENTITY.mailSenderName, // "Jordan Jackson"
  company: ARTIFEX_IDENTITY.companyName, // "Artifex Labs"
};

export interface ComposeOptions {
  assets?: OutreachAssets;
  sender?: SenderIdentity;
}

export interface OfferOutreachCopy {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  primaryCta: "PURCHASE" | "BOOK_A_CONVERSATION";
  safe: boolean; // fabrication guard — caller must block if false
}

/** The signature block (configured sender identity). Matches the downstream dedup
 *  pattern (name\ncompany) so the transport signature assembler won't double-add. */
function signature(sender: SenderIdentity): { text: string; html: string } {
  return {
    text: `${sender.name}\n${sender.company}`,
    html: `<p>${escapeHtml(sender.name)}<br/>${escapeHtml(sender.company)}</p>`,
  };
}

/**
 * The proof-of-effort sentence. It claims the video and/or PDF ONLY when they exist.
 * Never fabricates an artifact: no video is claimed unless one exists; the PDF is
 * claimed as "attached" only when ATTACHED, as "a one-page review" when LINKED, and
 * not at all when MISSING. Returns null when there is nothing real to claim.
 */
function effortLine(assets: OutreachAssets): string | null {
  const hasVideo = assets.video === "LINKED";
  const hasPdf = assets.pdf === "ATTACHED" || assets.pdf === "LINKED";
  const pdfClause = assets.pdf === "ATTACHED"
    ? "attached a one-page review with screenshots from your site"
    : "put together a one-page review with screenshots from your site";

  if (hasVideo && hasPdf) {
    return `I made a short video showing exactly what I ran into, and ${pdfClause}.`;
  }
  if (hasVideo) {
    return "I made a short video showing exactly what I ran into.";
  }
  if (hasPdf) {
    // No video exists — do not claim one.
    return `I ${pdfClause}.`;
  }
  return null;
}

export function composeOfferOutreach(offer: QuickFixOffer, links: OfferOutreachLinks, opts: ComposeOptions = {}): OfferOutreachCopy {
  const assets = opts.assets ?? DEFAULT_ASSETS;
  const sender = opts.sender ?? DEFAULT_SENDER;
  const sig = signature(sender);
  const subject = offerSubject(offer); // curiosity-first engine — never "name — $price"

  if (!offer.quickFixEligible) {
    // Not productizable → conversation only. No price, no buy button. The opener is
    // STILL the shared experience frame (never a fabricated "we reviewed…" default).
    const opener = experienceFrameForOffer(offer).emailOpener;
    const bridge = "It looks a bit broader than a single fixed-price fix, so I'd rather talk it through than sell you something off the shelf.";
    const bodyText = [opener, bridge, `Prefer to talk first? Book a conversation →`, sig.text].join("\n\n");
    const bodyHtml =
      `<p>${escapeHtml(opener)}</p>` +
      `<p>${escapeHtml(bridge)}</p>` +
      `<p><a href="${escapeHtml(links.bookingUrl)}">Prefer to talk first? Book a conversation →</a></p>` +
      sig.html;
    return { subject, bodyText, bodyHtml, primaryCta: "BOOK_A_CONVERSATION", safe: !containsFabricatedClaim(bodyText) };
  }

  // ── DEFAULT FIRST-TOUCH: OPEN → RELEVANCE → PROOF OF EFFORT → CLICK ─────────────
  // 1) OPEN: the shared experience-frame opener, verbatim, as the FIRST sentence.
  const opener = experienceFrameForOffer(offer).emailOpener;
  // 2) PROOF OF EFFORT: claim only the assets that actually exist.
  const effort = effortLine(assets);

  // Link labels are friendly and understated — NO raw URLs in the visible body.
  const reviewLabel = "Watch the website review →";
  const foundLabel = "See what I found →";
  const bookLabel = "Prefer to talk first? Book a conversation →";
  // The video plays where a dedicated video URL is given, else the offer page.
  const reviewHref = assets.video === "LINKED" ? (links.videoUrl ?? links.buyUrl) : links.buyUrl;
  // Primary CTA label depends on whether a video exists to "watch".
  const primaryLabel = assets.video === "LINKED" ? reviewLabel : foundLabel;

  const textLines: string[] = [opener];
  if (effort) textLines.push(effort);
  textLines.push(primaryLabel);
  textLines.push(bookLabel);
  textLines.push(sig.text);
  const bodyText = textLines.join("\n\n");

  const bodyHtml =
    `<p>${escapeHtml(opener)}</p>` +
    (effort ? `<p>${escapeHtml(effort)}</p>` : "") +
    `<p><a href="${escapeHtml(reviewHref)}" style="font-weight:600">${escapeHtml(primaryLabel)}</a></p>` +
    `<p><a href="${escapeHtml(links.bookingUrl)}">${escapeHtml(bookLabel)}</a></p>` +
    sig.html;

  // Defense in depth: never emit an invented business-impact claim.
  const safe = !containsFabricatedClaim(bodyText);
  return { subject, bodyText, bodyHtml, primaryCta: "PURCHASE", safe };
}

export interface FollowUpState {
  offerViewed: boolean;
  checkoutStarted: boolean;
}

/**
 * SKU-SPECIFIC follow-up — concrete, references the exact finding/SKU/price. Never
 * "just following up", never invents new scope or a new price. Pure; does not send.
 */
export function composeFollowUp(offer: QuickFixOffer, links: OfferOutreachLinks, state: FollowUpState): OfferOutreachCopy {
  if (!offer.quickFixEligible) {
    const line = `Following up on ${offer.companyName} — the item we spotted is worth a short conversation.`;
    return { subject: `Re: ${offer.companyName}`, bodyText: `${line}\n\n${links.bookingUrl}`, bodyHtml: `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(links.bookingUrl)}">Book a conversation</a></p>`, primaryCta: "BOOK_A_CONVERSATION", safe: true };
  }
  const price = dollars(offer.priceCents);
  const opener = state.checkoutStarted
    ? `You started checkout for the ${offer.scope.offerName} — happy to help you finish or answer anything first.`
    : state.offerViewed
      ? `Following up on the ${offer.scope.offerName} for the issue we found — it's still ready when you are.`
      : `We wanted to make sure you saw the ${offer.scope.offerName} we put together for the issue we found on your site.`;
  const subject = `${offer.scope.offerName} — still ${price} flat`;
  const bodyText = [opener, `${price} flat. ${offer.scope.deliveryWindow}`, `Get this fixed: ${links.buyUrl}`, `Prefer to talk first? ${links.bookingUrl}`].join("\n\n");
  const bodyHtml = `<p>${escapeHtml(opener)}</p><p>${escapeHtml(`${price} flat. ${offer.scope.deliveryWindow}`)}</p><p><a href="${escapeHtml(links.buyUrl)}">Get this fixed — ${escapeHtml(price)}</a></p><p><a href="${escapeHtml(links.bookingUrl)}">Or book a conversation</a></p>`;
  return { subject, bodyText, bodyHtml, primaryCta: "PURCHASE", safe: !containsFabricatedClaim(bodyText) };
}
