// ─────────────────────────────────────────────────────────────────────────────
// VOICE GENERATION + STORE — the orchestrator (generateLeadVoiceover) and the
// lead-voice / voiceover store. ElevenLabs is ALWAYS mocked here (MockVoiceProvider
// injected via __setVoiceProviderForTests) so NO real API call is made and ZERO
// credits are consumed. The ElevenLabs *config* is faked with test-key/test-voice so
// elevenLabsConfigured() is true; both env and provider injection are restored in
// afterEach. The in-memory Settings store is reset before each test so cases can't bleed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { __setVoiceProviderForTests, MockVoiceProvider, VoiceProviderError } from "./provider";
import { generateLeadVoiceover } from "./generate";
import {
  getLeadVoiceKey,
  setLeadVoiceKey,
  voiceoversForLead,
  canonicalVoiceover,
  listVoiceovers,
} from "./store";
import { DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY } from "./registry";

const SCRIPT = "Hi there — I noticed your booking page loses visitors on mobile and I recorded a quick fix.";
const ACTOR = "operator-test";

let prevKey: string | undefined;
let prevVoice: string | undefined;

beforeEach(() => {
  __resetStoreForTests(); // fresh in-memory Settings singleton — no leadVoices/voiceovers bleed
  prevKey = process.env.ELEVENLABS_API_KEY;
  prevVoice = process.env.ELEVENLABS_VOICE_ID;
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.ELEVENLABS_VOICE_ID = "test-voice";
  __setVoiceProviderForTests(new MockVoiceProvider()); // deterministic, credit-free
});

afterEach(() => {
  __setVoiceProviderForTests(null); // restore real-provider resolution
  if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = prevKey;
  if (prevVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
  else process.env.ELEVENLABS_VOICE_ID = prevVoice;
});

function baseInput(over: Partial<Parameters<typeof generateLeadVoiceover>[0]> = {}) {
  return {
    leadId: "lead_a",
    company: "Acme Co",
    offerId: "offer_1",
    narrationId: "narr_1",
    narrationRevision: "rev_1",
    narrationScript: SCRIPT,
    actor: ACTOR,
    now: "2026-09-09T12:00:00.000Z",
    // Default scope: trust-video (ungated) so existing reuse/regen/legacy/cap tests are unchanged.
    authorization: { scope: "trust-video" as const },
    ...over,
  };
}

describe("missing config (mandate #1)", () => {
  it("generateLeadVoiceover → 'not_configured' when key+voice are absent", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    const res = await generateLeadVoiceover(baseInput());
    expect(res.status).toBe("not_configured");
    // No record was created for an unconfigured attempt.
    expect(await voiceoversForLead("lead_a")).toHaveLength(0);
  });
});

describe("new lead defaults to Matt (mandate #6)", () => {
  it("getLeadVoiceKey(freshLead) === Matt default", async () => {
    expect(await getLeadVoiceKey("brand_new_lead")).toBe(DEFAULT_VOICE_KEY);
  });
});

describe("lead-level voice inheritance (mandate #7)", () => {
  it("setLeadVoiceKey persists per lead; other leads still default to Matt", async () => {
    await setLeadVoiceKey("lead_lucas", LEGACY_LUCAS_VOICE_KEY, ACTOR);
    expect(await getLeadVoiceKey("lead_lucas")).toBe(LEGACY_LUCAS_VOICE_KEY);
    // A DIFFERENT lead is unaffected.
    expect(await getLeadVoiceKey("lead_other")).toBe(DEFAULT_VOICE_KEY);
  });
});

describe("happy path — Matt + mock provider (mandate #8)", () => {
  it("→ 'ready' with a persisted READY record (duration>0, Matt voiceKey, assetKey set)", async () => {
    const res = await generateLeadVoiceover(baseInput());
    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("unreachable");
    expect(res.voiceover.status).toBe("VOICEOVER_READY");
    expect(res.voiceover.durationSeconds!).toBeGreaterThan(0);
    expect(res.voiceover.voiceKey).toBe(DEFAULT_VOICE_KEY);
    expect(res.voiceover.assetKey).toBeTruthy();
    expect(res.voiceover.provider).toBe("elevenlabs");
    expect(res.voiceDisplayName).toBe("Matt");

    const persisted = await voiceoversForLead("lead_a");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(res.voiceover.id);
    expect(persisted[0].status).toBe("VOICEOVER_READY");
  });
});

describe("idempotent generation (mandate #9)", () => {
  it("twice for the same (lead, narrationRevision) → second is 'reused' (same id, no duplicate canonical)", async () => {
    const first = await generateLeadVoiceover(baseInput());
    const second = await generateLeadVoiceover(baseInput());
    expect(first.status).toBe("ready");
    expect(second.status).toBe("reused");
    if (first.status !== "ready" || second.status !== "reused") throw new Error("unreachable");
    expect(second.voiceover.id).toBe(first.voiceover.id);

    // Exactly one record; exactly one canonical for the revision.
    expect(await voiceoversForLead("lead_a")).toHaveLength(1);
    const canon = await canonicalVoiceover("lead_a", "rev_1", DEFAULT_VOICE_KEY);
    expect(canon?.id).toBe(first.voiceover.id);
  });
});

describe("explicit regeneration force:true (mandate #10)", () => {
  it("→ 'ready' with a NEW id; prior record superseded; both retained", async () => {
    const first = await generateLeadVoiceover(baseInput());
    const regen = await generateLeadVoiceover(baseInput({ force: true, now: "2026-09-09T13:00:00.000Z" }));
    expect(first.status).toBe("ready");
    expect(regen.status).toBe("ready");
    if (first.status !== "ready" || regen.status !== "ready") throw new Error("unreachable");

    expect(regen.voiceover.id).not.toBe(first.voiceover.id);
    expect(regen.voiceover.kind).toBe("regeneration");
    expect(regen.voiceover.supersedes).toBe(first.voiceover.id);

    const all = await voiceoversForLead("lead_a");
    expect(all).toHaveLength(2); // both retained (audit-preserving)
    const oldRec = all.find((v) => v.id === first.voiceover.id)!;
    expect(oldRec.supersededBy).toBe(regen.voiceover.id);

    // The new one is the sole canonical for the revision.
    const canon = await canonicalVoiceover("lead_a", "rev_1", DEFAULT_VOICE_KEY);
    expect(canon?.id).toBe(regen.voiceover.id);
  });
});

describe("narration revision invalidation (mandate #11)", () => {
  it("a new narrationRevision generates fresh; the old revision's canonical is untouched", async () => {
    const first = await generateLeadVoiceover(baseInput({ narrationRevision: "rev_1" }));
    const nextRev = await generateLeadVoiceover(
      baseInput({ narrationRevision: "rev_2", now: "2026-09-09T14:00:00.000Z" }),
    );
    expect(first.status).toBe("ready");
    expect(nextRev.status).toBe("ready"); // NOT reused
    if (first.status !== "ready" || nextRev.status !== "ready") throw new Error("unreachable");
    expect(nextRev.voiceover.id).not.toBe(first.voiceover.id);

    // The old revision's canonical still resolves to the original, untouched record.
    const oldCanon = await canonicalVoiceover("lead_a", "rev_1", DEFAULT_VOICE_KEY);
    expect(oldCanon?.id).toBe(first.voiceover.id);
    expect(oldCanon?.supersededBy).toBeNull();

    const newCanon = await canonicalVoiceover("lead_a", "rev_2", DEFAULT_VOICE_KEY);
    expect(newCanon?.id).toBe(nextRev.voiceover.id);

    expect(await voiceoversForLead("lead_a")).toHaveLength(2);
  });
});

describe("provider failure (mandate #12)", () => {
  it("→ 'failed', a VOICEOVER_FAILED record with a reason, and NO secret in the reason", async () => {
    __setVoiceProviderForTests(new MockVoiceProvider({ failWith: new VoiceProviderError("server_error", "boom") }));
    const res = await generateLeadVoiceover(baseInput());
    expect(res.status).toBe("failed");
    if (res.status !== "failed") throw new Error("unreachable");
    expect(res.reason.length).toBeGreaterThan(0);
    // Sanitized: the fake key/voice must never appear in the failure reason.
    expect(res.reason.includes("test-key")).toBe(false);

    const all = await voiceoversForLead("lead_a");
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("VOICEOVER_FAILED");
    expect(all[0].failureReason).toBeTruthy();
    expect(all[0].failureReason!.includes("test-key")).toBe(false);
  });
});

describe("legacy journey (mandate #13)", () => {
  it("a legacy-Lucas lead → 'legacy'; Lucas is NOT regenerated (no new record)", async () => {
    await setLeadVoiceKey("lead_lucas", LEGACY_LUCAS_VOICE_KEY, ACTOR);
    const res = await generateLeadVoiceover(baseInput({ leadId: "lead_lucas" }));
    expect(res.status).toBe("legacy");
    if (res.status !== "legacy") throw new Error("unreachable");
    expect(res.voiceKey).toBe(LEGACY_LUCAS_VOICE_KEY);
    // No ElevenLabs generation happened → no voiceover record for the legacy lead.
    expect(await voiceoversForLead("lead_lucas")).toHaveLength(0);
  });
});

describe("no-send invariant (mandate #19)", () => {
  it("a full generation makes NO outbound fetch (no mail/dispatch call)", async () => {
    // Trip the wire: any real network attempt (e.g. a send) would go through fetch.
    // The mock provider is injected, so a correct generation never touches fetch.
    const original = globalThis.fetch;
    let fetchCalls = 0;
    // Deliberately replace fetch to detect ANY network attempt during generation.
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls += 1;
      throw new Error(`unexpected network call in voice generation: ${String(args[0])}`);
    }) as unknown as typeof fetch;
    try {
      const res = await generateLeadVoiceover(baseInput());
      expect(res.status).toBe("ready");
      expect(fetchCalls).toBe(0); // NO send, NO provider HTTP — fully offline
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the generate module does not import any email/send/dispatch module (structural)", async () => {
    // Structural assertion: reading generate.ts, none of its imports are send-shaped.
    // (Kept deterministic — no network, no runtime send seam.)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "generate.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(/from\s+["'][^"']*(comms|dispatch|send|email|resend|mailer)[^"']*["']/i.test(line)).toBe(false);
    }
  });
});

describe("reuse creates no new record (mandate #16 — store side)", () => {
  it("a reused call does not change the voiceover count", async () => {
    await generateLeadVoiceover(baseInput());
    const countAfterFirst = (await listVoiceovers()).length;
    const reused = await generateLeadVoiceover(baseInput());
    expect(reused.status).toBe("reused");
    expect((await listVoiceovers()).length).toBe(countAfterFirst);
  });
});

// ── PAID-COMPUTE GATE on prospect voice generation (mandate §6, §202) ──────────
describe("paid-compute gate blocks non-finalist prospect voice (§6/§202)", () => {
  const KEY = "LEAD_SPRINT_PAID_COMPUTE_ENABLED";
  afterEach(() => { delete process.env[KEY]; });

  const prospect = (over = {}) =>
    baseInput({
      leadId: "lead_prospect_gate",
      authorization: { scope: "prospect-journey", context: { leadId: "lead_prospect_gate", state: "production_finalist", meetsMinimumContract: true, isRankedFinalist: true, ...over } },
    } as any);

  it("refuses a NEW prospect generation when the gate is disabled (fail-closed)", async () => {
    const res = await generateLeadVoiceover(prospect());
    expect(res.status).toBe("gated");
    expect((res as { reason: string }).reason).toMatch(/GATE_DISABLED|disabled/i);
  });

  it("allows a prospect generation when enabled AND the candidate is an authorized finalist", async () => {
    process.env[KEY] = "1";
    const res = await generateLeadVoiceover(prospect());
    expect(res.status).toBe("ready"); // mock provider — no real credits
  });

  it("refuses a non-finalist even when the gate is enabled", async () => {
    process.env[KEY] = "1";
    const res = await generateLeadVoiceover(prospect({ isRankedFinalist: false }));
    expect(res.status).toBe("gated");
    expect((res as { reason: string }).reason).toMatch(/finalist/i);
  });

  it("NEVER gates a reuse — a retry reuses the existing voiceover with no spend (§11)", async () => {
    // Create the asset via an ungated (trust) scope, then retry as a prospect with the gate OFF.
    await generateLeadVoiceover(baseInput({ leadId: "lead_reuse_gate" }));
    const res = await generateLeadVoiceover(
      baseInput({ leadId: "lead_reuse_gate", authorization: { scope: "prospect-journey", context: { leadId: "lead_reuse_gate", state: "production_finalist", meetsMinimumContract: true, isRankedFinalist: true } } } as any),
    );
    expect(res.status).toBe("reused"); // reuse returns before the gate — no gating, no spend
  });
});
