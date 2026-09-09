// ─────────────────────────────────────────────────────────────────────────────
// LUCAS/MATT CLASSIFIER — deterministic, PURE tests. These pin the conservative
// contract: an explicit assignment is authoritative; a Matt ElevenLabs voiceover with
// no Lucas signal is confirmed-matt; legacy-only signals are confirmed-lucas; a
// conflict OR no signal is needs-confirmation (never a silent assignment). The
// classifier performs NO writes — it only derives from the evidence handed to it.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  classifyLeadVoice,
  classifyPortfolio,
  voiceKeyForClassification,
  type LeadVoiceEvidence,
  type VoiceoverSignal,
} from "./lucas-classification";
import { DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY } from "./registry";

// A hermetic evidence builder — every field starts as the honest "no signal" state.
function evidence(over: Partial<LeadVoiceEvidence> = {}): LeadVoiceEvidence {
  return {
    leadId: "lead_x",
    explicitVoiceKey: null,
    voiceovers: [],
    personalizedVideoGeneration: null,
    hasLucasTrustBinding: false,
    firstSignalAt: null,
    lastSignalAt: null,
    ...over,
  };
}

const MATT_VO: VoiceoverSignal = { voiceKey: DEFAULT_VOICE_KEY, provider: "elevenlabs", generation: "current-matt" };
const LUCAS_VO: VoiceoverSignal = { voiceKey: LEGACY_LUCAS_VOICE_KEY, provider: "legacy", generation: "legacy-lucas" };

describe("explicit assignment is authoritative", () => {
  it("explicit Lucas assignment → confirmed-lucas (deterministic), even with a Matt voiceover", () => {
    const r = classifyLeadVoice(evidence({ explicitVoiceKey: LEGACY_LUCAS_VOICE_KEY, voiceovers: [MATT_VO] }));
    expect(r.classification).toBe("confirmed-lucas");
    expect(r.deterministic).toBe(true);
  });

  it("explicit Matt assignment → confirmed-matt (deterministic)", () => {
    const r = classifyLeadVoice(evidence({ explicitVoiceKey: DEFAULT_VOICE_KEY }));
    expect(r.classification).toBe("confirmed-matt");
    expect(r.deterministic).toBe(true);
  });

  it("an explicit assignment to an unknown key falls through to the signals", () => {
    // Unknown key carries no generation → the Matt voiceover decides it.
    const r = classifyLeadVoice(evidence({ explicitVoiceKey: "some_social_experiment", voiceovers: [MATT_VO] }));
    expect(r.classification).toBe("confirmed-matt");
    expect(r.deterministic).toBe(true);
  });
});

describe("confirmed-matt from an ElevenLabs voiceover", () => {
  it("a real Matt ElevenLabs voiceover with no Lucas signal → confirmed-matt", () => {
    const r = classifyLeadVoice(evidence({ voiceovers: [MATT_VO] }));
    expect(r.classification).toBe("confirmed-matt");
    expect(r.deterministic).toBe(true);
    expect(r.reason).toContain("ElevenLabs");
  });

  it("multiple Matt voiceovers still resolve to confirmed-matt", () => {
    const r = classifyLeadVoice(evidence({ voiceovers: [MATT_VO, { ...MATT_VO }] }));
    expect(r.classification).toBe("confirmed-matt");
    expect(r.deterministic).toBe(true);
  });
});

describe("confirmed-lucas from legacy-only signals", () => {
  it("a legacy-provider voiceover only → confirmed-lucas", () => {
    const r = classifyLeadVoice(evidence({ voiceovers: [LUCAS_VO] }));
    expect(r.classification).toBe("confirmed-lucas");
    expect(r.deterministic).toBe(true);
  });

  it("a legacy-lucas personalized video only → confirmed-lucas", () => {
    const r = classifyLeadVoice(evidence({ personalizedVideoGeneration: "legacy-lucas" }));
    expect(r.classification).toBe("confirmed-lucas");
    expect(r.deterministic).toBe(true);
  });

  it("a legacy Lucas trust-video binding only → confirmed-lucas", () => {
    const r = classifyLeadVoice(evidence({ hasLucasTrustBinding: true }));
    expect(r.classification).toBe("confirmed-lucas");
    expect(r.deterministic).toBe(true);
  });
});

describe("needs-confirmation on conflicting signals", () => {
  it("a Matt ElevenLabs voiceover AND a legacy-lucas binding → needs-confirmation (not deterministic)", () => {
    const r = classifyLeadVoice(evidence({ voiceovers: [MATT_VO], hasLucasTrustBinding: true }));
    expect(r.classification).toBe("needs-confirmation");
    expect(r.deterministic).toBe(false);
    expect(r.reason).toContain("conflicting");
  });

  it("a Matt voiceover AND a legacy-lucas personalized video → needs-confirmation", () => {
    const r = classifyLeadVoice(evidence({ voiceovers: [MATT_VO], personalizedVideoGeneration: "legacy-lucas" }));
    expect(r.classification).toBe("needs-confirmation");
    expect(r.deterministic).toBe(false);
  });
});

describe("needs-confirmation on no signal", () => {
  it("no signal at all → needs-confirmation (never a silent assignment)", () => {
    const r = classifyLeadVoice(evidence());
    expect(r.classification).toBe("needs-confirmation");
    expect(r.deterministic).toBe(false);
    expect(r.reason).toContain("no voice signal");
  });

  it("a non-legacy personalized-video generation with no other signal → needs-confirmation", () => {
    // current-matt personalized-video generation is not, by itself, a positive Matt signal here.
    const r = classifyLeadVoice(evidence({ personalizedVideoGeneration: "current-matt" }));
    expect(r.classification).toBe("needs-confirmation");
    expect(r.deterministic).toBe(false);
  });
});

describe("voiceKeyForClassification mapping", () => {
  it("maps confirmed generations to keys and needs-confirmation to null", () => {
    expect(voiceKeyForClassification("confirmed-lucas")).toBe(LEGACY_LUCAS_VOICE_KEY);
    expect(voiceKeyForClassification("confirmed-matt")).toBe(DEFAULT_VOICE_KEY);
    expect(voiceKeyForClassification("needs-confirmation")).toBeNull();
  });
});

describe("classifyPortfolio aggregation + willApply/unchanged logic", () => {
  it("counts each classification and separates willApply from unchanged", () => {
    const leads: LeadVoiceEvidence[] = [
      // Matt, not yet assigned → willApply.
      evidence({ leadId: "lead_matt_new", voiceovers: [MATT_VO] }),
      // Matt, already assigned to Matt → unchanged.
      evidence({ leadId: "lead_matt_set", explicitVoiceKey: DEFAULT_VOICE_KEY, voiceovers: [MATT_VO] }),
      // Lucas, not yet assigned → willApply.
      evidence({ leadId: "lead_lucas_new", voiceovers: [LUCAS_VO] }),
      // Conflict → ambiguous, never willApply.
      evidence({ leadId: "lead_conflict", voiceovers: [MATT_VO], hasLucasTrustBinding: true }),
      // No signal → ambiguous.
      evidence({ leadId: "lead_empty" }),
    ];

    const report = classifyPortfolio(leads);
    expect(report.inspected).toBe(5);
    expect(report.confirmedMatt).toBe(2);
    expect(report.confirmedLucas).toBe(1);
    expect(report.ambiguous).toBe(2);
    expect(report.unchanged).toBe(1);

    const apply = report.rows.filter((r) => r.willApply).map((r) => r.leadId);
    expect(apply).toEqual(["lead_matt_new", "lead_lucas_new"]);

    // No ambiguous row is ever marked willApply.
    for (const row of report.rows) {
      if (!row.deterministic) expect(row.willApply).toBe(false);
    }
  });

  it("a deterministic result already matching the current assignment is unchanged, not willApply", () => {
    const report = classifyPortfolio([
      evidence({ leadId: "lead_lucas_set", explicitVoiceKey: LEGACY_LUCAS_VOICE_KEY, voiceovers: [LUCAS_VO] }),
    ]);
    expect(report.unchanged).toBe(1);
    expect(report.rows[0].willApply).toBe(false);
    expect(report.rows[0].classification).toBe("confirmed-lucas");
  });

  it("carries the currentAssignment through to each row", () => {
    const report = classifyPortfolio([
      evidence({ leadId: "lead_a", voiceovers: [MATT_VO] }),
      evidence({ leadId: "lead_b", explicitVoiceKey: DEFAULT_VOICE_KEY, voiceovers: [MATT_VO] }),
    ]);
    expect(report.rows[0].currentAssignment).toBeNull();
    expect(report.rows[1].currentAssignment).toBe(DEFAULT_VOICE_KEY);
  });
});

describe("the classifier is pure (no writes)", () => {
  it("does not mutate the evidence it is given", () => {
    const e = evidence({ leadId: "lead_immutable", voiceovers: [MATT_VO] });
    const snapshot = JSON.stringify(e);
    classifyLeadVoice(e);
    classifyPortfolio([e]);
    expect(JSON.stringify(e)).toBe(snapshot);
  });
});
