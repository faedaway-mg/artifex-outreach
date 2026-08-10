import { describe, it, expect } from "vitest";
import { contentDisposition } from "./http";

// The production blank-preview bug: a filename with an em dash (U+2014) is > 255, so putting
// it raw in a Content-Disposition header made `new Response({ headers })` throw a ByteString
// error → a blank 500. These pin the fix.
describe("contentDisposition — safe for non-ASCII filenames (em dash, etc.)", () => {
  const NAME = "Villa Brasil Motel — Artifex Quick Review.pdf";

  it("does NOT throw when used as a real Response header (the exact prod failure)", () => {
    expect(() => new Response("x", { headers: { "Content-Disposition": contentDisposition(NAME) } })).not.toThrow();
  });

  it("produces a header value that is pure Latin1 (every char <= 255)", () => {
    const v = contentDisposition(NAME, "inline");
    for (const ch of v) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(255);
  });

  it("carries an ASCII fallback AND a UTF-8 filename* with the original name", () => {
    const v = contentDisposition(NAME, "attachment");
    expect(v.startsWith("attachment;")).toBe(true);
    expect(v).toContain('filename="Villa Brasil Motel - Artifex Quick Review.pdf"'); // em dash → hyphen
    expect(v).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(v.split("filename*=UTF-8''")[1])).toBe(NAME); // exact original recoverable
  });

  it("round-trips through a Response and is retrievable", () => {
    const res = new Response("x", { headers: { "Content-Disposition": contentDisposition(NAME) } });
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''");
  });
});
