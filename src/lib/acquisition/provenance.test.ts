import { describe, it, expect } from "vitest";
import { sanitizeRef, reviewRequestSource, acquisitionChannelOf, contentIdOf, isFromContent001 } from "./provenance";

describe("acquisition provenance — first-class over the existing source column, no migration", () => {
  it("sanitizes a ref to safe, bounded characters", () => {
    expect(sanitizeRef("Content-001")).toBe("content-001");
    expect(sanitizeRef("a b<script>")).toBe("abscript");
    expect(sanitizeRef("")).toBeNull();
    expect(sanitizeRef(null)).toBeNull();
    expect(sanitizeRef("x".repeat(100))!.length).toBe(48);
  });

  it("builds a canonical inbound source string, defaulting to direct", () => {
    expect(reviewRequestSource("content-001")).toBe("inbound-review:content-001");
    expect(reviewRequestSource(null)).toBe("inbound-review:direct");
  });

  it("classifies any source into a canonical acquisition channel", () => {
    expect(acquisitionChannelOf("inbound-review:content-001")).toBe("organic-content");
    expect(acquisitionChannelOf("inbound-review:referral-jane")).toBe("referral");
    expect(acquisitionChannelOf("inbound-review:paid-linkedin")).toBe("paid");
    expect(acquisitionChannelOf("inbound-review:direct")).toBe("inbound");
    expect(acquisitionChannelOf("Google Places (auto)")).toBe("outbound");
    expect(acquisitionChannelOf("Manual")).toBe("outbound");
    expect(acquisitionChannelOf(null)).toBe("outbound");
  });

  it("recovers the content id and answers 'did this come from Content #001?'", () => {
    expect(contentIdOf("inbound-review:content-001")).toBe("content-001");
    expect(contentIdOf("inbound-review:direct")).toBeNull();
    expect(contentIdOf("Google Places (auto)")).toBeNull();
    expect(isFromContent001("inbound-review:content-001")).toBe(true);
    expect(isFromContent001("inbound-review:content-002")).toBe(false);
    expect(isFromContent001("Google Places (auto)")).toBe(false);
  });
});
