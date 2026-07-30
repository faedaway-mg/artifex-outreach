import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebsiteLink } from "./WebsiteLink";
import { PhoneCopyButton } from "./PhoneCopyButton";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("WebsiteLink — safe, tappable business website", () => {
  it("renders a bare domain as a new-tab external anchor with https://", () => {
    const out = html(createElement(WebsiteLink, { url: "villabrasilmotel.com", domain: "villabrasilmotel.com", businessName: "Villa Brasil Motel" }));
    expect(out).toContain('href="https://villabrasilmotel.com"'); // not an internal relative route
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"'); // window.opener protection
    expect(out).toContain('aria-label="Open Villa Brasil Motel website in a new tab"');
  });

  it("preserves an existing https URL with its path/query", () => {
    const out = html(createElement(WebsiteLink, { url: "https://x.com/rooms?id=2#book", businessName: "X" }));
    expect(out).toContain('href="https://x.com/rooms?id=2#book"');
  });

  it("does NOT render a live anchor for an unsafe or malformed value", () => {
    const unsafe = html(createElement(WebsiteLink, { url: "javascript:alert(1)", businessName: "X" }));
    expect(unsafe).not.toContain("href=");
    expect(unsafe).not.toContain("<a ");
    const bad = html(createElement(WebsiteLink, { url: "not a url", businessName: "X" }));
    expect(bad).not.toContain("href=");
  });

  it("shows the display domain text", () => {
    const out = html(createElement(WebsiteLink, { url: "https://www.villabrasilmotel.com", domain: "villabrasilmotel.com", businessName: "Villa" }));
    expect(out).toContain("villabrasilmotel.com");
  });
});

describe("PhoneCopyButton — one-tap copy control", () => {
  it("renders a real button with an accessible name and a live region", () => {
    const out = html(createElement(PhoneCopyButton, { phone: "(310) 876-7789", businessName: "Villa Brasil Motel", variant: "button" }));
    expect(out).toContain("<button");
    expect(out).toContain('aria-label="Copy Villa Brasil Motel phone number"');
    expect(out).toContain("Copy number for Google Voice");
    expect(out).toContain('aria-live="polite"'); // success/failure announced to assistive tech
  });

  it("labels the icon variant with the number when no business name is given", () => {
    const out = html(createElement(PhoneCopyButton, { phone: "(310) 876-7789" }));
    expect(out).toContain("<button");
    expect(out).toContain('aria-label="Copy phone number (310) 876-7789"');
  });

  it("renders nothing when there is no dialable phone (no empty control)", () => {
    expect(html(createElement(PhoneCopyButton, { phone: null }))).toBe("");
    expect(html(createElement(PhoneCopyButton, { phone: "" }))).toBe("");
    expect(html(createElement(PhoneCopyButton, { phone: "call us" }))).toBe("");
  });
});
