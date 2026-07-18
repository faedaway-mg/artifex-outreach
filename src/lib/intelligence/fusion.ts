// ─────────────────────────────────────────────────────────────────────────────
// Evidence Fusion (Phase 7).
//
// When multiple providers report the same thing, the engine should reason over the
// COMBINED evidence: merge, raise confidence when corroborated, track provenance,
// detect contradictions, and surface uncertainty. No provider ever silently
// overwrites another — disagreements are kept and flagged. This is additive to the
// simpler mergeEvidence() and does not replace it.
// ─────────────────────────────────────────────────────────────────────────────
import type { Evidence, EvidenceConfidence, ProviderResult } from "./evidence";

export interface FusedEvidence extends Evidence {
  /** Provider ids that asserted this field. */
  sources: string[];
  /** How many providers agree on the value. */
  corroboration: number;
  contradiction: boolean;
  conflictingValues?: Array<{ providerId: string; value: Evidence["value"] }>;
  /** Confidence after corroboration boost / contradiction penalty. */
  adjustedConfidence: EvidenceConfidence;
}

export interface FusionResult {
  evidence: FusedEvidence[];
  contradictions: Array<{ field: string; values: Array<{ providerId: string; value: Evidence["value"] }> }>;
  provenance: Record<string, string[]>;
  confidenceScore: number; // 0..100
}

const RANK: Record<EvidenceConfidence, number> = { Verified: 3, Likely: 2, Unknown: 1 };
const ORDER: EvidenceConfidence[] = ["Unknown", "Likely", "Verified"];

function bump(c: EvidenceConfidence, by: number): EvidenceConfidence {
  const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(c) + by));
  return ORDER[i];
}
function sameValue(a: Evidence["value"], b: Evidence["value"]): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

export function fuseEvidence(results: ProviderResult[]): FusionResult {
  const byField = new Map<string, Evidence[]>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const e of r.evidence) {
      const arr = byField.get(e.field) ?? [];
      arr.push(e);
      byField.set(e.field, arr);
    }
  }

  const fused: FusedEvidence[] = [];
  const contradictions: FusionResult["contradictions"] = [];
  const provenance: Record<string, string[]> = {};

  for (const [field, list] of byField) {
    const sources = Array.from(new Set(list.map((e) => e.providerId)));
    provenance[field] = sources;

    // Representative = highest-confidence assertion.
    const rep = [...list].sort((a, b) => RANK[b.confidence] - RANK[a.confidence])[0];

    // Agreement / contradiction on the value.
    const agree = list.filter((e) => sameValue(e.value, rep.value));
    const disagree = list.filter((e) => !sameValue(e.value, rep.value));
    const corroboration = new Set(agree.map((e) => e.providerId)).size;
    const contradiction = disagree.length > 0;

    let adjustedConfidence = rep.confidence;
    // Corroboration boost: 2+ independent providers agreeing raises confidence one notch.
    if (corroboration >= 2 && !contradiction) adjustedConfidence = bump(rep.confidence, 1);
    // Contradiction penalty: keep the value but lower confidence + flag.
    if (contradiction) {
      adjustedConfidence = bump(rep.confidence, -1);
      const values = list.map((e) => ({ providerId: e.providerId, value: e.value }));
      contradictions.push({ field, values });
    }

    fused.push({
      ...rep,
      sources,
      corroboration,
      contradiction,
      conflictingValues: contradiction ? disagree.map((e) => ({ providerId: e.providerId, value: e.value })) : undefined,
      adjustedConfidence,
    });
  }

  // Confidence score rewards volume + corroboration, penalizes contradictions.
  const base = fused.length ? fused.reduce((s, f) => s + RANK[f.adjustedConfidence], 0) / (fused.length * 3) : 0;
  const corroborated = fused.filter((f) => f.corroboration >= 2).length;
  const corroborationBonus = fused.length ? Math.min(0.15, corroborated / fused.length * 0.15) : 0;
  const contradictionPenalty = Math.min(0.2, contradictions.length * 0.05);
  const confidenceScore = Math.round(Math.max(0, Math.min(1, base + corroborationBonus - contradictionPenalty)) * 100);

  return { evidence: fused, contradictions, provenance, confidenceScore };
}
