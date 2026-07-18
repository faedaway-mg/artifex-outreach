import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import type { Finding } from "../types";
import { analyzeWebsitePages } from "./providers/website-intelligence";
import { detectTechnologies, techToBusinessEvidence } from "./providers/tech-detection";
import { analyzeReviews } from "./providers/review-intelligence";
import { extractGrowthSignals } from "./providers/search-enrichment";
import { mapOpenCorporates } from "./providers/opencorporates";
import { mapNominatim } from "./providers/openstreetmap";
import { fuseEvidence } from "./fusion";
import { evidence, type ProviderResult } from "./evidence";
import { registerProvider, enrich } from "./providers";
import { analyzeBusiness } from "./engine";
import { diffIntelligence } from "./enrichment-delta";

const RICH_HTML = `<html lang="en"><head>
<title>Taylor Family Dental — Pasadena, CA</title>
<meta name="description" content="Gentle family and cosmetic dentistry in Pasadena since 2004.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@type":"Dentist","name":"Taylor Family Dental"}</script>
</head><body>
<nav><a href="/services">Our Services</a><a href="/cleaning">Cleaning Treatment</a><a href="/contact">Contact</a></nav>
<a href="tel:2135550100">Call us</a>
<a href="https://calendly.com/taylordental">Book an appointment</a>
<form action="/lead"><input name="email"></form>
<h2>What our patients say</h2><p>Amazing, highly recommend! Friendly staff. Licensed since 2004.</p>
<a href="/privacy">Privacy Policy</a>
</body></html>`;

const WEAK_HTML = `<html><head><title>Joe Plumbing</title></head><body><p>We do plumbing in town.</p></body></html>`;

const findingFix = (o: Partial<Finding> = {}): Finding => ({
  id: "f1", leadId: "lead_test", category: "Conversion journey", title: "t",
  observation: "no obvious way to book or call from a phone", evidence: "e", businessImpact: "customers may leave",
  modernizationDirection: "d", findingType: "Automated technical finding", confidence: "Verified",
  sourceUrl: null, analyzedAt: null, deterministic: true, approved: true, createdAt: "", updatedAt: "", ...o,
});

describe("Website Intelligence provider", () => {
  it("extracts rich structured business evidence from a real page", () => {
    const ev = analyzeWebsitePages([{ url: "https://taylordental.com", html: RICH_HTML }]);
    const fields = ev.map((e) => e.field);
    expect(ev.length).toBeGreaterThan(8);
    expect(fields).toContain("businessDescription");
    expect(fields).toContain("bookingFlow");
    expect(fields).toContain("hasLeadForm");
    expect(fields).toContain("structuredData");
    expect(fields).toContain("mobileViewport");
    expect(ev.find((e) => e.field === "bookingFlow")!.value).toBe("Calendly");
    expect(fields).toContain("languages");
  });
  it("emits friction evidence when key capabilities are missing", () => {
    const ev = analyzeWebsitePages([{ url: "https://joe.com", html: WEAK_HTML }]);
    const fields = ev.map((e) => e.field);
    expect(fields).toContain("friction:noOnlineBooking");
    expect(fields).toContain("friction:noLeadForm");
    expect(fields).toContain("friction:noViewport");
    // Missing-capability friction is a directly-observed fact (safe to reference).
    expect(ev.find((e) => e.field === "friction:noLeadForm")!.observationType).toBe("Directly observed fact");
  });
});

describe("Technology Detection provider", () => {
  const html = `<script src="https://calendly.com/x"></script><script src="//js.hsforms.net/forms.js"></script><script src="https://widget.intercom.io/x"></script><script>gtag('config')</script>`;
  it("detects public technologies", () => {
    const techs = detectTechnologies([{ url: "https://x.com", html }]);
    const names = techs.map((t) => t.name);
    expect(names).toContain("Calendly");
    expect(names).toContain("HubSpot Forms");
    expect(names).toContain("Intercom");
  });
  it("translates tech into BUSINESS observations, not trivia", () => {
    const techs = detectTechnologies([{ url: "https://x.com", html }]);
    const ev = techToBusinessEvidence(techs, "https://x.com");
    const fields = ev.map((e) => e.field);
    // 3+ customer systems → disconnected-systems friction + a discovery question.
    expect(fields).toContain("friction:disconnectedSystems");
    expect(fields.some((f) => f.startsWith("discovery:"))).toBe(true);
  });
});

describe("Review Intelligence provider", () => {
  it("surfaces recurring themes with validate questions, not objective claims", () => {
    const reviews = [
      { text: "They never called me back, so hard to reach." },
      { text: "No response for days, unresponsive front desk." },
      { text: "Never answered the phone." },
      { text: "Amazing, highly recommend! Friendly staff." },
      { text: "Friendly and welcoming team." },
    ];
    const ev = analyzeReviews(reviews);
    const fields = ev.map((e) => e.field);
    expect(fields).toContain("friction:review:slowComms");
    expect(fields.some((f) => f.startsWith("strength:review:"))).toBe(true);
    expect(fields.some((f) => f.startsWith("discovery:review:"))).toBe(true);
    // Never asserted as fact.
    expect(ev.find((e) => e.field === "friction:review:slowComms")!.observationType).toBe("Strong inference");
  });
});

describe("Search Enrichment provider", () => {
  it("extracts growth/momentum signals", () => {
    const ev = extractGrowthSignals(
      [
        { title: "Taylor Dental now open in Glendale", url: "https://news/x" },
        { title: "Voted best dentist 2025" },
      ],
      "Taylor Dental",
    );
    const fields = ev.map((e) => e.field);
    expect(fields).toContain("growth:expansion");
    expect(fields).toContain("growth:award");
  });
});

describe("OpenCorporates + OpenStreetMap (identity + international)", () => {
  it("maps a US corporate record", () => {
    const ev = mapOpenCorporates({ name: "Taylor Family Dental LLC", jurisdictionCode: "us_ca", currentStatus: "Active", incorporationDate: "2004-05-01" });
    const byField = Object.fromEntries(ev.map((e) => [e.field, e.value]));
    expect(byField.legalName).toContain("Taylor");
    expect(byField.jurisdiction).toBe("United States");
    expect(byField.registrationStatus).toBe("Active");
  });
  it("is international-aware (GB jurisdiction)", () => {
    const ev = mapOpenCorporates({ name: "Acme Ltd", jurisdictionCode: "gb", currentStatus: "Active" });
    expect(ev.find((e) => e.field === "jurisdiction")!.value).toBe("United Kingdom");
  });
  it("OSM contributes unique location evidence", () => {
    const ev = mapNominatim({ displayName: "1 High St, London", lat: 51.5, lon: -0.1, type: "dentist", country: "United Kingdom", countryCode: "GB" });
    const fields = ev.map((e) => e.field);
    expect(fields).toContain("osmAddress");
    expect(fields).toContain("geo");
    expect(fields).toContain("country");
  });
});

describe("Evidence Fusion", () => {
  const ev1 = (field: string, value: string | boolean, pid: string) =>
    evidence({ id: `${pid}:${field}`, providerId: pid, kind: "identity", field, value, statement: `${field}=${value}`, observationType: "Directly observed fact", confidence: "Likely", sourceUrl: null });

  it("boosts confidence when two providers corroborate, tracks provenance", () => {
    const results: ProviderResult[] = [
      { providerId: "a", ok: true, evidence: [ev1("industry", "dentist", "a")], notes: [], costUsd: 0 },
      { providerId: "b", ok: true, evidence: [ev1("industry", "dentist", "b")], notes: [], costUsd: 0 },
    ];
    const f = fuseEvidence(results);
    const industry = f.evidence.find((e) => e.field === "industry")!;
    expect(industry.corroboration).toBe(2);
    expect(industry.adjustedConfidence).toBe("Verified"); // Likely + corroboration → Verified
    expect(f.provenance.industry).toEqual(["a", "b"]);
  });
  it("detects contradictions without overwriting either provider", () => {
    const results: ProviderResult[] = [
      { providerId: "a", ok: true, evidence: [ev1("hasLeadForm", true, "a")], notes: [], costUsd: 0 },
      { providerId: "b", ok: true, evidence: [ev1("hasLeadForm", false, "b")], notes: [], costUsd: 0 },
    ];
    const f = fuseEvidence(results);
    expect(f.contradictions.length).toBe(1);
    expect(f.evidence.find((e) => e.field === "hasLeadForm")!.contradiction).toBe(true);
  });
});

describe("Engine with supplied content — deeper understanding + operator delta", () => {
  it("website intelligence becomes a major contributor and enriches the graph", async () => {
    const after = await analyzeBusiness({
      lead: makeLead({ locationsCount: 2, reviewCount: 220 }),
      findings: [findingFix()],
      signals: { hasWebsite: true, mobileFriendly: false, slowLoad: true, hasOnlineBooking: false, hasLeadForm: false },
      pages: [{ url: "https://taylordental.com", html: WEAK_HTML }],
      reviews: [{ text: "never called back" }, { text: "no response, unresponsive" }, { text: "hard to reach, never answered" }],
    });
    expect(after.providerCoverage.contributing).toContain("website-intelligence");
    expect(after.providerCoverage.contributing).toContain("review-intelligence");
    expect(after.knowledgeGraph.nodes.length).toBeGreaterThan(0);
    expect(after.evidence.length).toBeGreaterThan(8);
    expect(Array.isArray(after.contradictions)).toBe(true);
  });

  it("enrichment visibly improves the intelligence (operator delta)", async () => {
    const lead = makeLead();
    const before = await analyzeBusiness({ lead });
    const after = await analyzeBusiness({
      lead,
      pages: [{ url: "https://taylordental.com", html: WEAK_HTML }],
      reviews: [{ text: "never called me back" }, { text: "no response for days" }, { text: "unresponsive, hard to reach" }],
    });
    const delta = diffIntelligence(before, after);
    expect(delta.newEvidenceCount).toBeGreaterThan(0);
    expect(delta.summary.join(" ")).not.toBe("no material change");
  });

  it("degrades gracefully when a provider throws (engine still returns)", async () => {
    registerProvider({
      id: "boom-test",
      name: "Boom",
      capability: { fields: [], external: false, costUsd: 0 },
      ready: () => true,
      async enrich() {
        throw new Error("kaboom");
      },
    });
    const results = await enrich({ lead: makeLead() });
    const boom = results.find((r) => r.providerId === "boom-test");
    expect(boom?.ok).toBe(false);
    // Other providers still succeeded.
    expect(results.some((r) => r.providerId === "lead-facts" && r.ok)).toBe(true);
    const bi = await analyzeBusiness({ lead: makeLead() });
    expect(bi.briefing.nextAction.length).toBeGreaterThan(0);
  });
});
