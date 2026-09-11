import { describe, it, expect } from "vitest";
import { reconcileDecision, conservativeReality } from "./inventory-reconcile";
import { assessProblemReality } from "./problem-reality";

const proven = assessProblemReality({
  finding: { observation: "the contact form does not submit" }, observed: true, repeatable: true,
  specific: true, evidenceBacked: true, fixable: true, coherent: true, truthful: true,
  counterTest: { attempted: true, foundWorkingPath: false },
});

describe("reconcileDecision funnel order (§36-§39)", () => {
  const keepable = { inMarket: true, businessClosed: false, leadDisposition: "active" as const, reality: proven };

  it("keeps an in-market, alive, in-ICP, proven package", () => {
    expect(reconcileDecision(keepable).keep).toBe(true);
  });

  it("retires out-of-market FIRST (cheapest gate)", () => {
    const d = reconcileDecision({ ...keepable, inMarket: false });
    expect(d).toMatchObject({ keep: false, retireReason: "Wrong geography" });
  });

  it("retires a closed business", () => {
    expect(reconcileDecision({ ...keepable, businessClosed: true }).retireReason).toBe("Closed");
  });

  it("retires enterprise/disqualified ICP", () => {
    expect(reconcileDecision({ ...keepable, leadDisposition: "DISQUALIFIED_LEGACY" }).retireReason).toBe("Wrong ICP / too enterprise");
  });

  it("retires a NO_MATERIAL_PROBLEM package", () => {
    const noProblem = assessProblemReality({ finding: null, observed: false, repeatable: false, specific: false, evidenceBacked: false, fixable: false, coherent: false, truthful: false, counterTest: null });
    expect(reconcileDecision({ ...keepable, reality: noProblem }).retireReason).toBe("No material problem");
  });
});

describe("conservativeReality (offline, fail-closed)", () => {
  it("a material path claim with evidence is at most PLAUSIBLE offline (no counter-test)", () => {
    const r = conservativeReality({ finding: { observation: "there is no online booking to schedule an appointment" }, hasEvidence: true, coherent: true });
    expect(r.verdict).toBe("PLAUSIBLE");
    expect(r.proceedsToPaid).toBe(false);
  });

  it("an immaterial finding is NO_MATERIAL_PROBLEM", () => {
    const r = conservativeReality({ finding: { observation: "the business name appears in more than one form", whyItMatters: "quietly weakens brand recall" }, hasEvidence: true, coherent: true });
    expect(r.verdict).toBe("NO_MATERIAL_PROBLEM");
  });

  it("no finding → NO_MATERIAL_PROBLEM", () => {
    expect(conservativeReality({ finding: null, hasEvidence: false, coherent: true }).verdict).toBe("NO_MATERIAL_PROBLEM");
  });

  it("a material observational (non-path) finding with evidence can be PROVEN offline", () => {
    const r = conservativeReality({ finding: { observation: "the body text has very poor contrast and low readability" }, hasEvidence: true, coherent: true });
    expect(r.verdict).toBe("PROVEN");
  });
});
