// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST-VIDEO STORE — the scope-keyed registry of incrementally-built Matt trust
// videos, persisted in the Settings JSONB singleton. These tests use the in-memory
// Settings store (reset before each test via __resetStoreForTests) so no DB is needed
// and cases can't bleed. No render, no ElevenLabs, no send — pure store behavior.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import {
  getMattTrustVideo,
  setMattTrustVideo,
  listMattTrustVideos,
  mattTrustScopeSet,
  mattTrustServedPaths,
  type MattTrustVideoRecord,
} from "./matt-trust-store";
import type { TrustVideoScope } from "../quick-fix/trust-videos";

beforeEach(() => {
  __resetStoreForTests(); // fresh in-memory Settings singleton — no mattTrustVideos bleed
});

function record(scope: TrustVideoScope, over: Partial<MattTrustVideoRecord> = {}): MattTrustVideoRecord {
  const served = mattTrustServedPaths(scope);
  return {
    scope,
    voiceoverId: `vo_${scope}`,
    narrationRevision: "trust1_abc123",
    scriptVersion: "qf-trust-v1-2026-09",
    mp4Key: `content-studio/test/upload/matt-trust-render/${scope}_deadbeef.mp4`,
    posterKey: `content-studio/test/upload/matt-trust-render/${scope}_deadbeef.jpg`,
    captionsKey: `content-studio/test/upload/matt-trust-render/${scope}_deadbeef.vtt`,
    mp4Url: served.mp4Url,
    posterUrl: served.posterUrl,
    captionsUrl: served.captionsUrl,
    captionsVerified: true,
    durationSeconds: 71.4,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...over,
  };
}

describe("get / set", () => {
  it("getMattTrustVideo returns null before any record is set", async () => {
    expect(await getMattTrustVideo("seo-metadata")).toBeNull();
  });

  it("set then get round-trips the exact record", async () => {
    const rec = record("seo-metadata");
    await setMattTrustVideo(rec, "matt-trust-render");
    expect(await getMattTrustVideo("seo-metadata")).toEqual(rec);
  });

  it("set is keyed by SCOPE — a second set for the same scope replaces (never accumulates)", async () => {
    await setMattTrustVideo(record("cta-conversion", { voiceoverId: "vo_old", durationSeconds: 60 }), "matt-trust-render");
    await setMattTrustVideo(record("cta-conversion", { voiceoverId: "vo_new", durationSeconds: 70 }), "matt-trust-render");
    const got = await getMattTrustVideo("cta-conversion");
    expect(got?.voiceoverId).toBe("vo_new");
    expect(got?.durationSeconds).toBe(70);
    expect((await listMattTrustVideos()).filter((r) => r.scope === "cta-conversion")).toHaveLength(1);
  });

  it("different scopes are stored independently (no cross-scope overwrite)", async () => {
    await setMattTrustVideo(record("seo-metadata"), "matt-trust-render");
    await setMattTrustVideo(record("mobile-responsive"), "matt-trust-render");
    expect((await getMattTrustVideo("seo-metadata"))?.scope).toBe("seo-metadata");
    expect((await getMattTrustVideo("mobile-responsive"))?.scope).toBe("mobile-responsive");
  });
});

describe("list", () => {
  it("lists every stored record", async () => {
    await setMattTrustVideo(record("seo-metadata"), "matt-trust-render");
    await setMattTrustVideo(record("accessibility"), "matt-trust-render");
    const all = await listMattTrustVideos();
    expect(all.map((r) => r.scope).sort()).toEqual(["accessibility", "seo-metadata"]);
  });

  it("is empty on a fresh store", async () => {
    expect(await listMattTrustVideos()).toEqual([]);
  });
});

describe("mattTrustScopeSet — only scopes with a durable mp4Key count", () => {
  it("includes a scope with an mp4Key", async () => {
    await setMattTrustVideo(record("seo-metadata"), "matt-trust-render");
    expect(await mattTrustScopeSet()).toEqual(new Set(["seo-metadata"]));
  });

  it("EXCLUDES a scope whose record has no mp4Key (not production-serveable yet)", async () => {
    await setMattTrustVideo(record("cta-conversion", { mp4Key: null }), "matt-trust-render");
    const set = await mattTrustScopeSet();
    expect(set.has("cta-conversion")).toBe(false);
    expect(set.size).toBe(0);
  });

  it("counts only the mp4-backed scopes across a mix", async () => {
    await setMattTrustVideo(record("seo-metadata"), "matt-trust-render");
    await setMattTrustVideo(record("mobile-responsive", { mp4Key: null }), "matt-trust-render");
    await setMattTrustVideo(record("accessibility"), "matt-trust-render");
    expect(await mattTrustScopeSet()).toEqual(new Set(["seo-metadata", "accessibility"]));
  });
});

describe("mattTrustServedPaths — app-managed served routes (never raw storage URLs)", () => {
  it("returns the /api/quick-fix/trust-video/<scope> route shape", () => {
    const p = mattTrustServedPaths("seo-metadata");
    expect(p.mp4Url).toBe("/api/quick-fix/trust-video/seo-metadata");
    expect(p.posterUrl).toBe("/api/quick-fix/trust-video/seo-metadata/poster");
    expect(p.captionsUrl).toBe("/api/quick-fix/trust-video/seo-metadata/captions");
  });

  it("never exposes a content-studio object key or a filesystem path", () => {
    const p = mattTrustServedPaths("cta-conversion");
    for (const url of [p.mp4Url, p.posterUrl, p.captionsUrl]) {
      expect(url.startsWith("/api/quick-fix/trust-video/")).toBe(true);
      expect(url).not.toContain("content-studio");
      expect(url).not.toContain("..");
    }
  });
});
