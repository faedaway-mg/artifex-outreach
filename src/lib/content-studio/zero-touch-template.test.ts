import { describe, it, expect } from "vitest";
import { buildZeroTouchTemplate, zeroTouchTemplateId } from "./zero-touch-template";
import { parseTemplate, validateTemplateStructure } from "./template-schema";
import { planSocialAnimation } from "./zero-touch-orchestrator";
import { composeScriptFromBrief } from "./zero-touch";

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
