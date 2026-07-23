import { describe, it, expect } from "vitest";
import type { OutreachEmail } from "./types";
import { scoreAuthenticity } from "./authenticity";

const email = (paragraphs: string[]): OutreachEmail => ({ subject: "s", subjectAlternatives: [], body: paragraphs.join("\n\n"), paragraphs, wordCount: paragraphs.join(" ").split(/\s+/).length });

const good = email([
  "Hi there,",
  "I was looking through Studio Smiles' website earlier and most of it looked good.",
  "One thing I wasn't sure about: how a new patient gets back in touch after a first visit.",
  "I'm Jordan, I run Artifex Labs. I could be wrong from the outside, so I mostly wanted to ask if that lines up with what you see.",
  "Happy to send over what I noticed if it's useful. No pressure either way.",
]);

describe("authenticity evaluator", () => {
  it("passes a real, curious, observation-led note", () => {
    const s = scoreAuthenticity(good);
    expect(s.pass).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(85);
  });

  it("fails an AI-ish opener", () => {
    const s = scoreAuthenticity(email(["Hi there,", "I wanted to reach out because I hope this finds you well.", "Let me know if you'd like to schedule a discovery call."]));
    expect(s.pass).toBe(false);
    expect(s.checks.find((c) => c.name === "Nothing that reads as AI")!.ok).toBe(false);
  });

  it("fails a sales CTA", () => {
    const s = scoreAuthenticity(email(["Hi,", "I looked at your site.", "Book a call now to schedule a discovery call."]));
    expect(s.checks.find((c) => c.name === "Not a sales email")!.ok).toBe(false);
  });

  it("fails consulting jargon", () => {
    const s = scoreAuthenticity(email(["Hi,", "I reviewed your operational efficiency and digital transformation opportunities.", "I could be wrong."]));
    expect(s.checks.find((c) => c.name === "No consulting jargon")!.ok).toBe(false);
  });

  it("flags an email with no real observation", () => {
    const s = scoreAuthenticity(email(["Hi,", "Your business seems great and full of potential.", "I could be wrong."]));
    expect(s.checks.find((c) => c.name === "Contains a real observation")!.ok).toBe(false);
  });

  it("flags a note that never admits uncertainty", () => {
    const s = scoreAuthenticity(email(["Hi,", "I looked through your website and found three problems you need to fix.", "Here is what to do."]));
    expect(s.checks.find((c) => c.name === "Admits uncertainty")!.ok).toBe(false);
  });
});
