import { describe, it, expect } from "vitest";
import { generateSocialIdeas, seedSocialIdeas, SOCIAL_IDEA_BANK } from "./social-ideas";

describe("social idea generator (mandate D §7/§12) — pure, no spend", () => {
  it("every bank idea is a real concept: title + hook + a multi-sentence brief", () => {
    for (const i of SOCIAL_IDEA_BANK) {
      expect(i.title.length).toBeGreaterThan(3);
      expect(i.hook.length).toBeGreaterThan(3);
      expect(i.brief.split(/[.!?]/).filter((s) => s.trim().length > 6).length).toBeGreaterThanOrEqual(2); // ≥2 sentences
      expect(i.targetSeconds).toBeGreaterThan(0);
    }
  });

  it("generates fresh ideas that avoid exact + semantic duplicates", () => {
    const first = generateSocialIdeas({ existingKeys: [], existingTitles: [], count: 1, seed: 0 })[0];
    // Feed it back as existing → it must not be re-suggested (exact key dedup).
    const next = generateSocialIdeas({ existingKeys: [first.key], existingTitles: [first.title], count: 1, seed: 0 })[0];
    expect(next.key).not.toBe(first.key);
    // Semantic dedup: "Nobody followed up." blocks a near-identical follow-up story by tokens.
    const blocked = generateSocialIdeas({ existingKeys: [], existingTitles: ["Nobody followed up on the lead"], count: 8, seed: 0 });
    expect(blocked.find((i) => i.key === "nobody-followed-up")).toBeUndefined();
  });

  it("honors an operator steer by ranking the closest concept first", () => {
    const ideas = generateSocialIdeas({ existingKeys: [], existingTitles: [], steer: "data entered twice into two systems", count: 1, seed: 3 });
    expect(ideas[0].theme).toBe("double-entry");
  });

  it("synthesizes a steered concept (with a usable brief) when nothing in the bank matches", () => {
    const allKeys = SOCIAL_IDEA_BANK.map((i) => i.key);
    const ideas = generateSocialIdeas({ existingKeys: allKeys, existingTitles: SOCIAL_IDEA_BANK.map((i) => i.title), steer: "restaurants losing reservations at midnight", count: 1, seed: 1 });
    expect(ideas).toHaveLength(1);
    expect(ideas[0].brief.length).toBeGreaterThan(40); // a real, usable brief — never empty
    expect(ideas[0].aspectRatio).toBe("9:16");
  });

  it("rotates on seed with no steer so 'Surprise me' varies", () => {
    const a = generateSocialIdeas({ existingKeys: [], existingTitles: [], count: 1, seed: 0 })[0];
    const b = generateSocialIdeas({ existingKeys: [], existingTitles: [], count: 1, seed: 1 })[0];
    expect(a.key).not.toBe(b.key);
  });

  it("seedSocialIdeas returns a small 9:16 starter set", () => {
    const seeded = seedSocialIdeas(4);
    expect(seeded).toHaveLength(4);
    expect(seeded.every((i) => i.aspectRatio === "9:16")).toBe(true);
  });
});
