import { describe, it, expect } from "vitest";
import { deriveObservedFindings, distinctByTopic, toOpportunities, isSpeculative, type PageFacts, type SiteEvidence } from "./site-evidence";
import { compareClientScripts } from "./script-distinctness";
// The exact gate the real pipeline applies to what we emit — proving our output would actually pass.
import { selectReviewFindings } from "../outreach/review-evidence";

function page(role: PageFacts["role"], over: Partial<PageFacts> = {}): PageFacts {
  return {
    requestedUrl: `https://x.test/${role}`, finalUrl: `https://x.test/${role === "home" ? "" : role}`, title: `${role} page`, role,
    status: 200, viewportWidth: 540, hasViewportMeta: true, metaDescription: "d", overflowPx: 0,
    forms: [], primaryCtas: [], navItemCount: 4, navItems: ["Home", "About", "Services", "Contact"],
    phoneLinks: 1, mailLinks: 0, bookingSignals: [], brokenAssets: 0, brokenAssetSamples: [],
    placeholderHits: [], headerName: null, footerName: null, ...over,
  };
}
function site(pages: PageFacts[], over: Partial<SiteEvidence> = {}): SiteEvidence {
  return { leadId: "lead_x", businessName: "Test Co", website: "https://x.test/", industry: "other", pages, capturedAt: "2026-09-01T00:00:00Z", ...over };
}

describe("deriveObservedFindings — fires ONLY on concrete facts", () => {
  it("mobile-overflow fires on measured horizontal overflow (High)", () => {
    const f = deriveObservedFindings(site([page("home", { overflowPx: 120 })]));
    const m = f.find((x) => x.key === "mobile-overflow");
    expect(m).toBeTruthy();
    expect(m!.topic).toBe("mobile");
    expect(m!.impactLevel).toBe("High");
    expect(m!.observation).toContain("120 pixels wider");
  });

  it("no-viewport-meta fires only when there is no overflow AND no viewport tag", () => {
    expect(deriveObservedFindings(site([page("home", { hasViewportMeta: false, overflowPx: 0 })])).some((x) => x.key === "no-viewport-meta")).toBe(true);
    // with overflow present, the overflow finding wins the single mobile slot
    const both = deriveObservedFindings(site([page("home", { hasViewportMeta: false, overflowPx: 90 })]));
    expect(both.some((x) => x.key === "mobile-overflow")).toBe(true);
    expect(both.some((x) => x.key === "no-viewport-meta")).toBe(false);
  });

  it("no-contact-form fires ONLY after a contact page was actually inspected (never from homepage alone)", () => {
    // homepage only, no form → must NOT conclude "no form" (the mandate's core correction)
    const homeOnly = deriveObservedFindings(site([page("home", { forms: [] })]));
    expect(homeOnly.some((x) => x.key === "no-contact-form")).toBe(false);
    // homepage + a real contact page, neither with an intake form → fires
    const withContact = deriveObservedFindings(site([page("home", { forms: [] }), page("contact", { forms: [] })]));
    expect(withContact.some((x) => x.key === "no-contact-form")).toBe(true);
    // …but a genuine intake form on the contact page suppresses it
    const hasForm = deriveObservedFindings(site([page("home"), page("contact", { forms: [{ action: "/x", inputCount: 3, hasTextInput: true, hasEmailInput: true, hasSubmit: true, isSearchOnly: false }] })]));
    expect(hasForm.some((x) => x.key === "no-contact-form")).toBe(false);
  });

  it("a lone search box is NOT counted as an intake form", () => {
    const searchOnly = deriveObservedFindings(site([page("home"), page("contact", { forms: [{ action: "/s", inputCount: 1, hasTextInput: false, hasEmailInput: false, hasSubmit: true, isSearchOnly: true }] })]));
    expect(searchOnly.some((x) => x.key === "no-contact-form")).toBe(true);
  });

  it("no-online-booking fires for a booking-expected vertical only", () => {
    const dental = deriveObservedFindings(site([page("home"), page("services")], { industry: "dentist", businessName: "Bright Dental" }));
    expect(dental.some((x) => x.key === "no-online-booking")).toBe(true);
    // a hardware store: no booking expectation → no such finding
    const store = deriveObservedFindings(site([page("home"), page("services")], { industry: "hardware store", businessName: "Bolts Co" }));
    expect(store.some((x) => x.key === "no-online-booking")).toBe(false);
    // present booking widget suppresses it
    const booked = deriveObservedFindings(site([page("home", { bookingSignals: ["calendly"] }), page("services")], { industry: "dentist", businessName: "Bright Dental" }));
    expect(booked.some((x) => x.key === "no-online-booking")).toBe(false);
  });

  it("competing-ctas and crowded-nav fire on counts", () => {
    const f = deriveObservedFindings(site([page("home", { primaryCtas: ["Shop now", "Book online", "Get a quote", "Call us"], navItemCount: 11, navItems: Array.from({ length: 11 }, (_, i) => `Item ${i}`) })]));
    expect(f.some((x) => x.key === "competing-ctas")).toBe(true);
    expect(f.some((x) => x.key === "crowded-nav")).toBe(true);
  });

  it("a healthy site yields ZERO findings (no fabrication)", () => {
    const healthy = site([
      page("home", { overflowPx: 0, hasViewportMeta: true, primaryCtas: ["Book online"], navItemCount: 5, bookingSignals: ["calendly"] }),
      page("contact", { forms: [{ action: "/c", inputCount: 4, hasTextInput: true, hasEmailInput: true, hasSubmit: true, isSearchOnly: false }] }),
    ], { industry: "dentist" });
    expect(deriveObservedFindings(healthy)).toHaveLength(0);
  });
});

describe("emitted observations survive the real sendability gate", () => {
  it("no emitted observation contains speculative/hedging language", () => {
    const sites = [
      site([page("home", { overflowPx: 200 })]),
      site([page("home"), page("contact", { forms: [] })]),
      site([page("home"), page("services")], { industry: "salon", businessName: "Glow Salon" }),
      site([page("home", { primaryCtas: ["Shop now", "Book", "Call", "Quote"], navItemCount: 12, brokenAssets: 2, brokenAssetSamples: ["/a.png", "/b.png"], placeholderHits: ["Lorem ipsum dolor"], headerName: "Glow Salon", footerName: "Glow Spa LLC" })]),
    ];
    for (const s of sites) for (const f of deriveObservedFindings(s)) expect(isSpeculative(f.observation), f.observation).toBe(false);
  });

  it("toOpportunities produces Observed, concretely-based opportunities that selectReviewFindings accepts", () => {
    const findings = distinctByTopic(deriveObservedFindings(site([page("home", { overflowPx: 150 }), page("services")], { industry: "dentist", businessName: "Bright Dental" })));
    const opps = toOpportunities(findings, "lead_x");
    expect(opps.length).toBeGreaterThanOrEqual(1);
    for (const o of opps) { expect(o.confidence.label).toBe("Observed"); expect(o.basis.length).toBeGreaterThan(0); }
    const selected = selectReviewFindings(opps, 3, { website: "https://x.test/" });
    expect(selected.length).toBe(opps.length); // none dropped as speculative/unobservable
    expect(selected.every((f) => f.evidence.confidence === "Observed")).toBe(true);
  });
});

describe("distinctness — different sites produce different scripts", () => {
  it("distinctByTopic keeps one finding per topic", () => {
    const dup = deriveObservedFindings(site([page("home", { overflowPx: 50, hasViewportMeta: false })]));
    expect(new Set(distinctByTopic(dup).map((f) => f.topic)).size).toBe(distinctByTopic(dup).length);
  });

  it("three genuinely different sites are NOT template-equivalent (BreakBot ok)", () => {
    const a = distinctByTopic(deriveObservedFindings(site([page("home", { overflowPx: 200 })], { businessName: "A Auto" })));
    const b = distinctByTopic(deriveObservedFindings(site([page("home"), page("contact", { forms: [] })], { businessName: "B Law" })));
    const c = distinctByTopic(deriveObservedFindings(site([page("home"), page("services")], { industry: "dentist", businessName: "C Dental" })));
    const scripts = [
      { id: "a", businessName: "A Auto", narration: a.map((f) => f.observation), findingTopics: a.map((f) => f.topic) },
      { id: "b", businessName: "B Law", narration: b.map((f) => f.observation), findingTopics: b.map((f) => f.topic) },
      { id: "c", businessName: "C Dental", narration: c.map((f) => f.observation), findingTopics: c.map((f) => f.topic) },
    ];
    const bb = compareClientScripts(scripts);
    expect(bb.ok).toBe(true);
    expect(bb.templateEquivalent).toBe(false);
  });
});
