// ─────────────────────────────────────────────────────────────────────────────
// The policy gate on automatic ownership movement.
//
// Shipping this code and letting a scheduler start moving a real book of business
// are two separate decisions. These tests defend the boundary: while the gate is
// off, ownership must behave exactly as it did before multi-operator existed, and
// no automatic path may write a reassignment.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { distributionEnabled } from "./distribute";

const KEY = "OPERATOR_DISTRIBUTION_ENABLED";
let original: string | undefined;

beforeEach(() => { original = process.env[KEY]; });
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("distributionEnabled", () => {
  it("is OFF when the variable is absent — the safe default, not the convenient one", () => {
    delete process.env[KEY];
    expect(distributionEnabled()).toBe(false);
  });

  it("is OFF for every value except an exact '1', so a typo never opens the gate", () => {
    for (const v of ["", "0", "true", "TRUE", "yes", "on", " 1", "1 "]) {
      process.env[KEY] = v;
      expect(distributionEnabled()).toBe(false);
    }
  });

  it("is ON only for an explicit '1'", () => {
    process.env[KEY] = "1";
    expect(distributionEnabled()).toBe(true);
  });
});
