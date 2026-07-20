import { describe, it, expect } from "vitest";
import { detectPresence } from "./presence";
import { openingConversation } from "./conversation-engine";
import { analyzeStyle } from "./style-checker";
import { makeLead } from "./test-lead";
import type { Lead } from "./types";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

// A deliberately diverse cross-section of real SMB shapes.
const BUSINESSES: Array<{ label: string; profile: string; lead: Partial<Lead> }> = [
  { label: "Dental practice + website", profile: "website", lead: { businessName: "Taylor Family Dental", industry: "Dental practice" } },
  { label: "Fitness gym, Instagram-only", profile: "instagram-only", lead: { ...noWeb, businessName: "Summit Strength", industry: "Fitness gym", socialLinks: ["https://instagram.com/summit"] } },
  { label: "Diner, Facebook-only", profile: "facebook-only", lead: { ...noWeb, businessName: "Rosie's Diner", industry: "Restaurant", socialLinks: ["https://facebook.com/rosies"] } },
  { label: "Cigar lounge, Yelp-only", profile: "yelp-only", lead: { ...noWeb, businessName: "Copper & Oak", industry: "Cigar lounge", socialLinks: ["https://yelp.com/biz/copper-oak"], rating: 4.8, reviewCount: 220 } },
  { label: "HVAC, Google-only", profile: "google-only", lead: { ...noWeb, businessName: "Valley Air Pros", industry: "HVAC contractor", googleMapsUrl: "https://maps.google.com/?cid=9", rating: 4.6, reviewCount: 75 } },
  { label: "Barber, invisible", profile: "invisible", lead: { ...noWeb, businessName: "Fade District", industry: "Barber shop", rating: 0, reviewCount: 0 } },
  { label: "Salon, IG + Calendly booking", profile: "instagram-only", lead: { ...noWeb, businessName: "Bloom Salon", industry: "Hair salon", socialLinks: ["https://instagram.com/bloom", "https://calendly.com/bloom"] } },
  { label: "Law firm, multi-location website", profile: "website", lead: { businessName: "Hargrove & Associates", industry: "Law firm", locationsCount: 3 } },
  { label: "Coffee shop, FB + IG (social-only)", profile: "social-only", lead: { ...noWeb, businessName: "Third Rail Coffee", industry: "Coffee shop", socialLinks: ["https://facebook.com/thirdrail", "https://instagram.com/thirdrail"] } },
  { label: "Roofing, Google-only, appt-driven", profile: "google-only", lead: { ...noWeb, businessName: "Ironclad Roofing", industry: "Roofing contractor", googleMapsUrl: "https://maps.google.com/?cid=3", rating: 4.9, reviewCount: 140 } },
  { label: "Accountant + website", profile: "website", lead: { businessName: "Meridian Tax", industry: "Accounting firm" } },
  { label: "Tattoo studio, IG-only", profile: "instagram-only", lead: { ...noWeb, businessName: "Blackwood Ink", industry: "Tattoo studio", socialLinks: ["https://instagram.com/blackwood"] } },
];

function open(lead: Lead) {
  const p = detectPresence(lead);
  return { p, oc: openingConversation({ businessName: lead.businessName, industry: lead.industry, city: lead.city }, p) };
}

describe("Conversation engine — across many business types", () => {
  it.each(BUSINESSES)("$label → detects the right presence and speaks to it", ({ profile, lead }) => {
    const { p, oc } = open(makeLead(lead));
    expect(p.profile).toBe(profile);
    expect(oc.full.length).toBeGreaterThan(40);
    expect(oc.opener.length).toBeGreaterThan(0);
    expect(oc.question).toMatch(/\?$/);
  });

  it.each(BUSINESSES)("$label → the opening reads naturally (style-checked)", ({ lead }) => {
    const { oc } = open(makeLead(lead));
    const report = analyzeStyle(oc.full);
    expect(report.ok, `issues: ${report.issues.map((i) => i.detail).join(" | ")}`).toBe(true);
  });

  it.each(BUSINESSES.filter((b) => b.profile !== "website"))("$label → never assumes a website that doesn't exist", ({ lead }) => {
    const { oc } = open(makeLead(lead));
    // The cardinal rule: never say "your website" / "your site" to a business without one.
    expect(oc.full).not.toMatch(/your (web ?site|site)\b/i);
    expect(oc.avoid.join(" ")).toMatch(/web ?site|web presence/i);
  });

  it("references the actual channel a business uses", () => {
    expect(open(makeLead(BUSINESSES[2].lead as Lead)).oc.full).toMatch(/facebook/i);
    expect(open(makeLead(BUSINESSES[3].lead as Lead)).oc.full).toMatch(/yelp/i);
    expect(open(makeLead(BUSINESSES[4].lead as Lead)).oc.full).toMatch(/google/i);
    expect(open(makeLead(BUSINESSES[1].lead as Lead)).oc.full).toMatch(/instagram/i);
  });

  it("is deterministic — the same business gets the same opening every time", () => {
    const lead = makeLead(BUSINESSES[0].lead as Lead);
    expect(open(lead).oc.full).toBe(open(lead).oc.full);
  });

  it("varies wording across different businesses of the same presence type", () => {
    // Twelve different Facebook-only shops should not all get the same opener.
    const names = ["Ace Auto", "Bella Nails", "Corner Deli", "Dune Surf", "Echo Bar", "Foxglove Florist", "Grove Cafe", "Harbor Bikes", "Iris Bakery", "Juno Yoga", "Kettle & Co", "Lumen Studio"];
    const fulls = new Set(
      names.map((businessName) => open(makeLead({ ...noWeb, businessName, industry: "Retail shop", socialLinks: ["https://facebook.com/x"] })).oc.full),
    );
    // Expect real variety — the combinatorial pools should yield many distinct openings.
    expect(fulls.size).toBeGreaterThanOrEqual(6);
  });

  it("no opening repeats a phrase inside itself (handcrafted, not padded)", () => {
    for (const b of BUSINESSES) {
      const report = analyzeStyle(open(makeLead(b.lead as Lead)).oc.full);
      expect(report.issues.some((i) => i.kind === "repeated-phrase" && i.severity === 3), b.label).toBe(false);
    }
  });
});
