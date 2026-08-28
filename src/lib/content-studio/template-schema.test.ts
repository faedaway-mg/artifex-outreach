import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTemplate } from "./template-schema";

const seven = JSON.parse(readFileSync(path.join(process.cwd(), "public/content/templates/007.json"), "utf8"));

describe("template schema", () => {
  it("accepts the authored #007 template", () => {
    const r = parseTemplate(seven);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.template.beats.length).toBe(8); expect(r.template.narration.length).toBe(8); }
  });

  it("requires exactly one brand beat, last", () => {
    const noBrand = { ...seven, beats: seven.beats.filter((b: any) => b.type !== "brand") };
    expect(parseTemplate(noBrand).ok).toBe(false);
    const brandNotLast = { ...seven, beats: [seven.beats[seven.beats.length - 1], ...seven.beats.slice(0, -1)] };
    const r = parseTemplate(brandNotLast);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown beat type", () => {
    const bad = { ...seven, beats: [{ type: "explode", lines: [0] }, { type: "brand" }] };
    expect(parseTemplate(bad).ok).toBe(false);
  });

  it("rejects out-of-range narration line references", () => {
    const bad = { ...seven, beats: [{ ...seven.beats[0], lines: [99] }, ...seven.beats.slice(1)] };
    const r = parseTemplate(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/narration line 99/);
  });

  it("enforces length caps (no unbounded strings)", () => {
    const bad = { ...seven, title: "x".repeat(500) };
    expect(parseTemplate(bad).ok).toBe(false);
  });

  it("rejects too many beats", () => {
    const many = { ...seven, beats: [...Array(11).fill(seven.beats[0]), { type: "brand" }] };
    expect(parseTemplate(many).ok).toBe(false);
  });
});
