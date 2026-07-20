import { describe, it, expect } from "vitest";
import { detectPresence } from "./presence";
import { makeLead } from "./test-lead";
import type { Lead } from "./types";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

describe("Digital presence detection", () => {
  it("recognizes a real website", () => {
    const p = detectPresence(makeLead());
    expect(p.hasWebsite).toBe(true);
    expect(p.profile).toBe("website");
  });

  it("classifies a Facebook-only business (no website)", () => {
    const p = detectPresence(makeLead({ ...noWeb, socialLinks: ["https://facebook.com/rosies"] }));
    expect(p.hasWebsite).toBe(false);
    expect(p.hasFacebook).toBe(true);
    expect(p.profile).toBe("facebook-only");
    expect(p.primaryChannel).toMatch(/facebook/i);
  });

  it("classifies an Instagram-only business", () => {
    const p = detectPresence(makeLead({ ...noWeb, socialLinks: ["https://instagram.com/summit"] }));
    expect(p.profile).toBe("instagram-only");
  });

  it("classifies a Yelp-only business", () => {
    const p = detectPresence(makeLead({ ...noWeb, socialLinks: ["https://yelp.com/biz/copper-oak"] }));
    expect(p.hasYelp).toBe(true);
    expect(p.profile).toBe("yelp-only");
  });

  it("classifies a Google-Business-only business", () => {
    const p = detectPresence(makeLead({ ...noWeb, googleMapsUrl: "https://maps.google.com/?cid=9" }));
    expect(p.hasGoogleBusiness).toBe(true);
    expect(p.profile).toBe("google-only");
  });

  it("classifies an invisible business (name and phone, little else)", () => {
    const p = detectPresence(makeLead({ ...noWeb }));
    expect(p.profile).toBe("invisible");
    expect(p.modernizationOpportunities.length).toBeGreaterThan(0);
  });

  it("treats a social page listed as a website as NOT an owned website", () => {
    const p = detectPresence(makeLead({ website: "https://facebook.com/thebiz", websiteDomain: "facebook.com", googleMapsUrl: null, socialLinks: [] }));
    expect(p.hasWebsite).toBe(false);
    expect(p.hasFacebook).toBe(true);
    expect(p.profile).toBe("facebook-only");
  });

  it("detects an online booking / appointment tool from any visible URL", () => {
    const p = detectPresence(makeLead({ ...noWeb, socialLinks: ["https://instagram.com/bloom", "https://calendly.com/bloom"] }));
    expect(p.hasOnlineBooking).toBe(true);
    expect(p.appointmentTool).toBe("Calendly");
  });

  it("honors website signals for booking when provided", () => {
    const p = detectPresence(makeLead(), { hasWebsite: true, mobileFriendly: true, slowLoad: false, hasOnlineBooking: true, hasLeadForm: true });
    expect(p.hasOnlineBooking).toBe(true);
  });

  it("infers appointment-driven from the industry when no tool is present", () => {
    const p = detectPresence(makeLead({ industry: "Dental practice" }));
    expect(p.appointmentDriven).toBe(true);
  });

  it("flags multiple locations", () => {
    const p = detectPresence(makeLead({ locationsCount: 4 }));
    expect(p.multipleLocations).toBe(true);
    expect(p.locationsCount).toBe(4);
  });

  it("grades review strength honestly", () => {
    expect(detectPresence(makeLead({ reviewCount: 0, rating: 0 })).reviews.strength).toBe("none");
    expect(detectPresence(makeLead({ reviewCount: 5, rating: 4.5 })).reviews.strength).toBe("thin");
    expect(detectPresence(makeLead({ reviewCount: 40, rating: 4.2 })).reviews.strength).toBe("solid");
    expect(detectPresence(makeLead({ reviewCount: 220, rating: 4.8 })).reviews.strength).toBe("strong");
  });

  it("surfaces the reputation-not-owned opportunity when a strong reputation has no owned site", () => {
    const p = detectPresence(makeLead({ ...noWeb, socialLinks: ["https://yelp.com/biz/x"], reviewCount: 200, rating: 4.7 }));
    expect(p.modernizationOpportunities.join(" ")).toMatch(/doesn't own|control/i);
  });
});
