// ─────────────────────────────────────────────────────────────────────────────
// OFFER OUTREACH — compose the dual-CTA message body for an eligible offer.
//
//   OBSERVATION + SPECIFIC FIX + PRICE + TURNAROUND + BUY CTA (Path A)
//                                                     + BOOK CTA (Path B)
//
// PURE. It returns text/html; it does NOT send. The existing compliant transport
// + safe-hold + recipient gates remain the only path that can ever dispatch. When
// an offer is NOT quick-fix eligible, the composer emits a book-a-conversation
// message with no purchase CTA — the system knowing when not to productize.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { containsFabricatedClaim } from "./evidence-gate";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export interface OfferOutreachLinks {
  buyUrl: string; // Path A — the customer offer/checkout page
  bookingUrl: string; // Path B — book a conversation
}

export interface OfferOutreachCopy {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  primaryCta: "PURCHASE" | "BOOK_A_CONVERSATION";
  safe: boolean; // fabrication guard — caller must block if false
}

export function composeOfferOutreach(offer: QuickFixOffer, links: OfferOutreachLinks): OfferOutreachCopy {
  if (!offer.quickFixEligible) {
    // Not productizable → conversation only. No price, no buy button.
    const subject = `A quick note on ${offer.companyName}`;
    const line = "While reviewing your site we spotted something worth a short conversation — it's a bit broader than a fixed-price fix.";
    const bodyText = `${line}\n\nIf you're open to it: ${links.bookingUrl}`;
    const bodyHtml = `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(links.bookingUrl)}">Book a conversation</a></p>`;
    return { subject, bodyText, bodyHtml, primaryCta: "BOOK_A_CONVERSATION", safe: !containsFabricatedClaim(bodyText) };
  }

  const price = dollars(offer.priceCents);
  const subject = `${offer.scope.offerName} — ${price}`;
  const paras = [
    offer.scope.problemBeingSolved,
    `We can fix that with our ${offer.scope.offerName}.`,
    `${price} flat. ${offer.scope.deliveryWindow}`,
  ];
  const bodyText = [
    ...paras,
    `Get this fixed: ${links.buyUrl}`,
    `Prefer to talk first? Book a conversation: ${links.bookingUrl}`,
  ].join("\n\n");

  const bodyHtml =
    paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    `<p><a href="${escapeHtml(links.buyUrl)}" style="font-weight:600">Get this fixed — ${escapeHtml(price)}</a></p>` +
    `<p><a href="${escapeHtml(links.bookingUrl)}">Or book a conversation</a></p>`;

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
