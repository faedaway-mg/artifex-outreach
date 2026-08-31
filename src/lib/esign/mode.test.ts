import { describe, it, expect } from "vitest";
import { deriveEsignMode, canSetEsignMode, assertModeAssignable, EsignModeError, modeMismatchReason, signwellTestModeFor } from "./mode";

describe("deriveEsignMode (server-side, fail closed)", () => {
  it("returns production ONLY when owner-authorized AND gate on AND prod runtime", () => {
    expect(deriveEsignMode({ ownerAuthorizedProduction: true, productionGateEnv: "true", nodeEnv: "production" })).toBe("production");
  });
  it("falls back to test if any condition is missing", () => {
    expect(deriveEsignMode({ ownerAuthorizedProduction: true, productionGateEnv: "true", nodeEnv: "development" })).toBe("test");
    expect(deriveEsignMode({ ownerAuthorizedProduction: true, productionGateEnv: undefined, nodeEnv: "production" })).toBe("test");
    expect(deriveEsignMode({ ownerAuthorizedProduction: false, productionGateEnv: "true", nodeEnv: "production" })).toBe("test");
  });
  it("never trusts a truthy-looking non-gate value", () => {
    expect(deriveEsignMode({ ownerAuthorizedProduction: true, productionGateEnv: "yes-please", nodeEnv: "production" })).toBe("test");
  });
});

describe("signwellTestModeFor", () => {
  it("test → true, production → false", () => {
    expect(signwellTestModeFor("test")).toBe(true);
    expect(signwellTestModeFor("production")).toBe(false);
  });
});

describe("mode immutability", () => {
  it("settable only pre-send", () => {
    expect(canSetEsignMode("draft")).toBe(true);
    expect(canSetEsignMode("approved")).toBe(true);
    expect(canSetEsignMode("sent")).toBe(false);
    expect(canSetEsignMode("signed")).toBe(false);
  });
  it("assertModeAssignable: first set ok pre-send, no-op if same, throws on change or post-send", () => {
    expect(() => assertModeAssignable({ status: "approved", esignMode: null }, "production")).not.toThrow();
    expect(() => assertModeAssignable({ status: "sent", esignMode: "test" }, "test")).not.toThrow(); // same value no-op
    expect(() => assertModeAssignable({ status: "approved", esignMode: "test" }, "production")).toThrow(EsignModeError);
    expect(() => assertModeAssignable({ status: "signed", esignMode: "production" }, "test")).toThrow(EsignModeError);
    expect(() => assertModeAssignable({ status: "sent", esignMode: null }, "test")).toThrow(EsignModeError); // past pre-send
  });
});

describe("modeMismatchReason", () => {
  it("null when consistent, reason when not", () => {
    expect(modeMismatchReason("test", true)).toBeNull();
    expect(modeMismatchReason("production", false)).toBeNull();
    expect(modeMismatchReason("test", false)).toMatch(/disagrees/);
    expect(modeMismatchReason("production", true)).toMatch(/disagrees/);
  });
});
