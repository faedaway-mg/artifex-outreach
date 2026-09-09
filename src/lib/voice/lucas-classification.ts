// ─────────────────────────────────────────────────────────────────────────────
// LUCAS/MATT HISTORICAL JOURNEY CLASSIFIER — PURE, read-only, evidence-gated.
//
// LAUNCH-READINESS MANDATE: existing (pre-Matt) leads must be sorted into the two
// coherent journey generations — legacy-lucas (Lucas) vs current-matt (Matt) —
// WITHOUT inventing certainty. A lead is only ever moved to a generation when the
// evidence DETERMINISTICALLY says so; anything ambiguous or unsignalled is left for
// an operator to confirm. This mirrors the registry's coherence rule (a journey is
// exactly ONE generation, never silently mixed).
//
// This module is PURE: it derives a classification from provided evidence. It performs
// NO I/O, NO writes, NO ElevenLabs calls, and never mutates a historical asset. The
// impure evidence gathering lives in lucas-classification-evidence.ts; applying a
// deterministic classification is an explicit operator action in the audit CLI.
//
// SAFETY: we NEVER invent a Lucas provider voice ID and NEVER regenerate media. The
// classifier only decides which EXISTING generation a lead already belongs to. When
// signals conflict (both a Matt ElevenLabs voiceover AND a legacy-lucas binding) or
// there is no signal at all, the answer is "needs-confirmation" — never a silent guess.
// ─────────────────────────────────────────────────────────────────────────────
import {
  DEFAULT_VOICE_KEY,
  LEGACY_LUCAS_VOICE_KEY,
  voiceGeneration,
  type VoiceGeneration,
} from "./registry";

/**
 * The three honest outcomes for a historical lead:
 *  - "confirmed-lucas": the evidence deterministically places the lead in legacy-lucas.
 *  - "confirmed-matt":  the evidence deterministically places the lead in current-matt.
 *  - "needs-confirmation": signals conflict, or there is no signal — an operator decides.
 */
export type LeadVoiceClassification = "confirmed-lucas" | "confirmed-matt" | "needs-confirmation";

/** A single voiceover signal for a lead (the fields the classifier reads). */
export interface VoiceoverSignal {
  /** Registry voice key the voiceover was generated under (e.g. artifex_default). */
  voiceKey: string;
  /** The provider that produced it ("elevenlabs" = live Matt; "legacy" = preserved Lucas). */
  provider: string;
  /** The coherent generation, when known (derived from the voice key). Null ⇒ unknown. */
  generation: VoiceGeneration | null;
}

/**
 * The evidence available for ONE historical lead. Every field is optional/empty when the
 * corresponding signal does not exist — an absent signal is NOT a signal (it never implies
 * a generation). Gathered read-only from the real stores by lucas-classification-evidence.
 */
export interface LeadVoiceEvidence {
  leadId: string;
  /** The lead's EXISTING explicit leadVoices assignment, when one was set (else null). */
  explicitVoiceKey: string | null;
  /** Every voiceover record bound to this lead (may be empty). */
  voiceovers: VoiceoverSignal[];
  /** The voiceGeneration recorded on the lead's personalized-video record, if any. */
  personalizedVideoGeneration: string | null;
  /** True ⇒ the lead is bound to a legacy Lucas trust-video asset (a legacy-lucas signal). */
  hasLucasTrustBinding: boolean;
  /** Optional lineage timestamps (never affect the deterministic outcome; audit only). */
  firstSignalAt?: string | null;
  lastSignalAt?: string | null;
}

export interface LeadVoiceClassificationResult {
  classification: LeadVoiceClassification;
  /** A stable, human-readable reason (why this outcome — for the operator audit). */
  reason: string;
  /** True ⇒ the evidence decides it unambiguously (safe to apply); false ⇒ operator-gated. */
  deterministic: boolean;
}

/** A Matt (current-matt) ElevenLabs voiceover is the strongest positive Matt signal. */
function isMattElevenLabsSignal(v: VoiceoverSignal): boolean {
  return v.provider === "elevenlabs" && v.generation === "current-matt";
}

/** A legacy-lucas voiceover signal (a preserved-provider record in the Lucas generation). */
function isLegacyLucasVoiceoverSignal(v: VoiceoverSignal): boolean {
  return v.provider === "legacy" || v.generation === "legacy-lucas";
}

/**
 * Classify ONE historical lead from its evidence. Rules (deliberately conservative —
 * we NEVER invent certainty):
 *   1. An EXPLICIT leadVoices assignment is authoritative → confirmed to its generation.
 *   2. ≥1 real Matt ElevenLabs voiceover AND no legacy-Lucas signal → confirmed-matt.
 *   3. Legacy-Lucas signals ONLY (legacy voiceover, or a personalizedVideo/trust binding
 *      whose generation is legacy-lucas) AND no ElevenLabs voiceover → confirmed-lucas.
 *   4. Conflicting signals (both a Matt ElevenLabs voiceover AND a legacy-lucas binding)
 *      OR no signal at all → needs-confirmation (never a silent assignment).
 */
export function classifyLeadVoice(evidence: LeadVoiceEvidence): LeadVoiceClassificationResult {
  // 1) An explicit operator assignment already settled this lead — it is authoritative.
  if (evidence.explicitVoiceKey) {
    const gen = voiceGeneration(evidence.explicitVoiceKey);
    if (gen === "legacy-lucas") {
      return { classification: "confirmed-lucas", reason: "explicit leadVoices assignment to the legacy Lucas voice", deterministic: true };
    }
    if (gen === "current-matt") {
      return { classification: "confirmed-matt", reason: "explicit leadVoices assignment to the Matt voice", deterministic: true };
    }
    // An assignment to an unknown key carries no generation — fall through to the signals.
  }

  // Gather the two independent generation signals from the available evidence.
  const hasMattElevenLabs = evidence.voiceovers.some(isMattElevenLabsSignal);
  const hasLucasVoiceover = evidence.voiceovers.some(isLegacyLucasVoiceoverSignal);
  const hasLucasPersonalizedVideo = evidence.personalizedVideoGeneration === "legacy-lucas";
  const hasLucasSignal = hasLucasVoiceover || hasLucasPersonalizedVideo || evidence.hasLucasTrustBinding;

  // 4a) Conflict — a Matt ElevenLabs voiceover AND a legacy-lucas binding both exist.
  if (hasMattElevenLabs && hasLucasSignal) {
    return {
      classification: "needs-confirmation",
      reason: "conflicting signals — a Matt ElevenLabs voiceover and a legacy-Lucas binding both exist; an operator must confirm which journey this lead belongs to",
      deterministic: false,
    };
  }

  // 2) Matt-only — at least one real Matt ElevenLabs voiceover and no legacy-Lucas signal.
  if (hasMattElevenLabs) {
    return { classification: "confirmed-matt", reason: "a real Matt ElevenLabs voiceover exists and there is no legacy-Lucas signal", deterministic: true };
  }

  // 3) Lucas-only — legacy-Lucas signals only, and no ElevenLabs voiceover.
  if (hasLucasSignal) {
    const parts: string[] = [];
    if (hasLucasVoiceover) parts.push("a legacy-provider voiceover");
    if (hasLucasPersonalizedVideo) parts.push("a legacy-lucas personalized video");
    if (evidence.hasLucasTrustBinding) parts.push("a legacy Lucas trust-video binding");
    return { classification: "confirmed-lucas", reason: `only legacy-Lucas signals (${parts.join(", ")}) and no ElevenLabs voiceover`, deterministic: true };
  }

  // 4b) No signal at all — nothing to decide on. An operator must confirm.
  return { classification: "needs-confirmation", reason: "no voice signal at all — an operator must confirm this lead's journey", deterministic: false };
}

/** The canonical voice key a deterministic classification maps to (for setLeadVoiceKey). */
export function voiceKeyForClassification(classification: LeadVoiceClassification): string | null {
  if (classification === "confirmed-lucas") return LEGACY_LUCAS_VOICE_KEY;
  if (classification === "confirmed-matt") return DEFAULT_VOICE_KEY;
  return null; // needs-confirmation → no key; never applied
}

export interface PortfolioRow {
  leadId: string;
  classification: LeadVoiceClassification;
  reason: string;
  deterministic: boolean;
  /** True ⇒ deterministic AND the target voice differs from the current explicit assignment. */
  willApply: boolean;
  /** The lead's current explicit assignment (null ⇒ none set — inherits the default). */
  currentAssignment: string | null;
}

export interface PortfolioReport {
  inspected: number;
  confirmedLucas: number;
  confirmedMatt: number;
  ambiguous: number;
  /** Deterministic leads whose classification already equals their current assignment. */
  unchanged: number;
  rows: PortfolioRow[];
}

/**
 * A DRY-RUN portfolio classification report. Pure aggregation over classifyLeadVoice — it
 * writes nothing. For each lead it records whether applying the (deterministic) result
 * would actually change the lead's current explicit assignment ("willApply") or is already
 * correct ("unchanged"). Ambiguous leads are counted but never marked willApply.
 */
export function classifyPortfolio(leads: LeadVoiceEvidence[]): PortfolioReport {
  const rows: PortfolioRow[] = [];
  let confirmedLucas = 0;
  let confirmedMatt = 0;
  let ambiguous = 0;
  let unchanged = 0;

  for (const evidence of leads) {
    const { classification, reason, deterministic } = classifyLeadVoice(evidence);
    if (classification === "confirmed-lucas") confirmedLucas += 1;
    else if (classification === "confirmed-matt") confirmedMatt += 1;
    else ambiguous += 1;

    const targetKey = deterministic ? voiceKeyForClassification(classification) : null;
    const currentAssignment = evidence.explicitVoiceKey;
    // "unchanged" = a deterministic result that already matches the current explicit assignment.
    const alreadyCorrect = deterministic && targetKey != null && currentAssignment === targetKey;
    // "willApply" = deterministic AND the target differs from the current assignment.
    const willApply = deterministic && targetKey != null && currentAssignment !== targetKey;
    if (alreadyCorrect) unchanged += 1;

    rows.push({ leadId: evidence.leadId, classification, reason, deterministic, willApply, currentAssignment });
  }

  return { inspected: leads.length, confirmedLucas, confirmedMatt, ambiguous, unchanged, rows };
}
