// ─────────────────────────────────────────────────────────────────────────────
// Note-grounded warm-call brief — the operator's existing note becomes the next conversation.
// Every contextual sentence must be traceable to THIS lead's evidence; no fabrication; no cross-
// business leakage. Deterministic + pure. Nothing here calls, emails, or sends.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { deriveInteractionFacts, warmCallBrief } from "./warm-call-brief";

// The Secret House of Ivy-shaped note (informal, voice-dictated).
const IVY_NOTE =
  "Called them but they didnt answer. Their voicemail told me to text my email and theyd send over their packages. so i texted them my email, they emailed me their packages. looked through everything and the scheduling email was basically unreadable, really hard to read.";

describe("B/C/D — the Ivy note is SYNTHESIZED into a natural continuation, not pasted", () => {
  const brief = warmCallBrief({ note: IVY_NOTE, businessName: "The Secret House of Ivy" });
  it("classifies the interaction as warm and references the real sequence", () => {
    expect(brief.tier).toBe("warm");
    expect(brief.whatToSay).toMatch(/followed the voicemail instructions to text/i);
    expect(brief.whatToSay).toMatch(/sent over your packages/i);
    expect(brief.whatToSay).toMatch(/look through everything/i);
    expect(brief.whatToSay).toMatch(/clean up.*scheduling/i);
    expect(brief.whatToSay).toMatch(/quick review/i);
  });
  it("C — the script is not a verbatim copy of the raw note", () => {
    expect(brief.whatToSay).not.toContain("didnt answer");
    expect(brief.whatToSay).not.toContain("basically unreadable");
  });
  it("D — informal/typo'd phrasing is interpreted without changing the facts", () => {
    const f = deriveInteractionFacts({ note: IVY_NOTE });
    expect(f.operatorFollowedInstruction).toBe(true);
    expect(f.prospectSentMaterials).toBe(true);
    expect(f.materialsType).toBe("packages");
    expect(f.operatorReviewedMaterials).toBe(true);
    expect(f.observedIssue).toBe(true);
    expect(f.observedIssueArea).toBe("scheduling");
  });
  it("warm context reminds Jordan what happened, and next action is specific", () => {
    expect(brief.warmContext).toMatch(/followed their voicemail instructions/i);
    expect(brief.warmContext).toMatch(/sending their packages/i);
    expect(brief.nextAction).toMatch(/packages they sent/i);
  });
});

describe("A — the existing note MATERIALLY changes the script vs a note-less lead", () => {
  it("a lead with the Ivy note gets a different, grounded script than one with no note", () => {
    const withNote = warmCallBrief({ note: IVY_NOTE, genericScript: "Hi, this is Jordan — quick review, got a second?" });
    const without = warmCallBrief({ note: "", genericScript: "Hi, this is Jordan — quick review, got a second?" });
    expect(withNote.whatToSay).not.toBe(without.whatToSay);
    expect(withNote.tier).toBe("warm");
    expect(without.tier).not.toBe("warm");
  });
});

describe("F — concrete interaction evidence outranks generic BI", () => {
  it("uses the note's concrete scheduling issue, not a generic BI opening", () => {
    const brief = warmCallBrief({ note: IVY_NOTE, genericScript: "We think scheduling may be an opportunity for your business." });
    expect(brief.whatToSay).toMatch(/i actually noticed a couple things/i);
    expect(brief.whatToSay).not.toContain("We think scheduling may be an opportunity");
  });
});

describe("G/H — material/request language appears ONLY when evidence proves it", () => {
  it("no 'they sent' when the note doesn't say so", () => {
    const brief = warmCallBrief({ note: "Left a voicemail, no answer yet.", hadPriorContact: true });
    expect(brief.whatToSay).not.toMatch(/sent over your/i);
    expect(deriveInteractionFacts({ note: "Left a voicemail, no answer yet." }).prospectSentMaterials).toBe(false);
  });
  it("'respond to their question' only when an inbound question exists", () => {
    const q = warmCallBrief({ note: "spoke briefly", inboundClassifications: ["Question"], hadPriorContact: true });
    expect(q.nextAction).toBe("Respond to their question");
    const noq = warmCallBrief({ note: "spoke briefly", hadPriorContact: true });
    expect(noq.nextAction).not.toBe("Respond to their question");
  });
});

describe("E — multiple/long history: most-recent-relevant context drives the opening", () => {
  it("a Review-sent + inbound question leads with the Review/question, not the old front-desk call", () => {
    const brief = warmCallBrief({
      note: "3 weeks ago called the front desk, they gave me the owner's email.",
      reviewSent: true, inboundClassifications: ["Question"], hadPriorContact: true,
    });
    expect(brief.tier).toBe("warm");
    expect(brief.whatToSay).toMatch(/quick review/i);
    expect(brief.nextAction).toBe("Respond to their question"); // question outranks generic reconnect
  });
});

describe("I/J — no fabricated warmth; sparse falls back safely", () => {
  it("a high-value cold lead is labelled explicitly and never implied familiar", () => {
    const brief = warmCallBrief({ note: "", fitScore: 88, genericScript: "Hi, this is Jordan — quick review, got a second?" });
    expect(brief.tier).toBe("high-value-cold");
    expect(brief.warmContext).toBeNull();
    expect(brief.whatToSay).not.toMatch(/we spoke|the other day|you sent|followed/i);
    expect(brief.nextAction).toMatch(/high-value/i);
  });
  it("a genuinely cold lead with no evidence gets conservative guidance", () => {
    const brief = warmCallBrief({ note: "", fitScore: 30 });
    expect(brief.tier).toBe("cold");
    expect(brief.warmContext).toBeNull();
  });
});

describe("K — NO cross-business contamination (P0)", () => {
  it("Business A's note never appears in Business B's brief", () => {
    const a = warmCallBrief({ note: IVY_NOTE, businessName: "Ivy" });
    const b = warmCallBrief({ note: "No prior contact.", businessName: "Other Co", fitScore: 40 });
    expect(a.whatToSay).toMatch(/packages/i);
    expect(b.whatToSay).not.toMatch(/packages/i);        // B's script has none of A's facts
    expect(b.warmContext).toBeNull();
    expect(b.evidence.join(" ")).not.toMatch(/packages|scheduling/i);
  });
});

describe("R — synthesis is read-only over the note (facts derived, note unchanged)", () => {
  it("deriveInteractionFacts does not mutate its input", () => {
    const input = { note: IVY_NOTE };
    const copy = { ...input };
    deriveInteractionFacts(input);
    expect(input).toEqual(copy);
  });
});
