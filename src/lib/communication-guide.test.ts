import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_TEMPLATES,
  BANNED_PHRASES,
  COMMUNICATION_GUIDE_SOURCE,
  OFFERINGS,
  type CommsContext,
} from "./communication-guide";

// A fully-populated context so no template needs to fall back to a [bracket].
const FULL: CommsContext = {
  firstName: "Dana",
  businessName: "Brightwood Dental",
  friction: "new-patient booking routes through one person",
  observation: "your booking link sits below the fold on mobile",
  referrer: "Sam Ortiz",
  day: "Thursday",
  time: "10:00am",
  timezone: "PT",
  link: "https://cal.com/artifex/x",
  duration: "45 minutes",
  milestone: "a working intake flow",
  cadence: "Friday",
  systemName: "the new intake system",
  outcome: "patients book in under a minute",
  investment: "$6,000",
  timeline: "3 weeks",
  scope: "online booking + reminders",
  period: "six months",
  nextPriority: "connecting scheduling to reminders",
};

const templateEntries = Object.entries(LIFECYCLE_TEMPLATES);

describe("Communication Guide — single source of truth", () => {
  it("declares its provenance (the approved brand document)", () => {
    expect(COMMUNICATION_GUIDE_SOURCE.document).toBe("ARTIFEX_COMMUNICATION_GUIDE.md");
    expect(COMMUNICATION_GUIDE_SOURCE.apex).toBe("ARTIFEX_BRAND_ARCHITECTURE.md");
  });

  it("covers the full customer lifecycle (17 stage templates)", () => {
    expect(templateEntries.length).toBe(17);
  });

  it("every template obeys the banned-phrase list — full context", () => {
    for (const [name, fn] of templateEntries) {
      const m = fn(FULL);
      const text = `${m.subject} ${m.body}`.toLowerCase();
      for (const bad of BANNED_PHRASES) expect(text, `${name} contains "${bad}"`).not.toContain(bad);
    }
  });

  it("every template obeys the banned-phrase list — empty context (fallbacks)", () => {
    for (const [name, fn] of templateEntries) {
      const m = fn({});
      const text = `${m.subject} ${m.body}`.toLowerCase();
      for (const bad of BANNED_PHRASES) expect(text, `${name} contains "${bad}"`).not.toContain(bad);
    }
  });

  it("never leaks an unfilled [bracket] when context is complete", () => {
    for (const [name, fn] of templateEntries) {
      const m = fn(FULL);
      expect(`${m.subject} ${m.body}`, `${name} leaked a bracket`).not.toMatch(/\[[a-z]/i);
    }
  });

  it("uses canonical fee language — 'Investment', never 'Price'", () => {
    const step = LIFECYCLE_TEMPLATES.scopedFirstStep(FULL);
    expect(step.body).toContain("Investment:");
    expect(step.body.toLowerCase()).not.toContain("price:");
    expect(step.body.toLowerCase()).not.toContain("cost:");
  });

  it("uses the canonical Title-Case offering names", () => {
    expect(LIFECYCLE_TEMPLATES.reviewInvitation(FULL).body).toContain(OFFERINGS.review);
    expect(LIFECYCLE_TEMPLATES.evolutionPlanIntro(FULL).body).toContain(OFFERINGS.plan);
    // The Plan is our proposal — but is never called "a proposal" as a one-off sale.
    expect(LIFECYCLE_TEMPLATES.evolutionPlanIntro(FULL).body).toContain("not a proposal in the usual sense");
  });

  it("no template uses an exclamation mark (guide §5, §6)", () => {
    for (const [name, fn] of templateEntries) {
      expect(fn(FULL).body, `${name} used an exclamation mark`).not.toContain("!");
    }
  });
});
