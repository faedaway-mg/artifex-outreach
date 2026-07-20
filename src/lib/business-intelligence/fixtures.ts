// Shared test fixtures — a diverse cross-section of real SMB shapes, used across
// the business-intelligence test suite. Pure data; safe to import anywhere.
import type { Lead } from "../types";
import { makeLead } from "../test-lead";
import { analyzeWebsitePages } from "../intelligence/providers/website-intelligence";
import type { Evidence } from "../intelligence/evidence";
import type { ProfileInput } from "./types";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

/** A realistic analyzed homepage for the businesses that have a website. */
export const RICH_HOMEPAGE = `<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taylor Family Dental — Pasadena, CA</title>
<meta name="description" content="Gentle family and cosmetic dentistry in Pasadena.">
<script type="application/ld+json">{"@type":"Dentist","name":"Taylor Family Dental"}</script>
</head><body>
<nav><a>Services</a><a>About</a><a href="/book">Book Now</a></nav>
<a href="https://calendly.com/taylor">Book an appointment</a>
<form action="/contact"><input name="email"></form>
<a href="tel:2135550100">Call us</a><a href="mailto:hi@taylordental.com">Email</a>
<h2>Our Services</h2><a>Teeth cleaning</a><a>Cosmetic treatment</a>
<p>Licensed, insured, serving families since 2004. Read our testimonials. Privacy policy. Terms of service.</p>
<img src="/a.jpg" alt="office"><img src="/b.jpg" alt="team">
</body></html>`;

export interface Fixture {
  label: string;
  expectProfile: string; // presence profile expected
  input: ProfileInput;
}

function ev(pages: { url: string; html: string }[]): Evidence[] {
  return analyzeWebsitePages(pages);
}

export const FIXTURES: Fixture[] = [
  {
    label: "Dental practice — analyzed website",
    expectProfile: "website",
    input: { lead: makeLead(), evidence: ev([{ url: "https://taylordental.com", html: RICH_HOMEPAGE }]) },
  },
  {
    label: "Fitness gym — Instagram only",
    expectProfile: "instagram-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Summit Strength", industry: "Fitness gym", socialLinks: ["https://instagram.com/summit"], rating: 4.9, reviewCount: 60 }) },
  },
  {
    label: "Diner — Facebook only",
    expectProfile: "facebook-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Rosie's Diner", industry: "Restaurant", socialLinks: ["https://facebook.com/rosies"], rating: 4.6, reviewCount: 90 }) },
  },
  {
    label: "Cigar lounge — Yelp only, strong reputation",
    expectProfile: "yelp-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Copper & Oak", industry: "Cigar lounge", socialLinks: ["https://yelp.com/biz/copper-oak"], rating: 4.8, reviewCount: 240 }) },
  },
  {
    label: "HVAC — Google only, multi-location",
    expectProfile: "google-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Valley Air Pros", industry: "HVAC contractor", googleMapsUrl: "https://maps.google.com/?cid=9", locationsCount: 3, rating: 4.7, reviewCount: 210 }) },
  },
  {
    label: "Barber — effectively invisible",
    expectProfile: "invisible",
    input: { lead: makeLead({ ...noWeb, businessName: "Fade District", industry: "Barber shop", rating: 0, reviewCount: 0 }) },
  },
  {
    label: "Salon — Instagram + Calendly booking",
    expectProfile: "instagram-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Bloom Salon", industry: "Hair salon", socialLinks: ["https://instagram.com/bloom", "https://calendly.com/bloom"], rating: 4.9, reviewCount: 130 }) },
  },
  {
    label: "Law firm — website, multi-location",
    expectProfile: "website",
    input: { lead: makeLead({ businessName: "Hargrove & Associates", industry: "Law firm", locationsCount: 4 }) },
  },
  {
    label: "Coffee shop — scattered social (FB + IG)",
    expectProfile: "social-only",
    input: { lead: makeLead({ ...noWeb, businessName: "Third Rail Coffee", industry: "Coffee shop", socialLinks: ["https://facebook.com/tr", "https://instagram.com/tr"], rating: 4.5, reviewCount: 40 }) },
  },
  {
    label: "Accountant — bare website, no analysis",
    expectProfile: "website",
    input: { lead: makeLead({ businessName: "Meridian Tax", industry: "Accounting firm", contactFormUrl: null }) },
  },
];
