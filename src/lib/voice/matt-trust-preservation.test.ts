import { describe, it, expect } from "vitest";
import { setMattTrustVideo, mattTrustScopeSet, getMattTrustVideo, type MattTrustVideoRecord } from "./matt-trust-store";
import { setLeadVoiceKey, setVoiceConfig } from "./store";

// ── Regression: a voiceover write must NEVER clobber voice.mattTrustVideos ──────────
// The voice store's mutate used to overwrite the whole `voice` namespace with the
// VoiceState projection (leadVoices/voiceovers/config), silently dropping the sibling
// matt-trust-store data. The FIRST social/prospect voiceover generation after a trust
// recovery wiped the recovered Matt trust videos → offers HELD (no CTA). Guard it.

function trustRec(scope: any): MattTrustVideoRecord {
  return {
    scope, voiceoverId: "vo1", narrationRevision: "r1", scriptVersion: "s1",
    mp4Key: "k.mp4", posterKey: "k.jpg", captionsKey: "k.vtt",
    mp4Url: "/api/quick-fix/trust-video/cta-conversion", posterUrl: "/p", captionsUrl: "/c",
    captionsVerified: true, durationSeconds: 70, orientation: "landscape",
  } as any;
}

describe("matt-trust preservation across voice-state writes", () => {
  it("setLeadVoiceKey does not wipe the recovered Matt trust videos", async () => {
    await setMattTrustVideo(trustRec("cta-conversion"), "test");
    expect([...(await mattTrustScopeSet())]).toContain("cta-conversion");
    await setLeadVoiceKey("lead_x", "artifex_default", "test"); // triggers mutateVoiceState
    // The trust video must survive the voice-state write.
    expect([...(await mattTrustScopeSet())]).toContain("cta-conversion");
    expect((await getMattTrustVideo("cta-conversion" as any))?.mp4Key).toBe("k.mp4");
  });

  it("a voice-config write also preserves the trust videos", async () => {
    await setMattTrustVideo(trustRec("cta-conversion"), "test");
    await setVoiceConfig({ monthlyMinuteBudget: 220 }, "test");
    expect([...(await mattTrustScopeSet())]).toContain("cta-conversion");
  });
});
