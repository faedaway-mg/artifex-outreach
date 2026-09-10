import { describe, it, expect } from "vitest";
import {
  planRenderEnqueue,
  buildQueuedRenderRecord,
  assertRenderVoiceoverLineage,
  RenderLineageError,
  claimQueuedRenders,
  type RenderEnqueueInputs,
  type VoiceoverBinding,
} from "./voice-render-orchestration";
import type { PersonalizedDiagnosticVideoRecord } from "./personalized-video";

const NOW = "2026-09-10T12:00:00.000Z";

const INPUTS: RenderEnqueueInputs = {
  offerId: "offer_a",
  offerVersion: "ov1",
  leadId: "lead_a",
  company: "Acme Co",
  website: "https://acme.example",
  evidenceVersion: "ev_1",
  narrationVersion: "pv-narr.v1",
  narrationDigest: "nar1_abc",
  renderVersion: "pv-render.v1",
  idempotencyKey: "personalized-video:offer_a:ov1:ev_1:pv-narr.v1:pv-render.v1",
  buildable: true,
  blockedReason: null,
};

const BINDING: VoiceoverBinding = {
  voiceoverId: "vo_1",
  voiceoverRevision: "nar1_abc",
  voiceGeneration: "current-matt",
};

describe("voice→render auto-enqueue (§1 / #194)", () => {
  it("enqueues a QUEUED render bound to the exact canonical voiceover when none exists", () => {
    const d = planRenderEnqueue(null, INPUTS, BINDING, NOW);
    expect(d.action).toBe("enqueue");
    expect(d.nextRecord?.status).toBe("QUEUED");
    // LINEAGE bound onto the record
    expect(d.nextRecord?.voiceoverId).toBe("vo_1");
    expect(d.nextRecord?.voiceoverRevision).toBe("nar1_abc");
    expect(d.nextRecord?.voiceGeneration).toBe("current-matt");
    expect(d.nextRecord?.queuedAt).toBe(NOW);
    // no durable asset yet — the worker fills these
    expect(d.nextRecord?.mp4Key).toBeNull();
  });

  it("is idempotent: an already-QUEUED render for the same inputs+voiceover is a no-op (no re-enqueue)", () => {
    const existing = buildQueuedRenderRecord(INPUTS, BINDING, NOW);
    const d = planRenderEnqueue(existing, INPUTS, BINDING, NOW);
    expect(d.action).toBe("noop-in-flight");
    expect(d.nextRecord).toBeNull();
  });

  it("is idempotent: an already-RENDERING render for the same inputs+voiceover is a no-op", () => {
    const existing: PersonalizedDiagnosticVideoRecord = { ...buildQueuedRenderRecord(INPUTS, BINDING, NOW), status: "RENDERING" };
    const d = planRenderEnqueue(existing, INPUTS, BINDING, NOW);
    expect(d.action).toBe("noop-in-flight");
  });

  it("reuse (§1/§12): an already-READY render for the same inputs+voiceover is a no-op — never re-renders", () => {
    const existing: PersonalizedDiagnosticVideoRecord = {
      ...buildQueuedRenderRecord(INPUTS, BINDING, NOW),
      status: "READY",
      mp4Key: "k/mp4",
      posterKey: "k/poster",
      mp4Url: "/served/mp4",
      durationSeconds: 42,
    };
    const d = planRenderEnqueue(existing, INPUTS, BINDING, NOW);
    expect(d.action).toBe("noop-ready");
    expect(d.nextRecord).toBeNull();
  });

  it("re-enqueues when the narration/voiceover revision changed (re-recorded narration must re-render)", () => {
    const existing: PersonalizedDiagnosticVideoRecord = {
      ...buildQueuedRenderRecord(INPUTS, BINDING, NOW),
      status: "READY",
      mp4Key: "k/mp4",
    };
    const newBinding: VoiceoverBinding = { ...BINDING, voiceoverId: "vo_2", voiceoverRevision: "nar1_XYZ" };
    const newInputs: RenderEnqueueInputs = { ...INPUTS, narrationDigest: "nar1_XYZ", idempotencyKey: INPUTS.idempotencyKey + ":v2" };
    const d = planRenderEnqueue(existing, newInputs, newBinding, NOW);
    expect(d.action).toBe("enqueue");
    expect(d.nextRecord?.voiceoverId).toBe("vo_2");
    expect(d.nextRecord?.voiceoverRevision).toBe("nar1_XYZ");
  });

  it("blocks (never enqueues) when the storyboard has no honest finding to render", () => {
    const d = planRenderEnqueue(null, { ...INPUTS, buildable: false, blockedReason: "no evidence-backed finding" }, BINDING, NOW);
    expect(d.action).toBe("blocked");
    expect(d.nextRecord?.status).toBe("FAILED");
    expect(d.nextRecord?.failureReason).toContain("no evidence-backed finding");
  });
});

describe("render lineage assertion (§1)", () => {
  const record = buildQueuedRenderRecord(INPUTS, BINDING, NOW);

  it("passes when the audio is the exact bound canonical voiceover", () => {
    expect(() =>
      assertRenderVoiceoverLineage(record, { id: "vo_1", narrationRevision: "nar1_abc", generation: "current-matt" }),
    ).not.toThrow();
  });

  it("throws VOICEOVER_MISMATCH on a different voiceover revision (stale audio can't ride an old render)", () => {
    try {
      assertRenderVoiceoverLineage(record, { id: "vo_1", narrationRevision: "nar1_DIFFERENT", generation: "current-matt" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RenderLineageError);
      expect((e as RenderLineageError).code).toBe("VOICEOVER_MISMATCH");
    }
  });

  it("throws GENERATION_MISMATCH when generations differ (never cross Matt/Lucas)", () => {
    try {
      assertRenderVoiceoverLineage(record, { id: "vo_1", narrationRevision: "nar1_abc", generation: "legacy-lucas" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as RenderLineageError).code).toBe("GENERATION_MISMATCH");
    }
  });

  it("throws MISSING_BINDING when the record has no bound voiceover", () => {
    const unbound: PersonalizedDiagnosticVideoRecord = { ...record, voiceoverId: null, voiceoverRevision: null };
    try {
      assertRenderVoiceoverLineage(unbound, { id: "vo_1", narrationRevision: "nar1_abc", generation: "current-matt" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as RenderLineageError).code).toBe("MISSING_BINDING");
    }
  });
});

describe("render worker claim (§1)", () => {
  const queued = buildQueuedRenderRecord(INPUTS, BINDING, NOW);
  const failed: PersonalizedDiagnosticVideoRecord = { ...buildQueuedRenderRecord({ ...INPUTS, offerId: "offer_b" }, BINDING, NOW), status: "FAILED", failureReason: "ffmpeg exploded" };
  const rendering: PersonalizedDiagnosticVideoRecord = { ...buildQueuedRenderRecord({ ...INPUTS, offerId: "offer_c" }, BINDING, NOW), status: "RENDERING" };
  const ready: PersonalizedDiagnosticVideoRecord = { ...buildQueuedRenderRecord({ ...INPUTS, offerId: "offer_d" }, BINDING, NOW), status: "READY", mp4Key: "k" };
  const unbound: PersonalizedDiagnosticVideoRecord = { ...buildQueuedRenderRecord({ ...INPUTS, offerId: "offer_e" }, BINDING, NOW), voiceoverId: null, voiceoverRevision: null };

  it("claims QUEUED and FAILED (retry) but skips RENDERING/READY", () => {
    const claims = claimQueuedRenders([
      { offerId: "offer_a", record: queued },
      { offerId: "offer_b", record: failed },
      { offerId: "offer_c", record: rendering },
      { offerId: "offer_d", record: ready },
    ]);
    expect(claims.map((c) => c.offerId)).toEqual(["offer_a", "offer_b"]);
    // FAILED claim is a retry — worker MUST reuse the bound voiceover (no ElevenLabs re-spend)
    expect(claims.find((c) => c.offerId === "offer_b")?.isRetry).toBe(true);
    expect(claims.find((c) => c.offerId === "offer_a")?.isRetry).toBe(false);
  });

  it("does not claim an unbound record (nothing to reuse — must be re-enqueued first)", () => {
    const claims = claimQueuedRenders([{ offerId: "offer_e", record: unbound }]);
    expect(claims).toHaveLength(0);
  });

  it("skips null records and orders deterministically by offerId", () => {
    const claims = claimQueuedRenders([
      { offerId: "offer_b", record: failed },
      { offerId: "offer_a", record: queued },
      { offerId: "offer_z", record: null },
    ]);
    expect(claims.map((c) => c.offerId)).toEqual(["offer_a", "offer_b"]);
  });
});
