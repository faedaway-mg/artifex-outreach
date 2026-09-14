import { describe, it, expect } from "vitest";
import { qualifyThroughFunnel } from "../acquisition/qualification-funnel";
import type { CounterTestRunner } from "./runner";
import type { ProblemRealityStatus } from "./types";
import { evaluateFirstTouchCopy } from "../outreach/copy-gate";

// A fake runner that forces a specific verdict, so we test funnel routing deterministically
// without launching a browser.
const runnerWith = (verdict: ProblemRealityStatus): CounterTestRunner => ({
  kind: "inline",
  async run(h) {
    return { executed: true, verdict, rationale: `forced ${verdict}`, hypothesis: h, actions: [], alternates: [] } as any;
  },
});

// An in-pod, ICP-valid, testable candidate (Greenville SC dentist with a website).
const CAND = { id: "lead_x", businessName: "Bright Smiles Dentistry", industry: "dentist", city: "Greenville", state: "SC", website: "https://brightsmiles.example", businessStatus: "OPERATIONAL" } as any;

describe("OBSERVED verdict — routing", () => {
  it("PROVEN promotes (route decided downstream, not forced to CONVERSATION)", async () => {
    const fr = await qualifyThroughFunnel(CAND, runnerWith("PROVEN"));
    expect(fr.decision).toBe("promote");
    expect(fr.verdict).toBe("PROVEN");
    expect(fr.route).toBeUndefined(); // strategy decides DIRECT_FIX / FIX_SCAN / CONVERSATION
  });

  it("OBSERVED does NOT promote — research only, never outreach (verdict preserved)", async () => {
    const fr = await qualifyThroughFunnel(CAND, runnerWith("OBSERVED"));
    expect(fr.decision).toBe("reject");
    expect(fr.verdict).toBe("OBSERVED"); // preserved for internal research/retesting
  });

  it("OBSERVED / DISPROVEN / NO_MATERIAL / NEEDS_MORE_EVIDENCE all reject (no outreach)", async () => {
    for (const v of ["OBSERVED", "DISPROVEN", "NO_MATERIAL_PROBLEM", "NEEDS_MORE_EVIDENCE"] as ProblemRealityStatus[]) {
      const fr = await qualifyThroughFunnel(CAND, runnerWith(v));
      expect(fr.decision).toBe("reject");
    }
  });
});

describe("OBSERVED verdict — copy-gate claim restrictions", () => {
  it("OBSERVED: a definite-defect claim is SUPPRESSED (only PROVEN may assert)", () => {
    const r = evaluateFirstTouchCopy({
      subject: "Your booking", body: "Hi, I looked at Bright Smiles Dentistry and your booking form doesn't work — no one can book online. Happy to send what I found.",
      businessName: "Bright Smiles Dentistry", problemRealityStatus: "OBSERVED",
    });
    expect(r.pass).toBe(false);
    expect(r.scores.claimSafety).toBe(0);
  });

  it("OBSERVED: a causal-loss claim ('costing you customers') is SUPPRESSED unless PROVEN", () => {
    const r = evaluateFirstTouchCopy({
      subject: "Bookings", body: "Hi, not having online booking is costing you customers every week at Bright Smiles Dentistry. Want the details?",
      businessName: "Bright Smiles Dentistry", problemRealityStatus: "OBSERVED",
    });
    expect(r.pass).toBe(false);
    expect(r.scores.claimSafety).toBe(0);
  });

  it("OBSERVED: a hedged, business-specific observation with truthful uncertainty PASSES", () => {
    const r = evaluateFirstTouchCopy({
      subject: "One thing on Bright Smiles' site",
      body: "Hi, I was looking through Bright Smiles Dentistry's website earlier and wasn't sure whether new patients can book online, or if that's intentional on your end. Happy to send over exactly what I noticed — no pressure.",
      businessName: "Bright Smiles Dentistry", problemRealityStatus: "OBSERVED",
    });
    expect(r.pass).toBe(true);
    expect(r.scores.claimSafety).toBe(1);
  });
});
