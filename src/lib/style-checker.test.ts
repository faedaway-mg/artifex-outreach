import { describe, it, expect } from "vitest";
import { analyzeStyle, sanitize, rewriteUntilNatural } from "./style-checker";

describe("Style checker", () => {
  it("passes clean, natural copy", () => {
    const r = analyzeStyle(
      "Morning — I came across your Google listing while looking at how local shops show up. When the phone rings and you're busy, what happens to that call?",
    );
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("flags robotic, scripted language", () => {
    const r = analyzeStyle("Hi, I wanted to reach out because I'm calling today about your business. Does that make sense?");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === "robotic")).toBe(true);
  });

  it("flags a repeated content word", () => {
    const r = analyzeStyle("Your business helps the business grow because business is what the business is about for the business.");
    expect(r.issues.some((i) => i.kind === "repeated-word" && /business/.test(i.detail))).toBe(true);
  });

  it("flags a repeated phrase", () => {
    const r = analyzeStyle("We help local shops. We help local shops find where they lose time every single day.");
    expect(r.issues.some((i) => i.kind === "repeated-phrase")).toBe(true);
  });

  it("flags generic filler", () => {
    const r = analyzeStyle("I just really basically wanted to just very quickly share a really simple idea.");
    expect(r.issues.some((i) => i.kind === "filler")).toBe(true);
  });

  it("flags awkward doubled words and run-ons", () => {
    const dbl = analyzeStyle("I saw the the listing.");
    expect(dbl.issues.some((i) => i.kind === "awkward" && /doubled/.test(i.detail))).toBe(true);
  });

  it("sanitize strips filler and collapses doubled words and spacing", () => {
    const out = sanitize("I just really wanted to  share the the idea.");
    expect(out).not.toMatch(/\bjust\b/i);
    expect(out).not.toMatch(/the the/i);
    expect(out).not.toMatch(/ {2,}/);
  });

  it("rewriteUntilNatural returns the natural variant when one is offered", () => {
    const variants = [
      "I wanted to reach out because I'm calling today.", // robotic
      "The business business is the business.", // repeated
      "Morning — I looked at how you show up online and had one specific thought worth comparing.", // clean
    ];
    const r = rewriteUntilNatural((n) => variants[Math.min(n, variants.length - 1)], { maxAttempts: 3, sanitizePass: false });
    expect(r.natural).toBe(true);
    expect(r.text).toMatch(/worth comparing/);
  });

  it("rewriteUntilNatural returns the best available when nothing is perfect", () => {
    const bad = ["The business business is the business.", "I wanted to reach out today, today."];
    const r = rewriteUntilNatural((n) => bad[Math.min(n, bad.length - 1)], { maxAttempts: 2, sanitizePass: false });
    expect(r.text.length).toBeGreaterThan(0);
    // It still returns something — the highest-scoring candidate it saw.
    expect(r.report.score).toBeGreaterThanOrEqual(0);
  });
});
