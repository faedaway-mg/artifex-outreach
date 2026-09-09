// ─────────────────────────────────────────────────────────────────────────────
// FIRST SEND GATE + HEALTH PROVENANCE — the readiness verdict is advisory only and
// TRUE only when every condition holds AND inventory is sendable; the health route
// exposes the deployed commit for deterministic source provenance.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateFirstSendGate, type FirstSendConditions } from "./first-send-gate";

const ALL_GOOD: FirstSendConditions = {
  sourceProvenanceExact: true,
  legacyOutreachFrozen: true,
  googleTransportConfigured: true,
  stripeLiveCapable: true,
  legalApproved: true,
  strictQualificationActive: true,
  sendableInventory: 5,
  fulfillmentPersistenceActive: true,
  customerStatusFlowActive: true,
  captionsNotAutoStale: true,
};

describe("first-send gate — advisory readiness, never an action", () => {
  it("READY only when every condition holds and inventory is sendable", () => {
    const v = evaluateFirstSendGate(ALL_GOOD);
    expect(v.ready).toBe(true);
    expect(v.blockers).toHaveLength(0);
    expect(v.performsAction).toBe(false);
  });
  it("zero sendable inventory blocks readiness", () => {
    const v = evaluateFirstSendGate({ ...ALL_GOOD, sendableInventory: 0 });
    expect(v.ready).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/Sendable inventory/);
  });
  it("a provenance mismatch blocks readiness", () => {
    const v = evaluateFirstSendGate({ ...ALL_GOOD, sourceProvenanceExact: false });
    expect(v.ready).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/provenance/i);
  });
  it("an unfrozen legacy path or unapproved legal gate blocks readiness", () => {
    expect(evaluateFirstSendGate({ ...ALL_GOOD, legacyOutreachFrozen: false }).ready).toBe(false);
    expect(evaluateFirstSendGate({ ...ALL_GOOD, legalApproved: false }).ready).toBe(false);
  });
});

describe("health route exposes deployed commit (provenance)", () => {
  const health = readFileSync(path.join(process.cwd(), "src/app/api/health/route.ts"), "utf8");
  it("reports the deployed commit from APP_VERSION / RAILWAY_GIT_COMMIT_SHA (not a hard-coded SHA)", () => {
    expect(health).toMatch(/APP_VERSION/);
    expect(health).toMatch(/RAILWAY_GIT_COMMIT_SHA/);
    expect(health).toMatch(/commit/);
    // No 40-hex SHA literal baked into the source.
    expect(health).not.toMatch(/["'][0-9a-f]{40}["']/);
  });
  it("the deploy script pins APP_VERSION to the committed SHA and asserts it in the smoke test", () => {
    const deploy = readFileSync(path.join(process.cwd(), "scripts/deploy-production.sh"), "utf8");
    expect(deploy).toMatch(/APP_VERSION=\$SHA/);
    expect(deploy).toMatch(/health SHA/i);
  });
});
