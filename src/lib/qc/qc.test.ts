import { describe, it, expect } from "vitest";
import { runQc, runQcWithRepair, repairContent, type QcContext } from "./pipeline";
import { buildInvestmentModel } from "../investment";
import { defaultSettings } from "../store";
import { makeLead } from "../test-lead";
import type { DeliverableContent, Screenshot } from "../types";

const settings = defaultSettings();
const lead = makeLead();

function ctx(screenshots: Screenshot[] = []): QcContext {
  return { lead, settings, type: "Modernization Brief", screenshots };
}

function cleanContent(): DeliverableContent {
  const opportunities: DeliverableContent["opportunities"] = [
    { observation: "No online booking path", evidence: "The website lists a phone number only.", businessConsequence: "New patients who prefer to book online may go elsewhere after hours.", modernizationDirection: "Add an online booking flow tied to the practice calendar." },
    { observation: "Slow mobile pages", evidence: "Large uncompressed images load on mobile.", businessConsequence: "Mobile visitors may leave before the page is usable.", modernizationDirection: "Optimize page speed and compress images." },
  ];
  const c: DeliverableContent = {
    cover: { subtitle: "Business Technology Review", confidentialityNote: "Confidential discussion document" },
    executiveSnapshot: {
      overview: "Taylor Family Dental has a strong local reputation with clear, low-risk opportunities to reduce friction for new patients.",
      whatIsWorking: "An excellent review reputation and an established, trusted location.",
      primaryOpportunity: "A clear online booking path for new patients.",
      potentialImpact: "Reducing friction typically recovers new-patient inquiries that are otherwise lost.",
      recommendedFirstConversation: "A short call to map the current new-patient journey.",
    },
    strengths: ["Excellent 4.7-star reputation across 180 reviews", "Established, trusted location", "Clear specialization as a dental practice"],
    opportunities,
    customerJourney: {
      currentState: ["A prospective patient finds the practice and must call to book", "Manual phone scheduling"],
      futureState: ["The same patient books online in under two minutes", "Automated confirmation and reminders"],
    },
    modernizationPath: {
      primaryEngagement: "Business Website System",
      components: ["A modern responsive website", "Online booking", "Automated reminders"],
      secondaryOpportunity: "A lightweight internal dashboard for the front desk.",
      investmentRange: null,
      investmentModel: null,
      disclaimer: "Scope and pricing require a short discovery conversation.",
    },
    cta: { headline: "Let's map the new-patient journey.", body: "A short, no-obligation call to see where modernization would help most." },
  };
  c.modernizationPath.investmentModel = buildInvestmentModel(lead, opportunities, "Business Website System", settings);
  return c;
}

describe("QC — clean content", () => {
  it("passes every blocker check with zero warnings", () => {
    const report = runQc(cleanContent(), ctx());
    expect(report.passed).toBe(true);
    expect(report.blockerCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.score).toBe(100);
    expect(report.checks.length).toBe(11);
  });

  it("repair is idempotent on clean content (still passes)", () => {
    const repaired = repairContent(cleanContent(), ctx());
    expect(runQc(repaired, ctx()).passed).toBe(true);
  });
});

describe("QC — detects and auto-repairs defects", () => {
  it("overflow: over-long text fails, repair truncates to fit", () => {
    const c = cleanContent();
    c.executiveSnapshot.overview = "This is far too long. ".repeat(60);
    expect(runQc(c, ctx()).checks.find((x) => x.id === "overflow")!.passed).toBe(false);
    const { report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
  });

  it("empty-sections: a blank required field fails, repair fills a default", () => {
    const c = cleanContent();
    c.executiveSnapshot.primaryOpportunity = "   ";
    expect(runQc(c, ctx()).checks.find((x) => x.id === "empty-sections")!.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.executiveSnapshot.primaryOpportunity.trim().length).toBeGreaterThan(0);
  });

  it("spelling: misspellings + leftover placeholders fail, repair fixes them", () => {
    const c = cleanContent();
    c.executiveSnapshot.overview = "We recieve inquiries for [BUSINESS] and want to seperate them.";
    const before = runQc(c, ctx()).checks.find((x) => x.id === "spelling")!;
    expect(before.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.executiveSnapshot.overview).toContain("receive");
    expect(content.executiveSnapshot.overview).not.toContain("[");
  });

  it("grammar: spacing/doubled-word defects fail, repair cleans them", () => {
    const c = cleanContent();
    c.cta.body = "A short call  to see the the value ,with no obligation.";
    expect(runQc(c, ctx()).checks.find((x) => x.id === "grammar")!.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.cta.body).not.toContain("the the");
    expect(content.cta.body).not.toContain(" ,");
  });

  it("pricing-consistency: a broken total fails, repair rebuilds the model", () => {
    const c = cleanContent();
    c.modernizationPath.investmentModel!.totalHigh = 999999;
    expect(runQc(c, ctx()).checks.find((x) => x.id === "pricing-consistency")!.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    const m = content.modernizationPath.investmentModel!;
    expect(m.lineItems.reduce((a, l) => a + l.investmentHigh, 0)).toBe(m.totalHigh);
  });

  it("inconsistent-recommendations: model engagement mismatch fails, repair aligns it", () => {
    const c = cleanContent();
    c.modernizationPath.investmentModel!.engagement = "Launch Website";
    expect(runQc(c, ctx()).checks.find((x) => x.id === "inconsistent-recommendations")!.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.modernizationPath.investmentModel!.engagement).toBe(content.modernizationPath.primaryEngagement);
  });

  it("repeated-content: secondary duplicating primary fails, repair replaces it", () => {
    const c = cleanContent();
    c.modernizationPath.secondaryOpportunity = c.executiveSnapshot.primaryOpportunity;
    expect(runQc(c, ctx()).checks.find((x) => x.id === "repeated-content")!.passed).toBe(false);
    const { report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
  });

  it("broken-layout: control chars + chip overflow fail, repair fixes them", () => {
    const c = cleanContent();
    const BELL = String.fromCharCode(7); // control char injected at runtime
    c.executiveSnapshot.overview = `Broken${BELL}text with a bell.`;
    c.modernizationPath.components = Array.from({ length: 12 }, (_, i) => `Component ${i + 1}`);
    const r = runQc(c, ctx()).checks.find((x) => x.id === "broken-layout")!;
    expect(r.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.modernizationPath.components.length).toBeLessThanOrEqual(8);
    expect(content.executiveSnapshot.overview).not.toContain(BELL);
  });

  it("shared range must equal the model range, else pricing fails; repair syncs it", () => {
    const c = cleanContent();
    c.modernizationPath.investmentRange = "$1–$2";
    expect(runQc(c, ctx()).checks.find((x) => x.id === "pricing-consistency")!.passed).toBe(false);
    const { content, report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(content.modernizationPath.investmentRange).toBe(content.modernizationPath.investmentModel!.rangeLabel);
  });
});

describe("QC — warnings do not block approval", () => {
  it("a visual-cue evidence with no screenshot is a warning, not a blocker", () => {
    const c = cleanContent();
    c.opportunities[0].evidence = "As shown in the screenshot, the mobile view is cramped.";
    const report = runQc(c, ctx([]));
    const check = report.checks.find((x) => x.id === "missing-screenshots")!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
    expect(report.passed).toBe(true); // warnings never block
  });

  it("a placeholder screenshot is an image-quality warning", () => {
    const shot: Screenshot = {
      id: "shot_1",
      leadId: lead.id,
      pageUrl: "https://taylordental.com",
      viewport: "mobile",
      storageUrl: "https://placeholder.example.com/x.png",
      storageKey: null,
      caption: "Home page",
      approved: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const report = runQc(cleanContent(), ctx([shot]));
    const check = report.checks.find((x) => x.id === "image-quality")!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
    expect(report.passed).toBe(true);
  });
});

describe("QC — orchestration guarantees a clean report", () => {
  it("repairs a report riddled with multiple blockers within the attempt budget", () => {
    const c = cleanContent();
    c.executiveSnapshot.overview = "We recieve  many inquiries ,and [X] the the customers definately leave. ".repeat(10);
    c.executiveSnapshot.primaryOpportunity = "";
    c.modernizationPath.components = Array.from({ length: 15 }, () => "  ");
    c.modernizationPath.investmentModel!.totalLow = -5;
    c.modernizationPath.secondaryOpportunity = c.executiveSnapshot.potentialImpact;
    const { report } = runQcWithRepair(c, ctx());
    expect(report.passed).toBe(true);
    expect(report.attempts).toBeGreaterThanOrEqual(2);
  });

  it("stamps attempts and reports a score", () => {
    const report = runQc(cleanContent(), ctx());
    expect(report.attempts).toBe(1);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
