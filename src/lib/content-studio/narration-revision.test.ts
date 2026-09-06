import { describe, it, expect } from "vitest";
import { acceptNarrationRevision, canAcceptRevision, toNarrationLines } from "./narration-revision";
import { inputVersion } from "./job";
import type { ContentTemplate } from "./template-schema";

const tpl = (): ContentTemplate => ({
  id: "client-lead_1", businessId: "lead_1", title: "Vertex Roofing", concept: "roofing review", businessName: "Vertex Roofing",
  narration: ["Hi, quick video.", "Take a look."],
  beats: [
    { type: "title", lines: [0], mood: "problem", eyebrow: "REVIEW", headline: "Vertex Roofing", sub: "x" },
    { type: "brand", lines: [1], mood: "resolve", tagline: "A focused review from Artifex Labs." },
  ],
  revision: 3,
} as unknown as ContentTemplate);

const NOW = "2026-09-06T00:00:00Z";
const accepted = "Hi — I looked at Vertex Roofing and noticed there's no online booking. That means after-hours jobs slip away. A simple booking page could capture those requests. No pressure — reply if useful.";

describe("mandate 25 — accept narration revision (audio/render safety)", () => {
  it("archives the prior narration, installs the accepted script, bumps revision, marks ownerEdited", () => {
    const r = acceptNarrationRevision(tpl(), accepted, NOW);
    expect(r.priorRevision).toBe(3);
    expect(r.newRevision).toBe(4);
    expect(r.template.revision).toBe(4);
    expect(r.template.ownerEdited).toBe(true);
    expect(r.template.ownerEditedAt).toBe(NOW);
    // prior script preserved in history, never as the active narration
    const hist = r.template.revisionHistory!;
    expect(hist[hist.length - 1].narration).toEqual(["Hi, quick video.", "Take a look."]);
    expect(r.template.narration.join(" ")).toContain("no online booking");
    expect(r.scriptChanged).toBe(true);
  });

  it("changing the narration ADVANCES the render input version (old audio can't satisfy the new script)", () => {
    const before = tpl();
    const after = acceptNarrationRevision(before, accepted, NOW).template;
    // scriptVersion (runner) hashes narration.join("¶"); model that here to prove inputVersion advances.
    const sv = (t: ContentTemplate) => `${t.id}|template|x|${t.narration.join("¶")}`;
    const vBefore = inputVersion({ scriptVersion: sv(before), audioSig: "old-audio", templateVersion: "t1" });
    const vAfter = inputVersion({ scriptVersion: sv(after), audioSig: "old-audio", templateVersion: "t1" });
    expect(vAfter).not.toBe(vBefore); // a prior READY render bound to vBefore is now stale
  });

  it("refuses to accept on a FROZEN / SCHEDULED / SENT (or approved) package — immutable", () => {
    expect(canAcceptRevision("FROZEN", false).ok).toBe(false);
    expect(canAcceptRevision("SCHEDULED", false).ok).toBe(false);
    expect(canAcceptRevision("SENT", false).ok).toBe(false);
    expect(canAcceptRevision("READY_TO_APPROVE", true).ok).toBe(false); // approved
    expect(canAcceptRevision("FROZEN", false).reason).toMatch(/immutable/i);
  });

  it("allows accept on a draft (READY_TO_APPROVE, not approved) — re-opened into a new revision", () => {
    expect(canAcceptRevision("READY_TO_APPROVE", false).ok).toBe(true);
    expect(canAcceptRevision("NONE", false).ok).toBe(true);
  });

  it("toNarrationLines always yields a schema-valid 2..12 line array", () => {
    expect(toNarrationLines("One sentence only.").length).toBeGreaterThanOrEqual(2);
    expect(toNarrationLines("A. B. C. D. E. F. G. H. I. J. K. L. M. N.").length).toBeLessThanOrEqual(12);
  });
});
