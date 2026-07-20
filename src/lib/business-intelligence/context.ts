// ─────────────────────────────────────────────────────────────────────────────
// Profile context assembly.
//
// Turns whatever inputs are available into the read-only ProfileContext every
// signal evaluates against. It REUSES existing analysis (presence detection,
// normalized evidence, maturity, improvement) — it never re-derives raw facts.
// Absent inputs are simply absent; signals return Unknown rather than guessing.
// ─────────────────────────────────────────────────────────────────────────────
import { detectPresence } from "../presence";
import type { Evidence } from "../intelligence/evidence";
import type { EvidenceIndex, ProfileContext, ProfileInput, SignalReading, ReadingStatus, Dimension } from "./types";
import type { Confidence } from "./confidence";

function buildEvidenceIndex(evidence: Evidence[]): EvidenceIndex {
  const byField = new Map<string, Evidence>();
  for (const e of evidence) if (!byField.has(e.field)) byField.set(e.field, e);
  return {
    get: (field) => byField.get(field),
    has: (field) => byField.has(field),
    value<T extends string | number | boolean>(field: string): T | null {
      const e = byField.get(field);
      return e ? (e.value as T) : null;
    },
    friction: () => evidence.filter((e) => e.kind === "friction" || e.field.startsWith("friction:")),
    withPrefix: (prefix) => evidence.filter((e) => e.field.startsWith(prefix)),
    all: () => evidence.slice(),
  };
}

/** Assemble the context. Only `lead` is required. */
export function buildContext(input: ProfileInput): ProfileContext {
  const websiteSignals = input.websiteSignals ?? null;
  const presence = input.presence ?? detectPresence(input.lead, websiteSignals ?? undefined);
  return {
    lead: input.lead,
    presence,
    evidence: buildEvidenceIndex(input.evidence ?? []),
    websiteSignals,
    maturity: input.maturity ?? null,
    improvement: input.improvement ?? null,
  };
}

/**
 * Construct a reading. Kept in one place so every signal produces the same shape
 * and — critically — so a real reading can NEVER be created without a basis.
 * A signal that has nothing to say returns null instead of calling this.
 */
export function reading(args: {
  key: string;
  dimension: Dimension;
  label: string;
  status: ReadingStatus;
  summary: string;
  confidence: Confidence;
  basis: string[];
}): SignalReading {
  if (!args.basis.length) {
    // A guard, not a fallback: a reading with no provenance is a fabrication.
    throw new Error(`SignalReading "${args.key}" was built with no basis — refusing to fabricate.`);
  }
  return {
    key: args.key,
    dimension: args.dimension,
    label: args.label,
    status: args.status,
    summary: args.summary.trim(),
    confidence: args.confidence,
    basis: args.basis.slice(),
  };
}
