import { describe, it, expect } from "vitest";
import { assessPackageCoherence, coherenceBlocks, type CoherenceInput } from "./package-coherence";

// A coherent, sellable booking package baseline. Individual tests perturb ONE field.
function base(over: Partial<CoherenceInput> = {}): CoherenceInput {
  return {
    subject: "online booking",
    findingText: "I tried to book online and couldn't find a way to do it from the pages I checked.",
    firstLine: "I tried to book online and couldn't find a way to do it from the pages I checked.",
    heroTitle: "I tried to book online.",
    whyItMatters: "Someone ready to book may have to switch channels or give up before they reach you.",
    attemptSupported: true,
    mentionsMobile: false,
    hasMobileScreenshot: false,
    hasAnyScreenshot: true,
    screenshotCount: 2,
    quickFixEligible: true,
    ...over,
  };
}

describe("package coherence gate", () => {
  it("passes a coherent booking package with no issues", () => {
    const issues = assessPackageCoherence(base());
    expect(issues).toEqual([]);
    expect(coherenceBlocks(issues)).toBe(false);
  });

  it("BLOCKS an empty/generic subject on an active sellable package (§12)", () => {
    for (const subject of ["", "website note", "— no subject —"]) {
      const issues = assessPackageCoherence(base({ subject }));
      expect(issues.map((i) => i.kind)).toContain("subject.missing");
      expect(coherenceBlocks(issues)).toBe(true);
    }
  });

  it("BLOCKS a subject/finding family mismatch (§13)", () => {
    const issues = assessPackageCoherence(
      base({ subject: "website inquiry", findingText: "I tried to book online and couldn't find a way to do it." }),
    );
    expect(issues.map((i) => i.kind)).toContain("hero.mismatch");
    expect(coherenceBlocks(issues)).toBe(true);
  });

  it("BLOCKS a generic fallback hero while a specific finding exists (§30)", () => {
    const issues = assessPackageCoherence(
      base({ heroTitle: "Here's what we found on your website.", attemptSupported: false }),
    );
    expect(issues.map((i) => i.kind)).toContain("copy.generic");
  });

  it("BLOCKS an overstated completed-action claim (§53)", () => {
    const issues = assessPackageCoherence(
      base({ firstLine: "I submitted an inquiry through your website and it failed." }),
    );
    expect(issues.map((i) => i.kind)).toContain("claim.overstated");
    expect(coherenceBlocks(issues)).toBe(true);
  });

  it("BLOCKS an attempted-use claim on an observational finding (§11/§53)", () => {
    const issues = assessPackageCoherence(
      base({ findingText: "some of the text was hard to read", attemptSupported: true }),
    );
    expect(issues.map((i) => i.kind)).toContain("claim.attemptUnsupported");
  });

  it("BLOCKS a mobile claim with no mobile evidence (§19)", () => {
    const issues = assessPackageCoherence(
      base({ mentionsMobile: true, hasMobileScreenshot: false }),
    );
    expect(issues.map((i) => i.kind)).toContain("mobile.noEvidence");
    expect(coherenceBlocks(issues)).toBe(true);
  });

  it("allows a mobile claim when a mobile screenshot exists", () => {
    const issues = assessPackageCoherence(
      base({ mentionsMobile: true, hasMobileScreenshot: true }),
    );
    expect(issues.map((i) => i.kind)).not.toContain("mobile.noEvidence");
  });

  it("WARNs on generic boilerplate why-it-matters (§15)", () => {
    const issues = assessPackageCoherence(base({ whyItMatters: "A clearer next action for visitors" }));
    const why = issues.find((i) => i.kind === "why.generic");
    expect(why?.severity).toBe("WARN");
  });

  it("WARNs on an unbounded whole-site claim (§53)", () => {
    const issues = assessPackageCoherence(
      base({ firstLine: "Across your entire website we found a problem." }),
    );
    expect(issues.map((i) => i.kind)).toContain("claim.unbounded");
  });

  it("relaxes the one-story contract for a conversation-only page", () => {
    const issues = assessPackageCoherence(base({ quickFixEligible: false, subject: "" }));
    expect(issues.map((i) => i.kind)).not.toContain("subject.missing");
  });
});
