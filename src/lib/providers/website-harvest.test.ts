// ─────────────────────────────────────────────────────────────────────────────
// Bounded deeper public-email harvest — functionality tests (Phase 3/4). Proves that when the
// homepage exposes no usable business email, a small BOUNDED set of same-origin contact/about pages
// is fetched and the email is found there, with provenance — reusing the existing extractor and
// same-domain gate, never a parallel scraper. Production data (not tests) will prove the yield lift.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeWebsite } from "./website";
import { makeLead } from "../test-lead";

// A tiny fake web: map URL → HTML. Anything unknown 404s.
function stubWeb(pages: Record<string, string>, onFetch?: (url: string) => void) {
  vi.stubGlobal("fetch", async (url: string) => {
    onFetch?.(url);
    const key = Object.keys(pages).find((k) => url === k || url.replace(/\/$/, "") === k.replace(/\/$/, ""));
    if (key) return { ok: true, status: 200, url: key, text: async () => pages[key] } as any;
    return { ok: false, status: 404, url, text: async () => "" } as any;
  });
}
const lead = () => makeLead({ website: "https://acme-dental.com", websiteDomain: "acme-dental.com", publicEmail: null });

afterEach(() => vi.unstubAllGlobals());

describe("deeper public-email harvest", () => {
  it("finds the email on a /contact page when the homepage has none", async () => {
    stubWeb({
      "https://acme-dental.com": `<html><head><title>Acme Dental</title></head><body><nav><a href="/about">About</a><a href="/contact">Contact</a></nav></body></html>`,
      "https://acme-dental.com/contact": `<html><body>Reach us: <a href="mailto:info@acme-dental.com">info@acme-dental.com</a></body></html>`,
      "https://acme-dental.com/about": `<html><body>About Acme.</body></html>`,
    });
    const a = await analyzeWebsite(lead());
    expect(a.emailProvenance.method).toBe("contact-page");
    expect(a.emailProvenance.email).toBe("info@acme-dental.com");
    expect(a.emailProvenance.page).toContain("/contact");
    expect(a.extraPagesFetched).toBeGreaterThanOrEqual(1);
    expect(a.pages.some((p) => p.url.includes("/contact"))).toBe(true);
  });

  it("prefers the homepage email and fetches NO extra pages when it's already there", async () => {
    let fetches = 0;
    stubWeb({ "https://acme-dental.com": `<html><body><a href="mailto:hello@acme-dental.com">hello@acme-dental.com</a><a href="/contact">Contact</a></body></html>`,
      "https://acme-dental.com/contact": `<html><body>info@acme-dental.com</body></html>` }, () => { fetches++; });
    const a = await analyzeWebsite(lead());
    expect(a.emailProvenance.method).toBe("homepage");
    expect(a.emailProvenance.email).toBe("hello@acme-dental.com");
    expect(a.extraPagesFetched).toBe(0);
    expect(fetches).toBe(1); // homepage only
  });

  it("is HARD-BOUNDED — never fetches more than the extra-page cap", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `<a href="/contact-${i}">c${i}</a>`).join("");
    const pages: Record<string, string> = { "https://acme-dental.com": `<html><body>${many}</body></html>` };
    for (let i = 0; i < 12; i++) pages[`https://acme-dental.com/contact-${i}`] = `<html><body>no email here</body></html>`;
    let extraFetches = 0;
    stubWeb(pages, (url) => { if (url !== "https://acme-dental.com") extraFetches++; });
    const a = await analyzeWebsite(lead());
    expect(a.extraPagesFetched).toBeLessThanOrEqual(3);
    expect(extraFetches).toBeLessThanOrEqual(3); // never crawls the whole site
    expect(a.emailProvenance.method).toBe("none");
  });

  it("only follows SAME-ORIGIN contact links, never external ones", async () => {
    const visited: string[] = [];
    stubWeb({
      "https://acme-dental.com": `<html><body><a href="https://facebook.com/contact">fb</a><a href="/contact">Contact</a></body></html>`,
      "https://acme-dental.com/contact": `<html><body>info@acme-dental.com</body></html>`,
    }, (u) => visited.push(u));
    const a = await analyzeWebsite(lead());
    expect(a.emailProvenance.email).toBe("info@acme-dental.com");
    expect(visited.some((u) => u.includes("facebook.com"))).toBe(false); // external never followed
  });

  it("does not adopt an off-domain email found on a contact page (same-domain gate holds)", async () => {
    stubWeb({
      "https://acme-dental.com": `<html><body><a href="/contact">Contact</a></body></html>`,
      "https://acme-dental.com/contact": `<html><body>Email us at acmedental@gmail.com</body></html>`,
    });
    const a = await analyzeWebsite(lead());
    // A gmail address is not same-domain → not adopted as the business email via the harvest gate.
    expect(a.emailProvenance.method).toBe("none");
  });
});
