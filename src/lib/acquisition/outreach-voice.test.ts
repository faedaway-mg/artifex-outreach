import { describe, it, expect } from "vitest";
import { buildSequence } from "./sequences";
import { defaultSettings } from "../store";
import { makeLead } from "../test-lead";
import type { AcquisitionStrategy } from "../types";
import { BANNED_PHRASES } from "../communication-guide";

const STRATS: AcquisitionStrategy[] = ["Personal", "Assisted", "Light", "Nurture"];
const BANNED = [
  "your website is outdated",
  "we build websites",
  "websites, apps, and automations",
  "redesign your website",
  "your website is bad",
];

describe("Outreach voice — friction-finder, not vendor", () => {
  const settings = defaultSettings();

  it("never uses banned vendor / shame phrasing", () => {
    for (const strat of STRATS) {
      const steps = buildSequence(strat, makeLead(), settings, "I noticed a couple of specific things worth comparing.");
      for (const s of steps) {
        const text = `${s.subject} ${s.content}`.toLowerCase();
        for (const bad of BANNED) expect(text, `${strat}/${s.stepNumber}`).not.toContain(bad);
      }
    }
  });

  it("obeys the Communication Guide's banned-phrase list (§3.2/§8)", () => {
    for (const strat of STRATS) {
      const steps = buildSequence(strat, makeLead(), settings, "I noticed a couple of specific things worth comparing.");
      for (const s of steps) {
        const text = `${s.subject} ${s.content}`.toLowerCase();
        for (const bad of BANNED_PHRASES) expect(text, `${strat}/${s.stepNumber} contains "${bad}"`).not.toContain(bad);
      }
    }
  });

  it("keeps compliance: every email carries an unsubscribe token", () => {
    for (const strat of STRATS) {
      for (const s of buildSequence(strat, makeLead(), settings, "obs")) {
        expect(s.content).toContain("{{unsubscribe}}");
      }
    }
  });

  it("leads with a low-pressure, conversational CTA rather than a hard sell", () => {
    const first = buildSequence("Assisted", makeLead(), settings, "obs")[0];
    expect(first.content.toLowerCase()).toMatch(/compar(e|ing) notes|fifteen minutes|brief|low-pressure|conversation|happy to (be wrong|hear it)/);
  });

  it("acknowledges public information is only part of the picture (humility)", () => {
    const first = buildSequence("Personal", makeLead(), settings, "obs")[0];
    expect(first.content.toLowerCase()).toContain("part of the picture");
  });

  it("respects hard max touches per strategy", () => {
    expect(buildSequence("Light", makeLead(), settings, "obs").length).toBeLessThanOrEqual(2);
    expect(buildSequence("Personal", makeLead(), settings, "obs").length).toBeLessThanOrEqual(4);
  });
});
