import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "./profile";
import { FIXTURES } from "./fixtures";

// Determinism is a hard invariant: the profile feeds persisted records, PDFs, and
// pricing, so the same inputs must yield byte-identical output on every run.
describe("Determinism", () => {
  it("produces identical output across repeated builds for every business type", () => {
    for (const f of FIXTURES) {
      const a = buildBusinessProfile(f.input);
      const b = buildBusinessProfile(f.input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("never stamps a timestamp itself (generatedAt stays null)", () => {
    for (const f of FIXTURES) expect(buildBusinessProfile(f.input).generatedAt).toBeNull();
  });

  it("orders opportunities and dimensions stably", () => {
    const runs = Array.from({ length: 5 }, () => buildBusinessProfile(FIXTURES[4].input));
    const first = JSON.stringify(runs[0].opportunities);
    for (const r of runs) expect(JSON.stringify(r.opportunities)).toBe(first);
  });

  it("does not depend on evidence array order", () => {
    const f = FIXTURES[0];
    const evidence = f.input.evidence ?? [];
    const forward = buildBusinessProfile({ ...f.input, evidence });
    const reversed = buildBusinessProfile({ ...f.input, evidence: [...evidence].reverse() });
    // Readings and opportunities must be stable regardless of provider ordering.
    expect(JSON.stringify(forward.dimensions)).toBe(JSON.stringify(reversed.dimensions));
    expect(JSON.stringify(forward.opportunities)).toBe(JSON.stringify(reversed.opportunities));
  });
});
