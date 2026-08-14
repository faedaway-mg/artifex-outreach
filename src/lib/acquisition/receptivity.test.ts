// ─────────────────────────────────────────────────────────────────────────────
// Receptivity / timing acceptance tests (A–P).
//
// These pin the SPRINT INTENT, not just the code: FIT and RECEPTIVITY are distinct;
// "no signal ≠ uninterested"; a weak signal can never overpower fundamentals; a
// tiny business is not made attractive by a signal; every signal keeps its evidence
// + provenance; outreach copy can never over-claim intent; the learning loop can
// aggregate real outcomes by signal × tier. No test performs any real send.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  receptivitySignalsFrom, receptivityScore, hasStrongSignal, receptivityAngle,
  type ReceptivitySignal,
} from "./receptivity";
import { prospectPriority, signalOutcomeExperiment } from "./prospect-priority";
import { confidence, type ConfidenceLabel } from "../business-intelligence/confidence";
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";

// A minimal opportunity fixture — only the fields receptivity reads.
function opp(
  category: OpportunityCategory,
  label: ConfidenceLabel,
  observation: string,
  extra: Partial<ModernizationOpportunity> = {},
): ModernizationOpportunity {
  return {
    id: `${category}-${label}`.toLowerCase().replace(/\s+/g, "-"),
    category,
    observation,
    whyItMatters: `Why ${category} matters to the business.`,
    estimatedImpact: { level: "Moderate", rationale: "coarse" },
    confidence: confidence(label),
    basis: ["public website HTML", "reviews"],
    ...extra,
  };
}

describe("receptivity — evidence, not aesthetics", () => {
  // A. FIT and RECEPTIVITY are different questions. A high-fit business with only
  //    latent/inferred potential produces NO receptivity signal.
  it("A: latent fit (Inferred/Likely) is NOT a receptivity signal", () => {
    const signals = receptivitySignalsFrom({
      opportunities: [
        opp("Automation", "Likely", "Could benefit from automating invoices"),
        opp("Analytics", "Inferred", "May lack reporting"),
      ],
    });
    expect(signals).toHaveLength(0);
    expect(receptivityScore(signals)).toBe(0);
  });

  // B. Only DIRECTLY-observed / reported current conditions become signals.
  it("B: only Observed/Reported current conditions become signals", () => {
    const signals = receptivitySignalsFrom({
      opportunities: [
        opp("Scheduling", "Observed", "No online booking; phone-only scheduling"),
        opp("Communication", "Reported", "Reviews mention slow callbacks"),
        opp("Automation", "Observed", "Manual data entry"), // Automation not a receptivity category
      ],
    });
    // Scheduling + Communication qualify; Automation is latent fit, not receptivity.
    expect(signals.map((s) => s.type).sort()).toEqual(["communication-gap", "scheduling-friction"]);
  });

  // C. Each signal carries type/source/evidence/observedAt/confidence/explanation/current.
  it("C: every signal retains its evidence + provenance", () => {
    const [s] = receptivitySignalsFrom({
      opportunities: [opp("Scheduling", "Observed", "No online booking widget found")],
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(s.type).toBe("scheduling-friction");
    expect(s.evidence).toBe("No online booking widget found");
    expect(s.source).toContain("public website HTML");
    expect(s.explanation).toContain("Scheduling");
    expect(s.confidence).toBe("Observed");
    expect(s.observedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(s.current).toBe(true);
  });

  // D. "No signal" is empty, and that means "no observed signal yet" — NOT uninterested.
  it("D: no qualifying observation → [] (no observed signal yet, not uninterested)", () => {
    const signals = receptivitySignalsFrom({ opportunities: [] });
    expect(signals).toEqual([]);
    expect(receptivityScore(signals)).toBe(0);
    expect(hasStrongSignal(signals)).toBe(false);
  });

  // E. Score is bounded and confidence-weighted (Observed > Reported).
  it("E: score is bounded and weighted by confidence", () => {
    const observed = receptivitySignalsFrom({ opportunities: [opp("Scheduling", "Observed", "x")] });
    const reported = receptivitySignalsFrom({ opportunities: [opp("Scheduling", "Reported", "x")] });
    expect(receptivityScore(observed)).toBeGreaterThan(receptivityScore(reported));
    // Even many signals cannot exceed the cap.
    const many = receptivitySignalsFrom({
      opportunities: Array.from({ length: 20 }, (_, i) => opp("Scheduling", "Observed", `x${i}`)),
    });
    expect(receptivityScore(many)).toBeLessThanOrEqual(8);
  });

  // F. Strong signal requires a DIRECTLY-observed condition.
  it("F: hasStrongSignal is true only for an Observed signal", () => {
    expect(hasStrongSignal(receptivitySignalsFrom({ opportunities: [opp("Scheduling", "Reported", "x")] }))).toBe(false);
    expect(hasStrongSignal(receptivitySignalsFrom({ opportunities: [opp("Scheduling", "Observed", "x")] }))).toBe(true);
  });
});

describe("prospect priority — fit foundational, receptivity a bounded nudge", () => {
  // G. With comparable fit, real observed evidence surfaces a prospect higher.
  it("G: observed evidence breaks a near-tie in favor of the receptive prospect", () => {
    const withSignal = prospectPriority({ fitScore: 70, receptivity: 4, established: true });
    const without = prospectPriority({ fitScore: 70, receptivity: 0, established: true });
    expect(withSignal.total).toBeGreaterThan(without.total);
  });

  // H. A weak signal can NEVER overpower dramatically better fundamentals.
  it("H: a weak signal cannot overpower much stronger fit", () => {
    const strongFitNoSignal = prospectPriority({ fitScore: 90, receptivity: 0, established: true });
    const weakFitBigSignal = prospectPriority({ fitScore: 80, receptivity: 8, established: true });
    // 80 + capped-6 = 86 < 90. Fit wins.
    expect(strongFitNoSignal.total).toBeGreaterThan(weakFitBigSignal.total);
  });

  // I. A tiny / non-established business is NOT made attractive by a signal alone.
  it("I: a non-established business gets no receptivity boost", () => {
    const tiny = prospectPriority({ fitScore: 40, receptivity: 8, established: false });
    expect(tiny.receptivityBoost).toBe(0);
    expect(tiny.total).toBe(40);
    expect(tiny.because.join(" ")).toContain("not established");
  });

  // J. The boost is explained and capped.
  it("J: receptivity boost is capped and explained", () => {
    const r = prospectPriority({ fitScore: 50, receptivity: 100, established: true });
    expect(r.receptivityBoost).toBe(6);
    expect(r.because.some((b) => b.includes("Fit 50"))).toBe(true);
  });
});

describe("outreach copy — grounded in the business's OWN evidence, never over-claims", () => {
  const observed: ReceptivitySignal[] = receptivitySignalsFrom({
    opportunities: [opp("Scheduling", "Observed", "No online booking; customers must call to book")],
  });

  // K. Angle is produced ONLY with a strong observed signal, and uses that evidence.
  it("K: angle grounds itself in the observed evidence", () => {
    const angle = receptivityAngle("Acme Dental", observed) ?? "";
    // The observation is echoed back (first char lowercased) — grounded, not invented.
    expect(angle).toContain("no online booking; customers must call to book");
    expect(angle).toContain("one-page review");
  });

  // L. Copy never fabricates buying intent.
  it("L: angle never claims the business wants/needs/is looking for a solution", () => {
    const angle = (receptivityAngle("Acme Dental", observed) ?? "").toLowerCase();
    for (const banned of ["you want", "you need", "looking for", "in the market", "ready to buy", "interested in"]) {
      expect(angle).not.toContain(banned);
    }
  });

  // M. With no strong signal, there is NO angle — callers keep the existing approach.
  it("M: no strong signal → null angle (retain existing high-quality copy)", () => {
    const reportedOnly = receptivitySignalsFrom({ opportunities: [opp("Communication", "Reported", "slow replies")] });
    expect(receptivityAngle("Acme", reportedOnly)).toBeNull();
    expect(receptivityAngle("Acme", [])).toBeNull();
  });

  // N. The angle uses THIS business's evidence, not another's (no cross-business leakage).
  it("N: angle reflects the specific business's observed evidence", () => {
    const a = receptivityAngle("A", receptivitySignalsFrom({ opportunities: [opp("Scheduling", "Observed", "No booking widget on the site")] }));
    const b = receptivityAngle("B", receptivitySignalsFrom({ opportunities: [opp("Communication", "Observed", "No contact form anywhere")] }));
    expect(a).toContain("booking widget");
    expect(a).not.toContain("contact form");
    expect(b).toContain("contact form");
    expect(b).not.toContain("booking widget");
  });
});

describe("learning loop — aggregate real outcomes by signal × tier (no second analytics system)", () => {
  // O. Outcomes aggregate by (market tier × has-signal) with correct rates.
  it("O: signalOutcomeExperiment buckets emailed/replies/meetings by tier × signal", () => {
    const cells = signalOutcomeExperiment({
      sends: [
        { leadId: "l1", marketTier: "regional", hasSignal: true },
        { leadId: "l2", marketTier: "regional", hasSignal: true },
        { leadId: "l3", marketTier: "regional", hasSignal: false },
        { leadId: "l4", marketTier: "primary", hasSignal: false },
      ],
      repliedLeadIds: new Set(["l1", "l4"]),
      metLeadIds: new Set(["l1"]),
    });
    expect(cells["regional/signal"].emailed).toBe(2);
    expect(cells["regional/signal"].replies).toBe(1);
    expect(cells["regional/signal"].meetings).toBe(1);
    expect(cells["regional/signal"].replyRate).toBe(0.5);
    expect(cells["regional/signal"].meetingRate).toBe(0.5);
    expect(cells["regional/no-signal"].replies).toBe(0);
    expect(cells["primary/no-signal"].replyRate).toBe(1);
  });

  // P. The experiment is PURE and performs zero sends (0 external effects).
  it("P: aggregation is pure — empty input yields no cells, no side effects", () => {
    const cells = signalOutcomeExperiment({ sends: [], repliedLeadIds: new Set(), metLeadIds: new Set() });
    expect(Object.keys(cells)).toHaveLength(0);
  });
});
