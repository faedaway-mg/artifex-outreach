// ─────────────────────────────────────────────────────────────────────────────
// Learning Engine.
//
// Every engagement should make the system smarter. This pass builds the DATA
// STRUCTURES and SCORING PATHWAYS (priors) that future intelligence will use — no
// machine learning. Outcomes are captured in a normalized shape, aggregated into
// priors per (industry, friction domain), and exposed as a confidence adjustment
// the engine can apply to future recommendations.
// ─────────────────────────────────────────────────────────────────────────────
import type { FrictionDomain } from "./friction-taxonomy";

// ── Captured outcomes ────────────────────────────────────────────────────────
export interface FrictionOutcome {
  industry: string;
  domain: FrictionDomain;
  /** Did discovery confirm the friction we hypothesized? */
  confirmed: boolean;
  leadId: string;
  capturedAt: string | null;
}

export interface RecommendationOutcome {
  industry: string;
  domain: FrictionDomain;
  accepted: boolean; // client agreed to pursue
  implemented: boolean; // it got built
  helped: boolean | null; // measured improvement (null = unknown yet)
  leadId: string;
  capturedAt: string | null;
}

export interface EngagementOutcome {
  industry: string;
  leadId: string;
  entryModel: string;
  durationMonths: number;
  expanded: boolean; // grew beyond the entry engagement
  retainedMonths: number;
  observedImprovements: string[];
  capturedAt: string | null;
}

// ── Aggregated priors — the "what we've learned" surface ─────────────────────
export interface DomainPrior {
  industry: string;
  domain: FrictionDomain;
  samples: number;
  confirmationRate: number; // 0..1 — how often this friction proved real
  successRate: number; // 0..1 — implemented recs that helped
}

export interface LearningStore {
  recordFriction(o: FrictionOutcome): void;
  recordRecommendation(o: RecommendationOutcome): void;
  recordEngagement(o: EngagementOutcome): void;
  prior(industry: string, domain: FrictionDomain): DomainPrior;
  /** Bias a base confidence (0..1) toward what we've actually observed. */
  adjustConfidence(base: number, industry: string, domain: FrictionDomain): number;
  /** Aggregate signal for reporting / operator display. */
  industrySummary(industry: string): { engagements: number; avgDurationMonths: number; expansionRate: number; retentionMonths: number };
  snapshot(): { friction: FrictionOutcome[]; recommendations: RecommendationOutcome[]; engagements: EngagementOutcome[] };
}

/**
 * In-memory store. The interface is what matters — a Postgres-backed store can
 * implement `LearningStore` later without touching the engine or scoring pathway.
 */
export function createLearningStore(seed?: Partial<ReturnType<LearningStore["snapshot"]>>): LearningStore {
  const friction: FrictionOutcome[] = [...(seed?.friction ?? [])];
  const recommendations: RecommendationOutcome[] = [...(seed?.recommendations ?? [])];
  const engagements: EngagementOutcome[] = [...(seed?.engagements ?? [])];

  const key = (i: string, d: FrictionDomain) => `${i.toLowerCase()}::${d}`;

  return {
    recordFriction: (o) => void friction.push(o),
    recordRecommendation: (o) => void recommendations.push(o),
    recordEngagement: (o) => void engagements.push(o),

    prior(industry, domain) {
      const k = key(industry, domain);
      const fr = friction.filter((f) => key(f.industry, f.domain) === k);
      const rec = recommendations.filter((r) => key(r.industry, r.domain) === k && r.implemented && r.helped != null);
      const confirmationRate = fr.length ? fr.filter((f) => f.confirmed).length / fr.length : 0.5; // neutral prior
      const successRate = rec.length ? rec.filter((r) => r.helped).length / rec.length : 0.5;
      return { industry, domain, samples: fr.length + rec.length, confirmationRate, successRate };
    },

    adjustConfidence(base, industry, domain) {
      const p = this.prior(industry, domain);
      if (p.samples === 0) return clamp01(base); // nothing learned yet — don't move it
      // Blend base with confirmationRate; more samples → more weight on evidence.
      const weight = Math.min(0.5, p.samples / 20); // caps influence at 50%
      return clamp01(base * (1 - weight) + p.confirmationRate * weight);
    },

    industrySummary(industry) {
      const es = engagements.filter((e) => e.industry.toLowerCase() === industry.toLowerCase());
      const n = es.length || 0;
      return {
        engagements: n,
        avgDurationMonths: n ? round1(es.reduce((s, e) => s + e.durationMonths, 0) / n) : 0,
        expansionRate: n ? round2(es.filter((e) => e.expanded).length / n) : 0,
        retentionMonths: n ? round1(es.reduce((s, e) => s + e.retainedMonths, 0) / n) : 0,
      };
    },

    snapshot: () => ({ friction: [...friction], recommendations: [...recommendations], engagements: [...engagements] }),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
