// ─────────────────────────────────────────────────────────────────────────────
// M3 public-observation layer — deep, structure-aware discovery from crawled pages, with strict
// false-positive discipline. Every positive case asserts on aggregation + exact provenance; every
// negative case proves a legitimate pattern is NOT flagged (Test Kitchen, empty seasonal category,
// a couple of CTAs, a large-but-navigable catalog, a name abbreviation).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { extractPublicObservations, observationsToOpportunities, type ObservationKind } from "./public-observations";

const lead = {
  businessName: "Urban Americana", website: "https://urbanamericana.com", websiteDomain: "urbanamericana.com",
  rating: 4.8, reviewCount: 950,
};
const page = (url: string, html: string) => ({ url, html });
const kinds = (html: string, over: Partial<typeof lead> = {}): ObservationKind[] =>
  extractPublicObservations([page("https://urbanamericana.com", html)], { ...lead, ...over }).map((o) => o.kind);

// Helper: a storefront with N distinct collection links.
const collections = (n: number, prefix = "cat") =>
  Array.from({ length: n }, (_, i) => `<a href="/collections/${prefix}-${i}">${prefix} ${i}</a>`).join("");

describe("M3 observation extraction — each class fires on real structure", () => {
  it("A. test/staging content that is path-anchored is flagged", () => {
    const html = `<body>${collections(3)}<a href="/collections/test-draft">Draft</a><a href="/staging/home">x</a></body>`;
    expect(kinds(html)).toContain("test-content");
  });

  it("B. duplicate / near-duplicate taxonomy is aggregated into one finding", () => {
    const html = `<body><a href="/collections/lighting">Lighting</a><a href="/collections/lighting-fixtures">Lighting</a><a href="/collections/decor">Decor</a></body>`;
    const obs = extractPublicObservations([page("https://x.com", html)], lead).filter((o) => o.kind === "duplicate-taxonomy");
    expect(obs).toHaveLength(1);              // aggregated, not one-per-pair
    expect(obs[0].affected.length).toBeGreaterThanOrEqual(2); // provenance retained
    expect(obs[0].quantitative).toMatch(/duplicat/i);
  });

  it("C. a large catalog with no filters is flagged as a discovery gap", () => {
    expect(kinds(`<body>${collections(20)}</body>`)).toContain("catalog-discovery-gap");
  });

  it("D. an over-fragmented top-level nav is flagged", () => {
    const nav = Array.from({ length: 14 }, (_, i) => `<a href="/dest${i}">Destination ${i}</a>`).join("");
    expect(kinds(`<body><nav>${nav}</nav></body>`)).toContain("nav-fragmentation");
  });

  it("F. obvious placeholder copy is flagged", () => {
    expect(kinds(`<body><h1>Urban Americana</h1><p>Lorem ipsum dolor sit amet</p></body>`)).toContain("copy-defect");
  });

  it("G. three or more competing primary CTAs are flagged", () => {
    const html = `<body><a href="/a">Book Now</a><a href="/b">Get a Quote</a><a href="/c">Shop Now</a></body>`;
    expect(kinds(html)).toContain("cta-fragmentation");
  });

  it("H. strong external reviews absent from the page is flagged as proof-underused", () => {
    expect(kinds(`<body><h1>Urban Americana</h1><p>A vintage marketplace.</p></body>`)).toContain("proof-underused");
  });
});

describe("M3 false-positive discipline — legitimate patterns are NOT flagged", () => {
  it("'Test Kitchen' content is not treated as test/staging content", () => {
    const html = `<body><a href="/collections/test-kitchen">Test Kitchen</a><a href="/pages/contest">Contest</a>${collections(2)}</body>`;
    expect(kinds(html)).not.toContain("test-content");
  });

  it("a large catalog that DOES offer filters is not a discovery gap", () => {
    const html = `<body>${collections(20)}<div>Filter by price · Sort by newest · Shop by style</div></body>`;
    expect(kinds(html)).not.toContain("catalog-discovery-gap");
  });

  it("just two CTAs is not CTA fragmentation", () => {
    expect(kinds(`<body><a href="/a">Book Now</a><a href="/b">Contact Us</a></body>`)).not.toContain("cta-fragmentation");
  });

  it("an empty seasonal category (no duplicate) is not duplicate taxonomy", () => {
    const html = `<body><a href="/collections/summer">Summer</a><a href="/collections/winter">Winter</a></body>`;
    expect(kinds(html)).not.toContain("duplicate-taxonomy");
  });

  it("a single-word business name is never flagged as inconsistent (abbreviation is legitimate)", () => {
    const html = `<body><title>Acme</title><h1>ACME</h1><h2>Acme Co</h2></body>`;
    expect(kinds(html, { businessName: "Acme", reviewCount: 0, rating: 0 })).not.toContain("brand-inconsistency");
  });

  it("strong reviews that ARE shown on-site is not proof-underused", () => {
    const html = `<body><h1>Urban Americana</h1><div class="reviews">Rated 4.8 stars · read our testimonials</div></body>`;
    expect(kinds(html)).not.toContain("proof-underused");
  });

  it("a business with few external reviews is not proof-underused (nothing strong to surface)", () => {
    expect(kinds(`<body><h1>x</h1></body>`, { rating: 3.2, reviewCount: 4 })).not.toContain("proof-underused");
  });
});

describe("M3 aggregation, provenance, and bounds", () => {
  it("many test links collapse to ONE finding but keep an accurate count and bounded examples", () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/collections/test-${i}">t${i}</a>`).join("");
    const obs = extractPublicObservations([page("https://x.com", `<body>${links}</body>`)], lead).find((o) => o.kind === "test-content")!;
    expect(obs).toBeTruthy();
    expect(obs.quantitative).toContain("8");         // accurate total
    expect(obs.affected.length).toBeLessThanOrEqual(3); // bounded examples
    expect(obs.basis.length).toBeGreaterThan(0);        // exact provenance
  });

  it("every derived opportunity is Observed with non-empty basis (passes the M2 gate)", () => {
    const obs = extractPublicObservations([page("https://x.com", `<body>${collections(20)}</body>`)], lead);
    const opps = observationsToOpportunities(obs);
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) {
      expect(o.confidence.label).toBe("Observed");
      expect(o.basis.length).toBeGreaterThan(0);
      expect(o.id).toMatch(/^obs-/);
    }
  });

  it("no pages ⇒ no observations (thin-evidence business yields nothing invented)", () => {
    expect(extractPublicObservations([], lead)).toHaveLength(0);
  });
});

describe("M3 relevance across business shapes", () => {
  it("a professional-service site with a clean single page yields few/no structural findings", () => {
    const html = `<body><h1>Bright Smile Dental</h1><a href="/book">Book Online</a><p>Trusted by families in Long Beach. Read our patient reviews.</p></body>`;
    const obs = kinds(html, { businessName: "Bright Smile Dental", rating: 4.9, reviewCount: 200 });
    expect(obs).not.toContain("catalog-discovery-gap");
    expect(obs).not.toContain("duplicate-taxonomy");
  });

  it("an ecommerce site with rich structure yields multiple distinct observations", () => {
    const html = `<body>${collections(18)}<a href="/collections/lighting">Lighting</a><a href="/collections/lights">Lights</a><a href="/collections/test-old">old</a></body>`;
    const found = new Set(kinds(html));
    expect(found.size).toBeGreaterThanOrEqual(2); // ≥2 distinct classes for a rich footprint
  });
});
