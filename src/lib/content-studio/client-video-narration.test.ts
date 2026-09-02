import { describe, it, expect } from "vitest";
import { composeReviewNarration, reviewToObservedFinding } from "./client-video";
import { assessScriptQuality, PROHIBITED_RX, composeClientNarration } from "./client-narration";
import { compareClientScripts } from "./script-distinctness";

// Minimal QuickReview shapes mirroring the three real production businesses (Morris/a2z/Robert Hall).
// Only the fields composeReviewNarration reads are populated.
const mk = (o: any) => ({ businessName: o.name, website: o.web, industryLabel: o.ind, findings: [o.f], presentations: [], start: null, openingHook: null } as any);

const MORRIS = mk({ name: "Morris Automotive", web: "http://morrisautomotive.com/", ind: "Automotive", f: {
  id: "opp1", topic: "mobile", category: "Customer Acquisition", impactLevel: "High",
  observation: "The homepage ships no mobile viewport tag, so phones render it at desktop width and shrink the text to fit.",
  whyItMatters: "Shrunk-to-fit text is hard to read on a phone.",
  whatWedDo: "Rework the mobile layout so the primary action appears first and promotional content doesn't bury it.",
  evidence: { confidence: "Observed", basis: ["https://morrisautomotive.com/", "no <meta name=viewport>"], sourceUrl: "http://morrisautomotive.com/" } } });
const A2Z = mk({ name: "a2z Health Massage Schools", web: "http://a2zhealth.net/", ind: "Massage", f: {
  id: "opp2", topic: "booking", category: "Scheduling", impactLevel: "High",
  observation: "No online booking or appointment scheduler is present on any of the 3 pages inspected; the only way to book is to call during business hours.",
  whyItMatters: "Patients increasingly book after hours; phone-only booking loses the ones who won't call back.",
  whatWedDo: "Add online booking so customers can reserve outside business hours.",
  evidence: { confidence: "Observed", basis: ["https://www.a2zhealth.net/", "no scheduling widget across 3 inspected pages"], sourceUrl: "http://a2zhealth.net/" } } });
const RHALL = mk({ name: "Robert Hall & Associates", web: "http://roberthalltaxes.com/", ind: "Tax", f: {
  id: "opp3", topic: "contact", category: "Communication", impactLevel: "High",
  observation: "Across the 5 pages inspected — including the contact page — there is no contact or intake form; the only published way to reach the business is a phone number and an email address.",
  whyItMatters: "A visitor ready to act at 9pm has to remember to call during business hours; without a form that intent is lost overnight.",
  whatWedDo: "Add a clear, consistent way to get in touch on every key page.",
  evidence: { confidence: "Observed", basis: ["https://roberthalltaxes.com/contact/", "no <form> on 5 inspected pages"], sourceUrl: "http://roberthalltaxes.com/contact/" } } });

describe("HTTP prepare value-dense narration (mandate D — operator regeneration is never generic)", () => {
  it("composes an in-band, gate-clean, non-generic script for all three businesses", () => {
    for (const [r, name] of [[MORRIS, "Morris"], [A2Z, "a2z"], [RHALL, "Robert Hall"]] as const) {
      const c = composeReviewNarration(r);
      expect(c, `${name} produced no narration`).toBeTruthy();
      expect(assessScriptQuality(c!).ok, `${name}: ${assessScriptQuality(c!).reasons.join("; ")}`).toBe(true);
      expect(c!.wordCount).toBeGreaterThanOrEqual(70);
      expect(c!.wordCount).toBeLessThanOrEqual(110);
      const all = c!.lines.map((l) => l.text).join(" ");
      for (const rx of PROHIBITED_RX) expect(rx.test(all), `${name} matched banned ${rx}`).toBe(false);
    }
  });

  it("anchors to the REAL observed detail parsed from each observation (survives a name swap)", () => {
    const b = composeReviewNarration(A2Z)!;
    expect(b.lines.find((l) => l.role === "friction")!.text).toContain("3 pages"); // real inspected count
    expect(b.lines.find((l) => l.role === "hook")!.text.toLowerCase()).toContain("book a massage"); // industry noun
    const c = composeReviewNarration(RHALL)!;
    expect(c.lines.find((l) => l.role === "friction")!.text).toContain("5 pages");
    expect(c.lines.find((l) => l.role === "friction")!.text.toLowerCase()).toContain("email address"); // real reach
  });

  it("interchangeability: the three scripts are materially distinct (BreakBot)", () => {
    const scripts = [
      { id: "morris", businessName: "Morris Automotive", narration: composeReviewNarration(MORRIS)!.lines.map((l) => l.text), findingTopics: ["mobile"] },
      { id: "a2z", businessName: "a2z Health Massage Schools", narration: composeReviewNarration(A2Z)!.lines.map((l) => l.text), findingTopics: ["booking"] },
      { id: "rhall", businessName: "Robert Hall & Associates", narration: composeReviewNarration(RHALL)!.lines.map((l) => l.text), findingTopics: ["contact"] },
    ];
    const bb = compareClientScripts(scripts);
    expect(bb.templateEquivalent).toBe(false);
    for (const p of bb.pairs) expect(p.similarity).toBeLessThan(0.5);
  });

  it("returns null when there is no material observed finding (fail-closed, no generic filler)", () => {
    const reviewsOnly = mk({ name: "X", web: "http://x/", ind: "Retail", f: {
      id: "r", topic: "reviews", category: "Customer Retention", impactLevel: "Moderate",
      observation: "Strong review volume on the listing.", whyItMatters: "Reviews build trust.",
      whatWedDo: "Surface reviews.", evidence: { confidence: "Observed", basis: ["listing"], sourceUrl: null } } });
    expect(composeReviewNarration(reviewsOnly)).toBeNull();
  });

  it("normalizes the topic intervention into a gate-valid solution beat (verb 'rework' accepted)", () => {
    const of = reviewToObservedFinding(MORRIS)!;
    const c = composeClientNarration(of, "Morris Automotive");
    expect(c.lines.find((l) => l.role === "solution")!.text.toLowerCase()).toContain("we'd rework");
    expect(assessScriptQuality(c).ok).toBe(true);
  });
});
