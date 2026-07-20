import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "./profile";
import { reading } from "./context";
import { SIGNALS_BY_DIMENSION } from "./signals";
import { DIMENSIONS } from "./types";
import { FIXTURES } from "./fixtures";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { confidence } from "./confidence";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

// The engine must NEVER invent an observation. These tests guard that invariant
// from several angles.
describe("No fabrication", () => {
  it("refuses to construct a reading with no basis", () => {
    expect(() =>
      reading({ key: "x", dimension: "operations", label: "X", status: "strong", summary: "made up", confidence: confidence("Observed"), basis: [] }),
    ).toThrow(/no basis|fabricat/i);
  });

  it("every reading in every profile carries provenance", () => {
    for (const f of FIXTURES) {
      const p = buildBusinessProfile(f.input);
      for (const dim of DIMENSIONS) {
        for (const r of p.dimensions[dim].readings) {
          expect(r.basis.length, `${f.label} · ${r.key}`).toBeGreaterThan(0);
          for (const b of r.basis) expect(b.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every opportunity traces back to a basis", () => {
    for (const f of FIXTURES) {
      for (const o of buildBusinessProfile(f.input).opportunities) {
        expect(o.basis.length, `${f.label} · ${o.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("never assesses a website for a business that has none", () => {
    const p = buildBusinessProfile({ lead: makeLead({ ...noWeb, socialLinks: ["https://facebook.com/x"] }) });
    const dp = p.dimensions["digital-presence"].readings.map((r) => r.key);
    // Website-only signals must be absent entirely (not guessed as strong/weak).
    for (const k of ["mobile-friendliness", "page-speed", "navigation-quality", "accessibility"]) {
      expect(dp).not.toContain(k);
    }
    expect(p.dimensions["digital-presence"].readings.find((r) => r.key === "website-quality")?.status).toBe("absent");
  });

  it("an effectively invisible business yields no invented capabilities", () => {
    const p = buildBusinessProfile({ lead: makeLead({ ...noWeb, businessName: "Ghost Co", industry: "Retail shop", rating: 0, reviewCount: 0 }) });
    const all = DIMENSIONS.flatMap((d) => p.dimensions[d].readings);
    // No reading may claim a website, reviews, booking, or a Google listing exist.
    for (const r of all) {
      expect(r.summary).not.toMatch(/\bhas a website\b|well-built|online booking present|listed on google/i);
    }
    // Discovery is genuinely weak/absent — nothing strong invented.
    expect(p.dimensions.discovery.readings.every((r) => r.status !== "strong")).toBe(true);
  });

  it("emits at most one reading per registered signal (no duplication)", () => {
    for (const f of FIXTURES) {
      const p = buildBusinessProfile(f.input);
      for (const dim of DIMENSIONS) {
        expect(p.dimensions[dim].readings.length).toBeLessThanOrEqual(SIGNALS_BY_DIMENSION[dim].length);
        const keys = p.dimensions[dim].readings.map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it("unknown readings are honestly labelled Unknown, not dressed up", () => {
    for (const f of FIXTURES) {
      const p = buildBusinessProfile(f.input);
      for (const dim of DIMENSIONS) {
        for (const r of p.dimensions[dim].readings) {
          if (r.status === "unknown") expect(r.confidence.label).toBe("Unknown");
        }
      }
    }
  });
});
