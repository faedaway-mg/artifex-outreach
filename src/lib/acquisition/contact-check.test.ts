import { describe, it, expect } from "vitest";
import { extractContactFromPages, pickContactEmail, isAppropriateContact, checkPublishedEmail } from "./contact-check";

const NOW = "2026-08-28T00:00:00.000Z";
const page = (url: string, html: string) => ({ url, html });
const mail = (addr: string) => `<a href="mailto:${addr}">email us</a>`;

describe("contact-first gate — appropriateness rules", () => {
  it("accepts a real business inbox; rejects automated/specialist/internal/test addresses", () => {
    expect(isAppropriateContact("info@cedarsage.com")).toBe(true);
    expect(isAppropriateContact("office@cedarsage.com")).toBe(true);
    expect(isAppropriateContact("owner.jane@cedarsage.com")).toBe(true);
    for (const bad of ["noreply@x.com", "privacy@x.com", "abuse@x.com", "careers@x.com", "jobs@x.com", "hr@x.com", "legal@x.com", "postmaster@x.com", "webmaster@x.com", "dpo@x.com"])
      expect(isAppropriateContact(bad)).toBe(false);
    // internal / placeholder / our own address never qualify
    for (const bad of ["jordant.jackson@gmail.com", "test@example.com", "hello@artifexlabs.tech", "you@yourdomain.com", "your@email.com", "youremail@gmail.com", "firstname@company.com"])
      expect(isAppropriateContact(bad)).toBe(false);
  });
});

describe("contact-first gate — picking THE business contact (no cross-business leakage)", () => {
  it("prefers a same-site role inbox over the web designer's address (never the agency)", () => {
    const r = pickContactEmail(["studio@webagency.io", "info@cedarsage.com", "jane@cedarsage.com"], "https://cedarsage.com");
    expect(r.email).toBe("info@cedarsage.com");
    expect(r.domainMatched).toBe(true);
  });
  it("accepts a published free-mail (gmail) when the business has no domain inbox — flagged non-domain", () => {
    const r = pickContactEmail(["cedarsagedental@gmail.com"], "https://cedarsage.com");
    expect(r.email).toBe("cedarsagedental@gmail.com");
    expect(r.domainMatched).toBe(false);
  });
  it("a directory page listing many businesses does not assign a foreign address to this business", () => {
    // site = cedarsage.com; page lists other businesses' emails + the business's own → picks same-site only
    const r = pickContactEmail(["a@other1.com", "b@other2.com", "info@cedarsage.com"], "https://cedarsage.com");
    expect(r.email).toBe("info@cedarsage.com");
  });
  it("returns null when the only addresses are inappropriate", () => {
    expect(pickContactEmail(["careers@x.com", "noreply@x.com"], "https://x.com").email).toBeNull();
  });
});

describe("contact-first gate — outcomes are mutually exclusive and honest", () => {
  const site = "https://cedarsage.com";
  it("FOUND: a same-domain business inbox on a contact page", () => {
    const r = extractContactFromPages([page("https://cedarsage.com/contact", mail("info@cedarsage.com"))], site, NOW);
    expect(r.outcome).toBe("found");
    expect(r.email).toBe("info@cedarsage.com");
    expect(r.domainMatched).toBe(true);
    expect(r.sourceUrl).toBe("https://cedarsage.com/contact");
    expect(r.pagesExamined).toHaveLength(1);
  });
  it("NOT-FOUND (distinct from fetch-failed): pages fetched, no address at all", () => {
    const r = extractContactFromPages([page(site, "<h1>Welcome</h1><p>Call us</p>")], site, NOW);
    expect(r.outcome).toBe("not-found");
    expect(r.reason).toMatch(/not proof/i);
  });
  it("FETCH-FAILED: no pages retrieved is NOT the same as not-found", () => {
    const r = extractContactFromPages([], site, NOW);
    expect(r.outcome).toBe("fetch-failed");
  });
  it("AMBIGUOUS: addresses present but all inappropriate (careers/privacy only)", () => {
    const r = extractContactFromPages([page(site, mail("careers@cedarsage.com") + mail("privacy@cedarsage.com"))], site, NOW);
    expect(r.outcome).toBe("ambiguous");
    expect(r.email).toBeNull();
  });
  it("junk/dev/placeholder addresses never surface (reuses the provider junk filter)", () => {
    const r = extractContactFromPages([page(site, mail("x@wixpress.com") + mail("logo@2x.png") + mail("you@yourdomain.com"))], site, NOW);
    expect(r.outcome).not.toBe("found");
  });
  it("idempotent + deterministic: same pages → identical result (safe to retry)", () => {
    const pages = [page("https://cedarsage.com/about", mail("office@cedarsage.com"))];
    expect(extractContactFromPages(pages, site, NOW)).toEqual(extractContactFromPages(pages, site, NOW));
  });
});

describe("contact-first gate — no expensive work + no network on the trivial paths", () => {
  it("no website → no-website outcome WITHOUT any fetch (nothing to spend)", async () => {
    const r = await checkPublishedEmail(null);
    expect(r.outcome).toBe("no-website");
    expect(r.pagesExamined).toHaveLength(0);
  });
  it("cached content that already yields an address SKIPS the network entirely", async () => {
    const r = await checkPublishedEmail("https://cedarsage.com", {
      now: NOW,
      cachedPages: [page("https://cedarsage.com", mail("info@cedarsage.com"))],
    });
    expect(r.outcome).toBe("found");
    expect(r.email).toBe("info@cedarsage.com");
    // pagesExamined came from cache, not a live fetch
    expect(r.pagesExamined).toEqual(["https://cedarsage.com"]);
  });
});
