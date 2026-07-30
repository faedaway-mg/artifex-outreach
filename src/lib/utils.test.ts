import { describe, it, expect } from "vitest";
import { normalizeExternalUrl, toDialable } from "./utils";

describe("normalizeExternalUrl — safe, clickable business websites", () => {
  it("prepends https:// to a bare domain (never an internal relative route)", () => {
    expect(normalizeExternalUrl("villabrasilmotel.com")).toBe("https://villabrasilmotel.com");
  });
  it("prepends https:// to a www domain", () => {
    expect(normalizeExternalUrl("www.villabrasilmotel.com")).toBe("https://www.villabrasilmotel.com");
  });
  it("leaves existing https:// unchanged", () => {
    expect(normalizeExternalUrl("https://villabrasilmotel.com")).toBe("https://villabrasilmotel.com");
  });
  it("preserves an explicit http:// protocol", () => {
    expect(normalizeExternalUrl("http://villabrasilmotel.com")).toBe("http://villabrasilmotel.com");
  });
  it("preserves paths, query strings, and fragments", () => {
    expect(normalizeExternalUrl("x.com/rooms?id=2#book")).toBe("https://x.com/rooms?id=2#book");
    expect(normalizeExternalUrl("https://sub.x.co.uk/a/b?q=1")).toBe("https://sub.x.co.uk/a/b?q=1");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeExternalUrl("  villabrasilmotel.com  ")).toBe("https://villabrasilmotel.com");
  });
  it("rejects unsafe schemes", () => {
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("data:text/html,<script>")).toBeNull();
    expect(normalizeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeExternalUrl("  javascript:alert(1)")).toBeNull();
  });
  it("rejects malformed / non-host values (no dangerous or dead links)", () => {
    expect(normalizeExternalUrl("not a url")).toBeNull();
    expect(normalizeExternalUrl("localhost")).toBeNull(); // no dot → not a public site
    expect(normalizeExternalUrl("")).toBeNull();
    expect(normalizeExternalUrl(null)).toBeNull();
    expect(normalizeExternalUrl("   ")).toBeNull();
  });
});

describe("toDialable — one dialable value for tel: and clipboard", () => {
  it("strips decorative formatting from a US number", () => {
    expect(toDialable("(310) 876-7789")).toBe("3108767789");
  });
  it("preserves an existing country code", () => {
    expect(toDialable("+1 (310) 876-7789")).toBe("+13108767789");
  });
  it("does not fabricate a US country code for an international number", () => {
    expect(toDialable("+52 55 1234 5678")).toBe("+525512345678");
    expect(toDialable("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("trims whitespace and drops labels/punctuation noise", () => {
    expect(toDialable("  310.876.7789  ")).toBe("3108767789");
  });
  it("returns empty for nothing dialable", () => {
    expect(toDialable("")).toBe("");
    expect(toDialable(null)).toBe("");
    expect(toDialable("call us")).toBe("");
  });
  it("matches the existing tel: normalization for the common case", () => {
    const raw = "(310) 876-7789";
    expect(toDialable(raw)).toBe(raw.replace(/[^\d+]/g, ""));
  });
});
