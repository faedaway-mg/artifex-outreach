import { describe, it, expect } from "vitest";
import { acceptNarrationRevision, canAcceptRevision, toNarrationLines, narrationPermissions, forkImprovedVersion, sameNarration } from "./narration-revision";
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

  it("refuses to accept IN PLACE on a FROZEN / SCHEDULED / SENT package — immutable", () => {
    expect(canAcceptRevision("FROZEN", false).ok).toBe(false);
    expect(canAcceptRevision("SCHEDULED", false).ok).toBe(false);
    expect(canAcceptRevision("SENT", false).ok).toBe(false);
    expect(canAcceptRevision("FROZEN", false).reason).toMatch(/immutable/i);
    expect(canAcceptRevision("FROZEN", false).code).toBe("IMMUTABLE_PACKAGE");
  });

  it("mandate 26 §1B: an APPROVED-but-not-frozen draft may still be accepted (approval is not immutability)", () => {
    // This was the reported "package is approved — re-open it" bug: the UI offered Regenerate/Accept and the
    // backend then refused an approved draft. Accepting simply re-opens it (invalidates that approval).
    expect(canAcceptRevision("READY_TO_APPROVE", true).ok).toBe(true);
    expect(canAcceptRevision("READY_TO_APPROVE", false).ok).toBe(true);
    expect(canAcceptRevision("NONE", false).ok).toBe(true);
    expect(canAcceptRevision("INCOMPLETE", true).ok).toBe(true);
  });

  it("toNarrationLines always yields a schema-valid 2..12 line array", () => {
    expect(toNarrationLines("One sentence only.").length).toBeGreaterThanOrEqual(2);
    expect(toNarrationLines("A. B. C. D. E. F. G. H. I. J. K. L. M. N.").length).toBeLessThanOrEqual(12);
  });
});

describe("mandate 26 §1 — truthful state-specific narration permissions + fork", () => {
  it("committed states (FROZEN/SCHEDULED/SENT) hide Accept and expose Create-improved-version", () => {
    for (const s of ["FROZEN", "SCHEDULED", "SENT"] as const) {
      const p = narrationPermissions(s, false);
      expect(p.mode).toBe("committed-fork");
      expect(p.frozen).toBe(true);
      expect(p.canAccept).toBe(false);
      expect(p.canCreateImprovedVersion).toBe(true);
      expect(p.canRegenerate).toBe(true); // regenerate is read-only, always available
      expect(p.acceptBlockedCode).toBe("IMMUTABLE_PACKAGE");
    }
  });

  it("draft states (approved or not) allow Accept in place and do NOT offer a fork", () => {
    for (const [s, approved] of [["NONE", false], ["INCOMPLETE", false], ["READY_TO_APPROVE", true], ["READY_TO_APPROVE", false]] as const) {
      const p = narrationPermissions(s, approved);
      expect(p.mode).toBe("editable");
      expect(p.frozen).toBe(false);
      expect(p.canAccept).toBe(true);
      expect(p.canCreateImprovedVersion).toBe(false);
    }
  });

  it("forkImprovedVersion creates a new unapproved draft revision WITHOUT surfacing the committed package", () => {
    const before = tpl();
    const r = forkImprovedVersion(before, accepted, "SCHEDULED", NOW);
    expect(r.forkedFromState).toBe("SCHEDULED");
    expect(r.newRevision).toBe((before.revision ?? 0) + 1);
    expect(r.template.narration.join(" ")).toContain("no online booking");
    // provenance recorded so the new draft is traceable to the committed package it forked from
    expect((r.template as any).forkedFrom).toMatchObject({ state: "SCHEDULED", atRevision: 3 });
    // prior script archived, never active
    const hist = r.template.revisionHistory!;
    expect(hist[hist.length - 1].narration).toEqual(["Hi, quick video.", "Take a look."]);
  });

  it("sameNarration gives double-tap idempotency (identical candidate → no new revision)", () => {
    const forked = forkImprovedVersion(tpl(), accepted, "FROZEN", NOW).template;
    // a second fork/accept with the identical candidate is a no-op (idempotent under retry / concurrent taps)
    expect(sameNarration(forked, accepted)).toBe(true);
    // a different candidate is NOT idempotent
    expect(sameNarration(forked, "A completely different script about something else entirely here.")).toBe(false);
  });
});
