import { describe, it, expect } from "vitest";
import { invalidateNarration } from "./stale-content";
import { parseTemplate, type ContentTemplate } from "./template-schema";

const stale: ContentTemplate = {
  version: 1, id: "client-lead_test", title: "Test — review", concept: "concept",
  businessId: "lead_test", businessName: "Purple", seed: 20260200,
  narration: [
    "Your reputation is stronger than your website currently shows.",
    "Put 271+ customer reviews to work",
    "Happy to walk you through it — no obligation.",
  ],
  beats: [
    { type: "title", lines: [0], headline: "Purple" },
    { type: "statement", lines: [1], text: "Put reviews to work" },
    { type: "brand", lines: [2], tagline: "A focused review from Artifex Labs." },
  ],
  thumbnail: { headline: ["Purple"], secondary: "Business technology review", art: "statusCard" },
  evidenceState: "evidence-backed", revision: 2,
};

const DEF = "No directly-observed website finding beyond ratings/reviews — only review-count signal.";
const NOW = "2026-09-01T12:00:00.000Z";

describe("stale narration invalidation (section A)", () => {
  it("archives the prior script, flips to needs-evidence with a deficiency, and replaces the active narration", () => {
    const { template, changed, archivedLines } = invalidateNarration(stale, DEF, NOW);
    expect(changed).toBe(true);
    expect(archivedLines).toBe(3);
    expect(template.evidenceState).toBe("needs-evidence");
    expect(template.evidenceDeficiency).toBe(DEF);
    expect(template.revision).toBe(3);
    // the stale sales lines are GONE from the active narration…
    expect(template.narration.join(" ")).not.toMatch(/reviews to work|no obligation|reputation is stronger/i);
    // …but preserved in revision history
    expect(template.revisionHistory?.[0].narration).toEqual(stale.narration);
    expect(template.narrationEvidence).toEqual([]);
    expect(template.storyboard).toBeUndefined();
  });

  it("produces a schema-valid template (round-trips through parseTemplate)", () => {
    const { template } = invalidateNarration(stale, DEF, NOW);
    const res = parseTemplate(template);
    expect(res.ok, res.ok ? "" : (res as any).error).toBe(true);
  });

  it("is idempotent — re-invalidating a neutralized template does not re-archive the placeholder", () => {
    const once = invalidateNarration(stale, DEF, NOW).template;
    const twice = invalidateNarration(once, DEF, NOW);
    expect(twice.changed).toBe(false);
    expect(twice.archivedLines).toBe(0);
    expect(twice.template.revisionHistory?.length).toBe(1); // still just the one real archive
    expect(twice.template.evidenceDeficiency).toBe(DEF);
  });
});
