import { describe, it, expect } from "vitest";
import { eligibilityFor } from "./eligibility";
import { _internal, safeFetch } from "../ssrf";
import { conceptSpecSchema } from "./spec";
import { renderConcept } from "./render";
import { validateConcept } from "./validate";
import { generateConceptSpec } from "./generate";
import { generateShareToken, hashToken, tokenMatchesHash } from "./share";
import type { ApprovedFact } from "../types";

const facts: ApprovedFact[] = [
  { key: "businessName", label: "Business", value: "Bright Smile Dental", status: "confirmed" },
  { key: "category", label: "Category", value: "Dental practice", status: "confirmed" },
  { key: "phone", label: "Phone", value: "(213) 555-0100", status: "confirmed" },
  { key: "rating", label: "Rating", value: "4.8", status: "confirmed" },
  { key: "reviewCount", label: "Reviews", value: "214", status: "confirmed" },
];

describe("eligibility", () => {
  it("#2/#3/#4 Tier A eligible, B manual, C disabled", () => {
    expect(eligibilityFor("A")).toMatchObject({ eligible: true, manual: false });
    expect(eligibilityFor("B")).toMatchObject({ eligible: true, manual: true });
    expect(eligibilityFor("C").eligible).toBe(false);
    expect(eligibilityFor(null).eligible).toBe(false);
  });
});

describe("SSRF protections", () => {
  it("#14 blocks loopback", () => {
    expect(_internal.ipBlocked("127.0.0.1")).toBe(true);
    expect(_internal.ipv6Blocked("::1")).toBe(true);
  });
  it("#15 blocks private + link-local + metadata ranges", () => {
    for (const ip of ["10.0.0.5", "172.16.9.9", "192.168.1.1", "169.254.169.254", "100.64.0.1"]) expect(_internal.ipBlocked(ip)).toBe(true);
    expect(_internal.ipBlocked("8.8.8.8")).toBe(false);
  });
  it("blocks localhost + internal hosts + non-http schemes without network", async () => {
    expect((await safeFetch("http://localhost/")).error).toBeTruthy();
    expect((await safeFetch("http://127.0.0.1/")).error).toBeTruthy();
    expect((await safeFetch("http://169.254.169.254/latest/meta-data")).error).toBeTruthy();
    expect((await safeFetch("ftp://example.com")).error).toBe("scheme not allowed");
    expect((await safeFetch("http://foo.railway.internal/")).error).toBeTruthy();
  });
});

describe("spec + render", () => {
  it("#18/#19/#26 renders responsive HTML with disclaimer, attribution, noindex; no scripts", () => {
    const { spec } = generateConceptSpec({ approvedFacts: facts, findings: [], previewType: "Homepage Concept", visualDirection: "Quiet Professional", targetAction: "Book a consultation", recommendedService: null });
    const { html } = renderConcept(spec);
    expect(html).toContain("width=device-width");
    expect(html.toLowerCase()).toContain("noindex");
    expect(html).toMatch(/concept preview/i);
    expect(html).toMatch(/artifex labs/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son\w+=/i);
  });
  it("#11/#12/#13 spec schema rejects unknown component types + unsafe url schemes", () => {
    expect(conceptSpecSchema.safeParse({ meta: { businessName: "x", category: "y", previewType: "Quick Direction", visualDirection: "Quiet Professional", targetAction: "Contact us", recommendedService: null }, components: [{ type: "iframe", props: {} }, { type: "hero", props: { headline: "h", subhead: "s", ctaLabel: "c" } }] }).success).toBe(false);
    const bad = conceptSpecSchema.safeParse({ meta: { businessName: "x", category: "y", previewType: "Quick Direction", visualDirection: "Quiet Professional", targetAction: "Contact us", recommendedService: null }, components: [{ type: "hero", props: { headline: "h", subhead: "s", ctaLabel: "c", ctaHref: "javascript:alert(1)" } }, { type: "footer", props: { businessName: "x" } }] });
    expect(bad.success).toBe(false);
  });
});

describe("validation", () => {
  const { spec } = generateConceptSpec({ approvedFacts: facts, findings: [], previewType: "Quick Direction", visualDirection: "Quiet Professional", targetAction: "Contact us", recommendedService: null });
  const { html } = renderConcept(spec);

  it("#8 a clean concept from approved facts passes", () => {
    expect(validateConcept(spec, html, facts).valid).toBe(true);
  });
  it("#8 blocks fabricated testimonials", () => {
    const bad = html.replace("</main>", '<p>"Absolutely the best dentist I have ever visited in my life" — A. Customer</p></main>');
    expect(validateConcept(spec, bad, facts).valid).toBe(false);
  });
  it("#10 blocks invented pricing not in approved facts", () => {
    const bad = html.replace("</main>", "<p>Only $999 today!</p></main>");
    const r = validateConcept(spec, bad, facts);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.rule === "no-invented-pricing")).toBe(true);
  });
  it("#9 blocks unsupported award/certification claims", () => {
    const bad = html.replace("</main>", "<p>Award-winning, board-certified specialists</p></main>");
    expect(validateConcept(spec, bad, facts).valid).toBe(false);
  });
  it("#11/#12 blocks scripts + handlers", () => {
    expect(validateConcept(spec, html + "<script>x()</script>", facts).valid).toBe(false);
    expect(validateConcept(spec, html + '<div onclick="x()"></div>', facts).valid).toBe(false);
  });
  it("#27 blocks internal/private identifiers", () => {
    expect(validateConcept(spec, html.replace("</main>", "<p>lead_abc123def</p></main>"), facts).valid).toBe(false);
  });
});

describe("share tokens", () => {
  it("#22/#23 tokens are hashed + unguessable", () => {
    const { token, tokenHash } = generateShareToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toHaveLength(64); // sha256 hex
    expect(tokenHash).not.toContain(token);
    expect(hashToken(token)).toBe(tokenHash);
    expect(tokenMatchesHash(token, tokenHash)).toBe(true);
    expect(tokenMatchesHash("wrong", tokenHash)).toBe(false);
  });
});
