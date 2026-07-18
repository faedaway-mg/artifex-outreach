// ─────────────────────────────────────────────────────────────────────────────
// Enrichment Delta (Phase 12 — operator value).
//
// After enrichment, the operator should immediately SEE the intelligence get
// better: new evidence, confidence increases, new discovery questions, maturity
// changes, opportunity changes, Business Improvement changes, outreach-angle
// updates, and relationship-value changes. This diffs two BusinessIntelligence
// snapshots and reports what improved.
// ─────────────────────────────────────────────────────────────────────────────
import type { BusinessIntelligence } from "./engine";

export interface EnrichmentDelta {
  newEvidenceCount: number;
  newEvidence: string[]; // statements
  evidenceConfidenceDelta: number;
  newDiscoveryQuestions: string[];
  maturityChanges: Array<{ dimension: string; from: string; to: string }>;
  overallMaturityChange: { from: string; to: string } | null;
  newFrictionDomains: string[];
  highLeverageChange: { from: string | null; to: string | null } | null;
  improvementScoreDelta: number;
  treatmentChange: { from: string; to: string } | null;
  outreachAngleChange: { from: string; to: string } | null;
  relationshipValueDelta: { confidenceAdjustedTwelveMonth: number; partnershipLikelihood: number };
  summary: string[];
}

export function diffIntelligence(before: BusinessIntelligence, after: BusinessIntelligence): EnrichmentDelta {
  const beforeEv = new Set(before.evidence.map((e) => e.field));
  const newEv = after.evidence.filter((e) => !beforeEv.has(e.field));

  const beforeQs = new Set(before.snapshot.discoveryQuestions);
  const newQs = after.snapshot.discoveryQuestions.filter((q) => !beforeQs.has(q));

  const maturityChanges: EnrichmentDelta["maturityChanges"] = [];
  for (const d of after.maturity.dimensions) {
    const prev = before.maturity.dimensions.find((x) => x.dimension === d.dimension);
    if (prev && prev.current !== d.current) maturityChanges.push({ dimension: d.dimension, from: prev.current, to: d.current });
  }

  const beforeFr = new Set(before.frictionDomains);
  const newFrictionDomains = after.frictionDomains.filter((f) => !beforeFr.has(f));

  const hlBefore = before.opportunityGraph.highLeverage?.domain ?? null;
  const hlAfter = after.opportunityGraph.highLeverage?.domain ?? null;

  const summary: string[] = [];
  if (newEv.length) summary.push(`+${newEv.length} new evidence point(s)`);
  const confDelta = after.evidenceConfidence - before.evidenceConfidence;
  if (confDelta !== 0) summary.push(`evidence confidence ${confDelta > 0 ? "+" : ""}${confDelta}`);
  if (newQs.length) summary.push(`+${newQs.length} new discovery question(s)`);
  if (maturityChanges.length) summary.push(`${maturityChanges.length} maturity dimension change(s)`);
  if (newFrictionDomains.length) summary.push(`+${newFrictionDomains.length} friction domain(s)`);
  if (hlBefore !== hlAfter) summary.push(`highest-leverage focus: ${hlBefore ?? "—"} → ${hlAfter ?? "—"}`);
  const scoreDelta = after.improvement.score - before.improvement.score;
  if (scoreDelta !== 0) summary.push(`Business Improvement ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`);
  if (before.improvement.treatment !== after.improvement.treatment) summary.push(`treatment: ${before.improvement.treatment} → ${after.improvement.treatment}`);
  if (!summary.length) summary.push("no material change");

  return {
    newEvidenceCount: newEv.length,
    newEvidence: newEv.map((e) => e.statement),
    evidenceConfidenceDelta: confDelta,
    newDiscoveryQuestions: newQs,
    maturityChanges,
    overallMaturityChange: before.maturity.overall !== after.maturity.overall ? { from: before.maturity.overall, to: after.maturity.overall } : null,
    newFrictionDomains,
    highLeverageChange: hlBefore !== hlAfter ? { from: hlBefore, to: hlAfter } : null,
    improvementScoreDelta: scoreDelta,
    treatmentChange: before.improvement.treatment !== after.improvement.treatment ? { from: before.improvement.treatment, to: after.improvement.treatment } : null,
    outreachAngleChange:
      String(before.snapshot.outreachAngle.category) !== String(after.snapshot.outreachAngle.category)
        ? { from: String(before.snapshot.outreachAngle.category), to: String(after.snapshot.outreachAngle.category) }
        : null,
    relationshipValueDelta: {
      confidenceAdjustedTwelveMonth: after.improvement.relationship.confidenceAdjustedTwelveMonth - before.improvement.relationship.confidenceAdjustedTwelveMonth,
      partnershipLikelihood: Math.round((after.improvement.relationship.partnershipLikelihood - before.improvement.relationship.partnershipLikelihood) * 100) / 100,
    },
    summary,
  };
}
