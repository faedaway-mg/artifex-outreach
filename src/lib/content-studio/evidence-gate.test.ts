import { describe, it, expect } from "vitest";
import { assessGenerationEvidence, isConcreteBasis, findingQualifies } from "./evidence-gate";
import { compareClientScripts } from "./script-distinctness";
import type { NarrationEvidence } from "./template-schema";

const SHOT = { outputKey: "content-studio/production/screenshot/biz/mobile.png", sha256: "abc123def456", sourceUrl: "https://example.com/", pageTitle: "Homepage" };

// The REAL live shape (pulled from prod): identical generic finding across all three, basis is only a
// synthetic friction marker, reviews line is the only concrete-ish basis (and it's the excluded topic).
function liveThree() {
  const mk = (name: string, count: number, domain: string) => ({
    id: `client-${name}`,
    businessName: name,
    narration: [
      "Your reputation is stronger than your website currently shows.",
      "Point visitors to one clear next step",
      `Put ${count}+ customer reviews to work`,
      "Choose one primary action per page and make the secondary paths visibly secondary.",
      "Happy to walk you through it — no obligation.",
    ],
    narrationEvidence: [
      { line: 0, kind: "framing", basis: ["Synthesizing frame across the findings below"] },
      { line: 1, kind: "finding", topic: "cta", confidence: "Observed", sourceLabel: `${domain} · Homepage`, basis: ["evidence:friction:noClearCTA"] },
      { line: 2, kind: "finding", topic: "reviews", confidence: "Observed", sourceLabel: `${domain} · Reviews`, basis: [`external rating 4.8★ / ${count} reviews`, "no on-site review/testimonial markup detected on crawled pages"] },
      { line: 3, kind: "starting-point", topic: "cta", confidence: "Observed", sourceLabel: `${domain} · Homepage`, basis: [`${domain} · Homepage`, "evidence:friction:noClearCTA"] },
      { line: 4, kind: "framing", basis: ["Standard no-obligation close"] },
    ] as NarrationEvidence[],
    findingTopics: ["cta"],
  });
  return [
    mk("All About Smiles", 563, "allaboutsmilesmiddletown.com"),
    mk("Silver In the City", 505, "www.silverinthecity.com"),
    mk("Purple - Santa Monica Place", 271, "www.purple.com"),
  ];
}

describe("evidence gate — honest needs-evidence", () => {
  it("blocks the three live scripts: only a synthetic marker backs the material finding", () => {
    for (const t of liveThree()) {
      const r = assessGenerationEvidence({ template: t, liveShot: SHOT });
      expect(r.ok).toBe(false);
      expect(r.evidenceScenes).toBe(0);
      expect(r.reason).toMatch(/system-generated marker|not a concrete/i);
    }
  });

  it("blocks a Likely / AI-inference finding (the findings-table shape)", () => {
    const t = {
      businessName: "All About Smiles",
      narration: ["A quick look.", "No online lead/intake form.", "Happy to walk you through it."],
      narrationEvidence: [
        { line: 1, kind: "finding", topic: "cta", confidence: "Likely", basis: ["No <form> element detected on the homepage."] },
      ] as NarrationEvidence[],
    };
    const r = assessGenerationEvidence({ template: t, liveShot: SHOT });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/only inferred\/likely|directly-observed/i);
  });

  it("blocks when there is no verified screenshot even if the finding is real", () => {
    const t = {
      businessName: "Northstar",
      narration: ["A quick look.", "Your booking form asks for 11 fields before a visitor sees availability.", "Close."],
      narrationEvidence: [
        { line: 1, kind: "finding", topic: "booking", confidence: "Observed", basis: ["Booking form requires 11 fields before showing availability (observed on /book)."] },
      ] as NarrationEvidence[],
    };
    const r = assessGenerationEvidence({ template: t, liveShot: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no verified website screenshot/i);
  });

  it("ALLOWS a genuinely observed + concrete finding with a matching screenshot, and binds the SHA", () => {
    const t = {
      businessName: "Northstar",
      narration: ["A quick look at Northstar.", "Your booking form asks for 11 fields before a visitor sees availability.", "Start with a 2-field first step.", "Happy to walk you through it."],
      narrationEvidence: [
        { line: 1, kind: "finding", topic: "booking", confidence: "Observed", sourceLabel: "northstar.com · Booking", sourceUrl: "https://northstar.com/book", basis: ["Booking form requires 11 fields before showing availability (observed on /book)."] },
      ] as NarrationEvidence[],
    };
    const r = assessGenerationEvidence({ template: t, liveShot: SHOT });
    expect(r.ok).toBe(true);
    expect(r.evidenceScenes).toBeGreaterThanOrEqual(1);
    const ev = r.storyboard.filter((s) => s.purpose === "evidence");
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev[0].screenshotSha).toBe(SHOT.sha256); // SHA-bound to the verified capture
    expect(ev[0].screenshotKey).toBe(SHOT.outputKey);
    expect(r.storyboard[0].purpose).toBe("identity");
    expect(r.storyboard[r.storyboard.length - 1].purpose).toBe("cta");
  });
});

describe("isConcreteBasis / findingQualifies", () => {
  it("treats synthetic markers and bare source labels as NOT concrete", () => {
    expect(isConcreteBasis(["evidence:friction:noClearCTA"])).toBe(false);
    expect(isConcreteBasis(["www.silverinthecity.com · Homepage"])).toBe(false);
    expect(isConcreteBasis(["Synthesizing frame across findings"])).toBe(false);
  });
  it("treats a real observation as concrete", () => {
    expect(isConcreteBasis(["Booking form requires 11 fields before showing availability."])).toBe(true);
  });
  it("a Likely finding never qualifies even with concrete basis", () => {
    expect(findingQualifies({ line: 1, kind: "finding", topic: "x", confidence: "Likely", basis: ["A real observed detail here."] } as NarrationEvidence)).toBe(false);
  });
});

describe("BreakBot script distinctness", () => {
  it("FAILS the three live scripts as template-equivalent", () => {
    const r = compareClientScripts(liveThree());
    expect(r.ok).toBe(false);
    expect(r.templateEquivalent).toBe(true);
    expect(r.pairs.every((p) => p.similarity >= 0.9)).toBe(true);
    expect(r.reason).toMatch(/template-equivalent/i);
  });

  it("PASSES three genuinely distinct scripts", () => {
    const distinct = [
      { id: "a", businessName: "Silver In the City", narration: ["Your gift shop's online store hides the cart behind two clicks.", "Surface the cart on every product page.", "Close."], findingTopics: ["cart"] },
      { id: "b", businessName: "Purple", narration: ["This location page buries the store's address below national promos.", "Pin the Santa Monica address and hours to the top.", "Close."], findingTopics: ["local-nav"] },
      { id: "c", businessName: "All About Smiles", narration: ["New-patient booking is phone-only during office hours.", "Add a 24/7 request-appointment form.", "Close."], findingTopics: ["booking"] },
    ];
    const r = compareClientScripts(distinct);
    expect(r.ok).toBe(true);
    expect(r.templateEquivalent).toBe(false);
  });
});
