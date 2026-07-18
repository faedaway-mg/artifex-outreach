// ─────────────────────────────────────────────────────────────────────────────
// Normalized Evidence — the single currency of the Business Intelligence Engine.
//
// Every provider (Google Places, OpenCorporates, website tech-detection, review
// sources, future APIs) emits Evidence in this shape. The engine consumes ONLY
// normalized Evidence and never knows which provider produced it. This is what
// lets future data sources ENRICH the engine without changing its behavior.
// ─────────────────────────────────────────────────────────────────────────────
import type { ObservationType } from "../positioning";

/** The kind of thing a piece of evidence tells us about a business. */
export const EVIDENCE_KINDS = [
  "identity", // name, address, entity, registration
  "channel", // website, phone, email, social, booking
  "reputation", // ratings, reviews, sentiment
  "scale", // locations, size, review volume
  "technology", // detected stack, platforms, integrations
  "activity", // hours, recency, operating status
  "friction", // an observed problem / opportunity
  "market", // industry, competitors, demand signals
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** How much we trust a single piece of evidence. Mirrors the findings model. */
export const EVIDENCE_CONFIDENCE = ["Verified", "Likely", "Unknown"] as const;
export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCE)[number];

export interface Evidence {
  /** Stable id — `${providerId}:${field}` unless a provider needs finer grain. */
  id: string;
  /** Which provider produced this (engine stays agnostic; this is for audit only). */
  providerId: string;
  kind: EvidenceKind;
  /** A normalized field name, e.g. "rating", "hasOnlineBooking", "entityStatus". */
  field: string;
  /** The normalized value. Primitive or small object — never provider-raw shape. */
  value: string | number | boolean | null;
  /** Human-readable statement of what this evidence says. */
  statement: string;
  observationType: ObservationType;
  confidence: EvidenceConfidence;
  /** ISO timestamp; null keeps deterministic tests stable (caller may stamp). */
  capturedAt: string | null;
  sourceUrl: string | null;
}

/** A provider's contribution for one business: normalized evidence + provider meta. */
export interface ProviderResult {
  providerId: string;
  ok: boolean;
  evidence: Evidence[];
  /** Non-fatal notes (rate-limited, partial, cache-hit, etc.). */
  notes: string[];
  /** Estimated cost in USD for this enrichment call (0 for local adapters). */
  costUsd: number;
}

export function evidence(partial: Omit<Evidence, "capturedAt"> & { capturedAt?: string | null }): Evidence {
  return { capturedAt: null, ...partial };
}

/**
 * Merge evidence from many providers into a deduped, confidence-ranked set.
 * When two providers assert the same field, the higher-confidence one wins;
 * ties keep the first (provider order = trust order set by the registry).
 */
export function mergeEvidence(results: ProviderResult[]): Evidence[] {
  const rank: Record<EvidenceConfidence, number> = { Verified: 3, Likely: 2, Unknown: 1 };
  const byField = new Map<string, Evidence>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const e of r.evidence) {
      const existing = byField.get(e.field);
      if (!existing || rank[e.confidence] > rank[existing.confidence]) byField.set(e.field, e);
    }
  }
  return Array.from(byField.values());
}

/** Pull the first evidence value for a field (typed helpers keep the engine tidy). */
export function evidenceValue<T extends string | number | boolean>(evidence: Evidence[], field: string): T | null {
  const e = evidence.find((x) => x.field === field);
  return e ? (e.value as T) : null;
}

/** Overall confidence in the evidence set (0..100) — drives "how sure are we?". */
export function evidenceConfidenceScore(evidence: Evidence[]): number {
  if (!evidence.length) return 0;
  const weight: Record<EvidenceConfidence, number> = { Verified: 1, Likely: 0.6, Unknown: 0.25 };
  const distinctKinds = new Set(evidence.map((e) => e.kind)).size;
  const avg = evidence.reduce((s, e) => s + weight[e.confidence], 0) / evidence.length;
  // Breadth bonus: more distinct evidence kinds → more confidence, capped.
  const breadth = Math.min(1, distinctKinds / EVIDENCE_KINDS.length);
  return Math.round(Math.min(100, (avg * 0.75 + breadth * 0.25) * 100));
}
