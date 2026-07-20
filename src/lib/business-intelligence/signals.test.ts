import { describe, it, expect } from "vitest";
import { buildContext } from "./context";
import { ALL_SIGNALS, SIGNALS_BY_DIMENSION } from "./signals";
import { DIMENSIONS } from "./types";
import { makeLead } from "../test-lead";
import { analyzeWebsitePages } from "../intelligence/providers/website-intelligence";
import { RICH_HOMEPAGE } from "./fixtures";
import type { Lead } from "../types";
import type { SignalReading, ProfileContext } from "./types";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

function readings(ctx: ProfileContext): SignalReading[] {
  return ALL_SIGNALS.map((s) => s.evaluate(ctx)).filter((r): r is SignalReading => r !== null);
}
function reading(ctx: ProfileContext, key: string): SignalReading | undefined {
  return readings(ctx).find((r) => r.key === key);
}

describe("Signals — registry integrity", () => {
  it("every signal has a unique key and belongs to its dimension array", () => {
    const keys = new Set<string>();
    for (const dim of DIMENSIONS) {
      for (const s of SIGNALS_BY_DIMENSION[dim]) {
        expect(s.dimension).toBe(dim);
        expect(keys.has(s.key)).toBe(false);
        keys.add(s.key);
      }
    }
    expect(keys.size).toBe(ALL_SIGNALS.length);
  });
});

describe("Signals — digital presence", () => {
  it("states the absence of a website honestly and skips website-only signals", () => {
    const ctx = buildContext({ lead: makeLead({ ...noWeb, socialLinks: ["https://facebook.com/x"] }) });
    const wq = reading(ctx, "website-quality")!;
    expect(wq.status).toBe("absent");
    expect(reading(ctx, "mobile-friendliness")).toBeUndefined();
    expect(reading(ctx, "navigation-quality")).toBeUndefined();
    expect(reading(ctx, "accessibility")).toBeUndefined();
  });

  it("emits page speed ONLY when it is measurable", () => {
    const withSignals = buildContext({ lead: makeLead(), websiteSignals: { hasWebsite: true, mobileFriendly: true, slowLoad: true, hasOnlineBooking: false, hasLeadForm: true } });
    expect(reading(withSignals, "page-speed")?.status).toBe("weak");
    const noSignals = buildContext({ lead: makeLead() }); // website but no speed signal
    expect(reading(noSignals, "page-speed")).toBeUndefined();
  });

  it("reads booking friction from an appointment-driven business with no booking", () => {
    const ctx = buildContext({ lead: makeLead({ industry: "Dental practice", website: null, socialLinks: [] }) });
    expect(reading(ctx, "booking-friction")?.status).toBe("weak");
  });

  it("credits online booking when a tool is present", () => {
    const ctx = buildContext({ lead: makeLead({ website: null, socialLinks: ["https://calendly.com/x"] }) });
    expect(reading(ctx, "booking-friction")?.status).toBe("strong");
  });
});

describe("Signals — discovery", () => {
  it("flags a missing Google Business Profile", () => {
    const ctx = buildContext({ lead: makeLead({ ...noWeb }) });
    expect(reading(ctx, "google-business-completeness")?.status).toBe("absent");
  });
  it("says there is no rankable property without a website", () => {
    const ctx = buildContext({ lead: makeLead({ ...noWeb, socialLinks: ["https://instagram.com/x"] }) });
    expect(reading(ctx, "seo-strength")?.status).toBe("absent");
  });
  it("finds SEO foundations when the site is analyzed", () => {
    const ctx = buildContext({ lead: makeLead(), evidence: analyzeWebsitePages([{ url: "https://x.com", html: RICH_HOMEPAGE }]) });
    expect(["strong", "adequate"]).toContain(reading(ctx, "seo-strength")?.status);
  });
});

describe("Signals — customer experience", () => {
  it("does not fabricate review recency, but flags it unknown when reviews exist", () => {
    const withReviews = buildContext({ lead: makeLead({ reviewCount: 40, rating: 4.5 }) });
    expect(reading(withReviews, "review-recency")?.status).toBe("unknown");
    const noReviews = buildContext({ lead: makeLead({ reviewCount: 0, rating: 0 }) });
    expect(reading(noReviews, "review-recency")).toBeUndefined();
  });
  it("marks review quality absent with no reviews", () => {
    const ctx = buildContext({ lead: makeLead({ reviewCount: 0, rating: 0 }) });
    expect(reading(ctx, "review-quality")?.status).toBe("absent");
  });
});

describe("Signals — operations", () => {
  it("observes multiple locations", () => {
    const ctx = buildContext({ lead: makeLead({ locationsCount: 3 }) });
    const r = reading(ctx, "multiple-locations")!;
    expect(r.summary).toMatch(/3 locations/);
  });
  it("infers a manual appointment workflow, with honest low confidence", () => {
    const ctx = buildContext({ lead: makeLead({ industry: "Dental practice", website: null, socialLinks: [] }) });
    const r = reading(ctx, "appointment-workflow")!;
    expect(r.status).toBe("weak");
    expect(r.confidence.label).toBe("Inferred");
  });
  it("only asserts hiring when it is actually observed", () => {
    expect(reading(buildContext({ lead: makeLead() }), "hiring-activity")).toBeUndefined();
    const ctx = buildContext({ lead: makeLead(), evidence: analyzeWebsitePages([{ url: "https://x.com", html: '<html><body>We are hiring! Careers</body></html>' }]) });
    expect(reading(ctx, "hiring-activity")?.status).toBe("strong");
  });
});
