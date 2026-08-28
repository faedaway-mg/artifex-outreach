import { describe, it, expect } from "vitest";
import { renderPersonalEmailHtml, renderPersonalEmailText, type RenderInput } from "./email-render";
import { ARTIFEX_IDENTITY } from "../identity";
import type { Settings } from "../types";

// The accompanying email must offer the SAME booking destination the PDF button uses, keep a reply
// option, and preserve the unsubscribe/contact footer — without a second, conflicting booking link.

const BOOK = ARTIFEX_IDENTITY.bookingUrl;
const settings = { calendarLink: BOOK, businessAddress: "Artifex Labs · Los Angeles, CA", website: "https://artifexlabs.tech", contactEmail: "hello@artifexlabs.tech", outreachSigner: "jordan", signature: "Jordan Jackson\nFounder, Artifex Labs\nartifexlabs.tech" } as unknown as Settings;
const base: RenderInput = { email: { subject: "A quick read on your booking flow", paragraphs: ["Hi — I put together a one-page review of your public booking experience.", "It's attached. No obligation."] } as any, settings, unsubscribeUrl: "https://outreach.artifexlabs.tech/api/comms/unsubscribe?lead=x&token=y" };

describe("email/PDF booking alignment", () => {
  it("HTML: offers the same canonical booking URL, a reply option, and keeps unsubscribe — one destination only", () => {
    const html = renderPersonalEmailHtml({ ...base, cta: { label: "Book a conversation", url: BOOK } });
    expect(html).toContain(BOOK);                              // same destination as the PDF button
    expect(html.toLowerCase()).toContain("reply to this message"); // reply option
    expect(html.toLowerCase()).toContain("unsubscribe");       // compliance preserved
    // exactly one booking destination in the body (no conflicting links)
    expect(html.split(BOOK).length - 1).toBe(1);
  });

  it("TEXT: mirrors the same booking URL + reply option + unsubscribe token", () => {
    const text = renderPersonalEmailText({ ...base, cta: { label: "Book a conversation", url: BOOK } });
    expect(text).toContain(`Book a conversation: ${BOOK}`);
    expect(text.toLowerCase()).toContain("reply to this message");
    expect(text).toContain("unsubscribe"); // token/url present
  });

  it("without a cta (e.g. a plain note) the personal email adds NO booking link", () => {
    const html = renderPersonalEmailHtml(base);
    expect(html.includes(BOOK)).toBe(false);
  });
});
