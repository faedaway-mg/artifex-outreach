import { describe, it, expect } from "vitest";
import { buildZeroTouchTemplate, zeroTouchTemplateId } from "./zero-touch-template";
import { parseTemplate, validateTemplateStructure } from "./template-schema";
import { planSocialAnimation } from "./zero-touch-orchestrator";
import { composeScriptFromBrief } from "./zero-touch";
import { assessScenePlanRichness, STRUCTURED_BEAT_KINDS } from "./social-richness";

const structuredKindsIn = (beats: { type: string }[]) =>
  new Set(beats.map((b) => b.type).filter((t) => (STRUCTURED_BEAT_KINDS as readonly string[]).includes(t)));

function build(brief: string, title = "Field note", concept: string | null = "Why good businesses lose leads after hours") {
  const script = composeScriptFromBrief({ brief, title, concept, targetSeconds: 30 });
  const plan = planSocialAnimation(script, 30);
  return { script, template: buildZeroTouchTemplate({ pieceId: "draft_zt_abc123", title, concept, script, plan }) };
}

describe("zero-touch → renderable template (mandate §17 renderability fix)", () => {
  it("produces a schema-valid, injection-safe template a generic worker can render", () => {
    const { template } = build("Visitors try to book after 6pm and hit a dead form. That silence is lost revenue. A simple after-hours capture path recovers it.");
    // Round-trips through the strict parser + structural validator.
    const parsed = parseTemplate(template);
    expect(parsed.ok).toBe(true);
    expect(validateTemplateStructure(template).ok).toBe(true);
  });

  it("is 9:16 SOCIAL, Matt-implicit, with exactly one brand beat last", () => {
    const { template } = build("Some sentence one. Sentence two here. A third sentence closes it.");
    expect(template.workflow).toBe("social");
    const brand = template.beats.filter((b) => b.type === "brand");
    expect(brand).toHaveLength(1);
    expect(template.beats[template.beats.length - 1].type).toBe("brand");
    expect(template.beats[0].type).toBe("title");
  });

  it("respects schema caps: ≤12 narration lines, ≤10 beats, statement text ≤160", () => {
    // A long brief with many sentences must be clamped, not rejected.
    const longBrief = Array.from({ length: 20 }, (_, i) => `This is idea number ${i} about losing leads and how a fix helps.`).join(" ");
    const { template } = build(longBrief);
    expect(template.narration.length).toBeLessThanOrEqual(12);
    expect(template.beats.length).toBeLessThanOrEqual(10);
    for (const b of template.beats) {
      if (b.type === "statement") expect(b.text.length).toBeLessThanOrEqual(160);
      if (b.type === "title") expect((b as any).headline.length).toBeLessThanOrEqual(120);
    }
    // Every beat's referenced line index is within range (structural invariant).
    expect(validateTemplateStructure(template).ok).toBe(true);
  });

  it("sanitizes the piece id into the allowed template-id shape", () => {
    expect(zeroTouchTemplateId("draft_zt_ABC-123")).toMatch(/^[0-9a-z][0-9a-z_-]{1,40}$/i);
    expect(zeroTouchTemplateId("!!weird//id")).toMatch(/^[0-9a-z][0-9a-z_-]{1,40}$/i);
  });

  it("is deterministic for the same inputs", () => {
    const a = build("One. Two. Three.");
    const b = build("One. Two. Three.");
    expect(JSON.stringify(a.template)).toBe(JSON.stringify(b.template));
  });
});

describe("zero-touch → VISUAL STORYTELLING (mandate §40–§45)", () => {
  it("emits ≥2 distinct STRUCTURED beat kinds for 'Entered four times.'", () => {
    const { template } = build(
      "Every new customer enters their details on your web form. Then a staffer re-types it into email. Then again into a spreadsheet. Then a fourth time into the CRM. The same data, entered four times.",
      "Entered four times",
      "Entered four times.",
    );
    const kinds = structuredKindsIn(template.beats);
    expect(kinds.size).toBeGreaterThanOrEqual(2); // NOT text-on-blue
    // The demonstrative chain that SHOWS the retyping hand-off must be present.
    expect(template.beats.some((b) => b.type === "chain")).toBe(true);
    const r = assessScenePlanRichness(template);
    expect(r.ok).toBe(true);
    expect(r.distinctBeatKinds).toBeGreaterThanOrEqual(2);
  });

  it("emits ≥2 distinct STRUCTURED beat kinds for 'Nobody followed up.'", () => {
    const { template } = build(
      "A great lead came in on Friday. It sat in the inbox over the weekend. No reminder fired. By Monday it had gone cold. Nobody followed up, and the lead was lost.",
      "Nobody followed up",
      "Nobody followed up.",
    );
    const kinds = structuredKindsIn(template.beats);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    expect(template.beats.some((b) => b.type === "chain")).toBe(true);
    const r = assessScenePlanRichness(template);
    expect(r.ok).toBe(true);
  });

  it("even an unremarkable concept still reaches ≥2 distinct structured kinds (fallbacks)", () => {
    const { template } = build("One. Two. Three.", "Field note", "A short field note");
    const r = assessScenePlanRichness(template);
    expect(r.ok).toBe(true);
    expect(r.distinctBeatKinds).toBeGreaterThanOrEqual(2);
  });

  it("the plan is NOT centered-text-only — every produced template passes the richness gate", () => {
    const briefs = [
      "Visitors try to book after 6pm and hit a dead form. That silence is lost revenue.",
      "Your leads live across spreadsheets, sticky notes and five open tabs.",
      "Nobody can find you when they search Google for what you do.",
      "It takes hours a week to re-enter the same data every morning.",
    ];
    for (const brief of briefs) {
      const { template } = build(brief);
      const r = assessScenePlanRichness(template);
      expect(r.ok, `richness for: ${brief} → ${r.issues.join("; ")}`).toBe(true);
    }
  });

  it("the thumbnail art reflects the leading structured demonstration (not always 'statement')", () => {
    const { template } = build(
      "The same data is entered four times across four systems.",
      "Entered four times",
      "Entered four times.",
    );
    expect(template.thumbnail.art).not.toBe("statement"); // previews the visual story
  });
});
