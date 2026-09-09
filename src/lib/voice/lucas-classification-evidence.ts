// ─────────────────────────────────────────────────────────────────────────────
// LUCAS/MATT CLASSIFIER — EVIDENCE ADAPTER (impure, READ-ONLY).
//
// This is the ONLY impure half of the classifier: it gathers LeadVoiceEvidence for
// every historical lead from the real stores. It reads and NEVER writes:
//   • readVoiceState().leadVoices  — the existing explicit per-lead assignments.
//   • listVoiceovers()             — every generated voiceover (voiceKey + provider),
//                                    grouped by lead, each tagged with its generation.
//   • listOffers()                 — every offer's leadId + any personalized-video record
//                                    (its voiceGeneration is a stored legacy/Matt signal)
//                                    and any legacy-Lucas trust-video binding.
//
// It performs NO writes, makes NO ElevenLabs calls, and regenerates NO media. The
// classification decision itself is made by the PURE classifyLeadVoice — this file only
// assembles the facts it reads for it. A lead is "historical" here if it appears in ANY
// of those read-only sources.
// ─────────────────────────────────────────────────────────────────────────────
import { listVoiceovers, readVoiceState, type VoiceoverRecord } from "./store";
import { voiceGeneration } from "./registry";
import { listOffers, type StoredOffer } from "../quick-fix/store";
import type { LeadVoiceEvidence, VoiceoverSignal } from "./lucas-classification";

/** Map a voiceover record to the minimal signal the classifier reads. */
function voiceoverSignal(v: VoiceoverRecord): VoiceoverSignal {
  return { voiceKey: v.voiceKey, provider: v.provider, generation: voiceGeneration(v.voiceKey) };
}

/**
 * Whether an offer's personalized-video record carries a legacy-Lucas trust binding.
 * The personalized-video record's voiceGeneration is the stored, per-offer generation
 * signal; "legacy-lucas" there means the offer's bound trust/personalized assets belong
 * to the Lucas generation. We never infer a Lucas binding from anything weaker.
 */
function offerLucasSignals(offer: StoredOffer): { personalizedVideoGeneration: string | null; hasLucasTrustBinding: boolean } {
  const gen = offer.personalizedVideo?.voiceGeneration ?? null;
  return { personalizedVideoGeneration: gen, hasLucasTrustBinding: gen === "legacy-lucas" };
}

/**
 * Gather READ-ONLY evidence for every historical lead across the real stores. Deterministic
 * for a given store state: leads are returned sorted by leadId. Mutates nothing, calls no
 * provider. The caller (the pure classifier / the audit CLI) decides what to do with it.
 */
export async function gatherLeadVoiceEvidence(): Promise<LeadVoiceEvidence[]> {
  const [state, voiceovers, offers] = await Promise.all([readVoiceState(), listVoiceovers(), listOffers()]);

  // Accumulate evidence per lead, seeding every lead we see in ANY source.
  const byLead = new Map<string, LeadVoiceEvidence>();
  const ensure = (leadId: string): LeadVoiceEvidence => {
    let e = byLead.get(leadId);
    if (!e) {
      e = {
        leadId,
        explicitVoiceKey: null,
        voiceovers: [],
        personalizedVideoGeneration: null,
        hasLucasTrustBinding: false,
        firstSignalAt: null,
        lastSignalAt: null,
      };
      byLead.set(leadId, e);
    }
    return e;
  };

  // 1) Explicit per-lead assignments (the authoritative signal).
  for (const [leadId, voiceKey] of Object.entries(state.leadVoices)) {
    ensure(leadId).explicitVoiceKey = voiceKey;
  }

  // 2) Voiceover records — the per-lead provider/generation signals + lineage timestamps.
  for (const v of voiceovers) {
    const e = ensure(v.leadId);
    e.voiceovers.push(voiceoverSignal(v));
    if (!e.firstSignalAt || v.createdAt < e.firstSignalAt) e.firstSignalAt = v.createdAt;
    if (!e.lastSignalAt || v.createdAt > e.lastSignalAt) e.lastSignalAt = v.createdAt;
  }

  // 3) Offers — the per-lead personalized-video generation + legacy-Lucas trust binding.
  for (const offer of offers) {
    if (!offer.leadId) continue;
    const e = ensure(offer.leadId);
    const { personalizedVideoGeneration, hasLucasTrustBinding } = offerLucasSignals(offer);
    // Take the first legacy-lucas signal seen; never downgrade a legacy binding once set.
    if (personalizedVideoGeneration && !e.personalizedVideoGeneration) e.personalizedVideoGeneration = personalizedVideoGeneration;
    if (hasLucasTrustBinding) e.hasLucasTrustBinding = true;
  }

  return [...byLead.values()].sort((a, b) => a.leadId.localeCompare(b.leadId));
}
