import { describe, it, expect } from "vitest";
import { detectMemories, missingConcepts, NATURAL_CONCEPTS } from "./memory-detect";

// Helper: find the one detection whose category matches, else undefined.
function pick(text: string, category: string) {
  return detectMemories(text).find((d) => d.category === category);
}

describe("memory detection — the Phase VI examples", () => {
  it("'We use Square.' → Existing System, quote preserved", () => {
    const d = pick("We use Square.", "Existing Systems");
    expect(d).toBeTruthy();
    expect(d!.value).toMatch(/Square/);
    expect(d!.quote).toBe("We use Square."); // evidence never lost
    expect(d!.concept).toBe("Systems");
  });

  it("'The owner is John.' → Decision Maker", () => {
    const d = pick("The owner is John.", "Decision Makers");
    expect(d).toBeTruthy();
    expect(d!.value).toMatch(/John/);
    expect(d!.concept).toBe("People");
  });

  it("'We're trying to hire another hygienist.' → Business Goal", () => {
    const d = pick("We're trying to hire another hygienist.", "Business Goals");
    expect(d).toBeTruthy();
    expect(d!.quote).toBe("We're trying to hire another hygienist.");
    expect(d!.concept).toBe("Goals");
  });

  it("'We never answer phones after 2.' → Known Constraint", () => {
    const d = pick("We never answer phones after 2pm.", "Known Constraints");
    expect(d).toBeTruthy();
    expect(d!.concept).toBe("Constraints");
  });

  it("'We don't really like subscriptions.' → Business Philosophy", () => {
    const d = pick("We don't really like subscriptions.", "Business Philosophy");
    expect(d).toBeTruthy();
    expect(d!.value).toMatch(/recurring/i);
    expect(d!.concept).toBe("Preferences");
  });
});

describe("memory detection — discipline", () => {
  it("preserves the original quote on every detection", () => {
    const text = "We use Square. The owner is Maria. We're trying to open a second location.";
    for (const d of detectMemories(text)) {
      expect(text).toContain(d.quote.replace(/…$/, ""));
    }
  });

  it("does not hallucinate from empty or neutral text", () => {
    expect(detectMemories("")).toHaveLength(0);
    expect(detectMemories("It was a nice conversation about the weather.")).toHaveLength(0);
  });

  it("dedupes repeated mentions, keeping one per fact", () => {
    const d = detectMemories("We use Square. We use Square for everything.");
    expect(d.filter((x) => x.category === "Existing Systems")).toHaveLength(1);
  });

  it("detects several distinct memories from a real snippet", () => {
    const text = [
      "We use Square for checkout.",
      "The owner is John.",
      "We're trying to hire another hygienist this year.",
      "We never answer phones after 2pm.",
      "We don't really like subscriptions.",
    ].join(" ");
    const cats = new Set(detectMemories(text).map((d) => d.category));
    expect(cats.has("Existing Systems")).toBe(true);
    expect(cats.has("Decision Makers")).toBe(true);
    expect(cats.has("Business Goals")).toBe(true);
    expect(cats.has("Known Constraints")).toBe(true);
    expect(cats.has("Business Philosophy")).toBe(true);
  });
});

describe("adaptive assistant — missing concepts", () => {
  it("prompts for core concepts not yet covered", () => {
    const missing = missingConcepts(["Systems"]);
    expect(missing.map((m) => m.concept)).not.toContain("Systems");
    expect(missing.map((m) => m.concept)).toContain("People");
    for (const m of missing) expect(m.prompt.length).toBeGreaterThan(0);
  });

  it("returns nothing to nudge once the core is covered", () => {
    const missing = missingConcepts(["People", "Goals", "Systems", "Constraints", "Preferences"]);
    expect(missing).toHaveLength(0);
  });

  it("NATURAL_CONCEPTS is the operator's vocabulary", () => {
    expect(NATURAL_CONCEPTS).toContain("People");
    expect(NATURAL_CONCEPTS).toContain("Systems");
  });
});
