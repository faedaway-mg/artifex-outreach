import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ESCAPED_DEFECTS, validateRegistry, escapedDefectSummary } from "./escaped-defects";

const ROOT = process.cwd();
const BREAKBOT_DIR = join(ROOT, "src/lib/breakbot");

// Resolve a coveredBy reference to a real on-disk guard. Coverage must never be
// folklore: a `path`, a `path:symbol`, or a bare finding-kind/invariant token must
// actually be present in the source, or the registry fails closed.
function guardExists(ref: string): boolean {
  if (ref.includes("/")) {
    const [path, symbol] = ref.split(/:(.+)/); // split on the FIRST colon only
    const abs = join(ROOT, path);
    if (!existsSync(abs)) return false;
    if (!symbol) return true;
    return readFileSync(abs, "utf8").includes(symbol);
  }
  // Bare token (e.g. a finding kind) — it must appear somewhere in the breakbot lib.
  for (const f of readdirSync(BREAKBOT_DIR)) {
    if (!f.endsWith(".ts")) continue;
    if (readFileSync(join(BREAKBOT_DIR, f), "utf8").includes(ref)) return true;
  }
  return false;
}

describe("escaped-defect registry (§29)", () => {
  it("every entry's covering guards actually exist on disk", () => {
    const result = validateRegistry(guardExists);
    if (!result.ok) {
      throw new Error(`registry references missing guards:\n${JSON.stringify(result.uncovered, null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  it("covers the mandate's required permanent-regression classes", () => {
    const ids = new Set(ESCAPED_DEFECTS.map((d) => d.id));
    for (const required of [
      "offer-purchasable-without-trust-video",
      "transcript-replaces-video",
      "media-route-login-redirect",
      "wrong-orientation-explainer",
      "blank-after-opening-explainer",
      "content-studio-exposes-machinery",
      "stale-prospects-in-active-views",
    ]) {
      expect(ids.has(required), `missing required escaped-defect: ${required}`).toBe(true);
    }
  });

  it("every entry is well-formed (id, class, surface, whyMissed, ≥1 guard)", () => {
    for (const d of ESCAPED_DEFECTS) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
      expect(d.defectClass.length).toBeGreaterThan(10);
      expect(d.whyMissed.length).toBeGreaterThan(10);
      expect(d.coveredBy.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("summary counts are consistent", () => {
    const s = escapedDefectSummary();
    expect(s.total).toBe(ESCAPED_DEFECTS.length);
    expect(Object.values(s.bySurface).reduce((a, b) => a + b, 0)).toBe(s.total);
  });
});
