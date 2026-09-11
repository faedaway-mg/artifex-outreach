import { describe, it, expect } from "vitest";
import { assessProblemReality, isFunctionalPathClaim, counterTestPlan, type ProblemRealityInput } from "./problem-reality";

const bookingFinding = { observation: "there is no online booking so visitors cannot schedule an appointment", whyItMatters: "a visitor ready to book cannot" };

function base(over: Partial<ProblemRealityInput> = {}): ProblemRealityInput {
  return {
    finding: bookingFinding,
    observed: true,
    repeatable: true,
    specific: true,
    evidenceBacked: true,
    fixable: true,
    coherent: true,
    truthful: true,
    counterTest: { attempted: true, foundWorkingPath: false },
    ...over,
  };
}

describe("Problem Reality Gate (§1/§2/§33/§34)", () => {
  it("PROVEN when all criteria hold and the counter-test held", () => {
    const r = assessProblemReality(base());
    expect(r.verdict).toBe("PROVEN");
    expect(r.proceedsToPaid).toBe(true);
    expect(r.score).toBe(100);
  });

  it("NO_MATERIAL_PROBLEM when there is no finding (a GOOD result — site works)", () => {
    const r = assessProblemReality(base({ finding: null }));
    expect(r.verdict).toBe("NO_MATERIAL_PROBLEM");
    expect(r.proceedsToPaid).toBe(false);
  });

  it("NO_MATERIAL_PROBLEM for an immaterial (brand-recall) finding", () => {
    const r = assessProblemReality(base({ finding: { observation: "the business name appears in more than one form across the site", whyItMatters: "quietly weakens brand recall" } }));
    expect(r.verdict).toBe("NO_MATERIAL_PROBLEM");
  });

  it("DISPROVEN when the counter-test found a working path (§34/§6)", () => {
    const r = assessProblemReality(base({ counterTest: { attempted: true, foundWorkingPath: true } }));
    expect(r.verdict).toBe("DISPROVEN");
    expect(r.proceedsToPaid).toBe(false);
  });

  it("PLAUSIBLE (not PROVEN) when a functional-path claim has no counter-test yet", () => {
    const r = assessProblemReality(base({ counterTest: null }));
    expect(r.verdict).toBe("PLAUSIBLE");
    expect(r.proceedsToPaid).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/counter-test/i);
  });

  it("PLAUSIBLE when the evidence does not yet visibly prove the claim", () => {
    const r = assessProblemReality(base({ evidenceBacked: false }));
    expect(r.verdict).toBe("PLAUSIBLE");
  });

  it("WEAK when not observed / not specific / not truthful", () => {
    expect(assessProblemReality(base({ observed: false })).verdict).toBe("WEAK");
    expect(assessProblemReality(base({ specific: false })).verdict).toBe("WEAK");
    expect(assessProblemReality(base({ truthful: false })).verdict).toBe("WEAK");
  });

  it("an observational (non-path) finding does not require a counter-test to be PROVEN", () => {
    const r = assessProblemReality(base({ finding: { observation: "the body text has poor contrast and low readability" }, counterTest: null }));
    expect(r.requiresCounterTest).toBe(false);
    expect(r.verdict).toBe("PROVEN");
  });

  it("classifies functional-path claims that require a disprove counter-test", () => {
    expect(isFunctionalPathClaim("the booking button does not open a booking flow")).toBe(true);
    expect(isFunctionalPathClaim("the contact form does not submit")).toBe(true);
    expect(isFunctionalPathClaim("the body text has poor contrast")).toBe(false);
  });

  it("emits a booking counter-test plan that tries to find a working path (non-disruptive)", () => {
    const plan = counterTestPlan("there is no online booking");
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan.some((s) => /book now|schedule/i.test(s.action))).toBe(true);
    expect(plan.join(" ")).not.toMatch(/submit the form|book the appointment|create an account/i);
  });
});
