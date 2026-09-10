import { describe, it, expect } from "vitest";
import { JOURNEY_ASSERTIONS, ratchetReport, criticalDeferred } from "./journey-assertions";

describe("synthetic-journey assertion ratchet (§10)", () => {
  it("no CRITICAL assertion is left deferred", () => {
    const bad = criticalDeferred();
    if (bad.length) throw new Error(`critical assertions still deferred:\n${bad.map((a) => a.id).join(", ")}`);
    expect(bad).toHaveLength(0);
  });

  it("covers the critical customer + operator surfaces", () => {
    const surfaces = new Set(JOURNEY_ASSERTIONS.filter((a) => a.criticality === "critical").map((a) => a.surface));
    for (const s of ["operator", "offer", "customer-portal", "content-studio", "fulfillment"]) {
      expect(surfaces.has(s), `no critical assertion for ${s}`).toBe(true);
    }
  });

  it("a registry-active critical anchor missing from the live DOM BLOCKS (no silent downgrade)", () => {
    const all = new Set(JOURNEY_ASSERTIONS.map((a) => a.testid));
    // Everything present → no block.
    expect(ratchetReport(all).blocked).toHaveLength(0);
    // Remove a critical anchor (e.g. the offer trust video) → blocked.
    all.delete("trust-video");
    const rep = ratchetReport(all);
    expect(rep.blocked.some((b) => b.testid === "trust-video")).toBe(true);
  });

  it("scopes to driven surfaces — an unvisited surface is untested, not blocked", () => {
    // Only the operator + content-studio surfaces were driven; offer/portal anchors absent
    // from the found-set must NOT block (they were never visited).
    const foundOnlyOperator = new Set(
      JOURNEY_ASSERTIONS.filter((a) => a.surface === "operator" || a.surface === "content-studio").map((a) => a.testid),
    );
    const rep = ratchetReport(foundOnlyOperator, new Set(["operator", "content-studio"]));
    expect(rep.blocked).toHaveLength(0);
    // But if a driven surface is missing one of its own critical anchors → blocked.
    foundOnlyOperator.delete("cockpit");
    expect(ratchetReport(foundOnlyOperator, new Set(["operator", "content-studio"])).blocked.some((b) => b.testid === "cockpit")).toBe(true);
  });

  it("deferred assertions carry a reason", () => {
    for (const a of JOURNEY_ASSERTIONS.filter((x) => x.status === "deferred")) {
      expect(a.reason && a.reason.length > 0, `deferred ${a.id} needs a reason`).toBe(true);
    }
  });
});
