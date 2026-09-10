#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST-VIDEO RENDER — the incremental, reusable Matt trust-video pipeline.
//
// A Matt trust video is generated ONCE per SCOPE and REUSED across every Matt journey
// of that scope (the resolver reads the durable record; it never re-renders per lead).
// This ops tool renders ONE scope per invocation and is idempotent: a second run for a
// scope whose stored record already matches the current narration revision + mp4 key
// short-circuits with {reused:true} and spends NOTHING (no ElevenLabs credit, no
// render). The Matt trust video REQUIRES real Matt audio — if the canonical Matt
// voiceover cannot be produced (legacy/not_configured/capped/failed) we EXIT non-zero
// WITHOUT rendering: we never render silent-as-Matt and never fall back to Lucas.
//
// Legacy Lucas assets in public/trust-videos/ are NEVER touched by this tool — it only
// ADDS Matt assets (durable object-store keys + a scope-keyed record).
//
// NEVER SENDS, NEVER CHARGES. Fail-closed: any send/charge credential is stripped from
// the environment before anything else loads, exactly like scripts/voice-proof.ts.
//
//   DRY RUN (no generation, no render, no writes):
//     pnpm -s tsx scripts/matt-trust-video-render.ts --scope <scope>
//   REAL RENDER (guarded behind --render; produces + persists the Matt trust video):
//     pnpm -s tsx scripts/matt-trust-video-render.ts --scope <scope> --render
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Fail-closed: strip any send/charge credentials so this can NEVER dispatch or bill.
for (const k of ["RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_QUICKFIX_SECRET_KEY", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY"]) delete process.env[k];

import { trustVideoScript, TRUST_VIDEO_SCRIPT_VERSION, type TrustVideoScope } from "../src/lib/quick-fix/trust-videos";
import { buildTrustVideoStoryboard, trustNarrationRevision } from "../src/lib/quick-fix/trust-video-storyboard";
import { buildPersonalizedVideoRenderPlan } from "../src/lib/quick-fix/personalized-video-render-plan";
import { renderPlanToMp4, type ScreenshotBytesProvider } from "./personalized-video-render";
import { generateLeadVoiceover } from "../src/lib/voice/generate";
import {
  getMattTrustVideo,
  setMattTrustVideo,
  mattTrustServedPaths,
  type MattTrustVideoRecord,
} from "../src/lib/voice/matt-trust-store";
import { getArtifactStore } from "../src/lib/content-studio/storage-factory";
import { buildObjectKey } from "../src/lib/content-studio/cs-object-key";
import { csEnvironment } from "../src/lib/content-studio/env-guard";

const ROOT = process.cwd();
const ACTOR = "matt-trust-render";

// The scopes that have a real evergreen trust script. `general` is script-only (no
// rendered asset), so it is not a valid render target — mirror trust-videos' catalog.
const RENDERABLE_SCOPES: TrustVideoScope[] = [
  "contact-form-lead-capture", "cta-conversion", "mobile-responsive", "accessibility",
  "analytics-tracking", "cms-technical", "seo-metadata", "homepage-sprint", "fix-scan",
];

function isRenderableScope(s: string): s is TrustVideoScope {
  return (RENDERABLE_SCOPES as string[]).includes(s);
}

function argVal(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// ── DRY RUN — describe what a real render WOULD do; no generation, no writes. ─────
async function runDryRun(scope: TrustVideoScope): Promise<void> {
  const script = trustVideoScript(scope);
  const narrationRevision = trustNarrationRevision(scope);
  const existing = await getMattTrustVideo(scope);
  const upToDate = !!existing && existing.narrationRevision === narrationRevision && !!existing.mp4Key;

  console.log(JSON.stringify({
    mode: "dry-run",
    scope,
    scriptLength: script.length,
    narrationRevision,
    mattAssetExists: !!existing && !!existing.mp4Key,
    mattAssetUpToDate: upToDate,
    wouldGenerate: !upToDate,
    note: upToDate
      ? "A matching Matt trust video already exists — a real run would REUSE it (no generation)."
      : "No matching Matt trust video — a real run (--render) would generate the Matt voiceover and render.",
  }, null, 2));
}

// ── REAL RENDER — incremental + idempotent. One scope per invocation. ────────────
async function runRender(scope: TrustVideoScope): Promise<void> {
  const nowIso = () => new Date().toISOString();
  const narrationRevision = trustNarrationRevision(scope);
  const script = trustVideoScript(scope);

  // (a) IDEMPOTENT REUSE — a stored record already bound to the current narration
  //     revision WITH a durable mp4 key is complete. Never regenerate identical Matt
  //     narration; short-circuit before touching ElevenLabs or the renderer.
  const existing = await getMattTrustVideo(scope);
  if (existing && existing.narrationRevision === narrationRevision && existing.mp4Key) {
    console.log(JSON.stringify({ scope, status: "READY", reused: true, mp4Key: existing.mp4Key, voiceoverId: existing.voiceoverId, durationSeconds: existing.durationSeconds }, null, 2));
    return;
  }

  // (b) MATT AUDIO IS REQUIRED. Generate (or reuse) the canonical Matt voiceover bound
  //     to the trust narration revision. A trust-scope lead id (`trust:<scope>`) defaults
  //     to Matt (new lead ⇒ Matt) and is never a prospect. If Matt audio cannot be
  //     produced, EXIT non-zero WITHOUT rendering — never silent-as-Matt, never Lucas.
  const vo = await generateLeadVoiceover({
    leadId: `trust:${scope}`,
    company: "Artifex Labs — Trust Video (not a prospect)",
    offerId: null,
    narrationId: `trust:${scope}`,
    narrationRevision,
    narrationScript: script,
    actor: ACTOR,
    // The shared evergreen trust asset (§23) — deliberate infra creation, not per-prospect finalist
    // production, so it is not blocked by the finalist cost gate (still ledger-tracked).
    authorization: { scope: "trust-video" },
  });
  if (vo.status !== "ready" && vo.status !== "reused") {
    const reason = (vo as { reason?: string }).reason ?? vo.status;
    console.error(JSON.stringify({ scope, status: "BLOCKED", voiceover: vo.status, reason, note: "A Matt trust video REQUIRES Matt audio — refusing to render silent-as-Matt or fall back to Lucas." }, null, 2));
    process.exit(3);
  }
  if (!vo.voiceover.assetKey) {
    console.error(JSON.stringify({ scope, status: "BLOCKED", voiceover: vo.status, reason: "canonical Matt voiceover has no persisted asset key", note: "Refusing to render without the Matt audio bytes." }, null, 2));
    process.exit(3);
  }
  const voiceoverId = vo.voiceover.id;

  // (c) Read the Matt audio bytes from the ArtifactStore → a temp file for the mux.
  const store = getArtifactStore();
  const outDir = path.join(ROOT, "public", "trust-videos", "matt", scope);
  mkdirSync(outDir, { recursive: true });
  const audioBytes = await store.readFull(vo.voiceover.assetKey);
  if (!audioBytes) {
    console.error(JSON.stringify({ scope, status: "BLOCKED", reason: "Matt voiceover asset bytes unavailable from the ArtifactStore", note: "Refusing to render silent-as-Matt." }, null, 2));
    process.exit(3);
  }
  const audioPath = path.join(outDir, "voiceover.mp3");
  writeFileSync(audioPath, audioBytes);

  // (d) storyboard → deterministic render plan → mp4/poster/vtt (with the Matt audio
  //     muxed on). The trust storyboard has NO screenshot scenes, so the provider only
  //     ever returns null (it is never asked for a real capture).
  const storyboard = buildTrustVideoStoryboard(scope);
  const plan = buildPersonalizedVideoRenderPlan(storyboard);
  if (!plan.buildable) {
    console.error(JSON.stringify({ scope, status: "BLOCKED", reason: plan.blockedReason ?? "trust render plan not buildable" }, null, 2));
    process.exit(3);
  }
  const emptyProvider: ScreenshotBytesProvider = async () => null;

  const browser = await chromium.launch();
  try {
    const result = await renderPlanToMp4(browser, plan, emptyProvider, outDir, `trust_${scope}`, audioPath);
    if (!(result.durationSeconds > 0)) throw new Error("rendered a zero-duration mp4");

    // (e) PERSIST TO DURABLE STORAGE — the local public/ files are render scratch, not
    //     production truth. Push mp4 + poster + vtt into the canonical ArtifactStore so
    //     the served route streams durable bytes (survives redeploys). Keys are versioned
    //     by the render digest so a re-render is a new immutable object, never in-place.
    const renderVersionTag = `${scope}_${result.renderedAssetDigest.slice(0, 16)}`;
    const mkKey = (ext: string) =>
      buildObjectKey({ artifactClass: "upload", env: csEnvironment(), operatorId: ACTOR, version: renderVersionTag, ext });
    const mp4Put = await store.put(mkKey("mp4"), readFileSync(result.mp4Path), { artifactClass: "upload", contentType: "video/mp4", metadata: { trustVideo: scope, kind: "matt-trust-video-mp4" } });
    const posterPut = await store.put(mkKey("jpg"), readFileSync(result.posterPath), { artifactClass: "upload", contentType: "image/jpeg", metadata: { trustVideo: scope, kind: "matt-trust-video-poster" } });
    const captionsPut = await store.put(mkKey("vtt"), readFileSync(result.vttPath), { artifactClass: "upload", contentType: "text/vtt", metadata: { trustVideo: scope, kind: "matt-trust-video-captions" } });

    // (f) Persist the scope-keyed record. Served routes are app-managed (never a raw
    //     storage URL / filesystem path). captionsVerified = plan.captionsVerbatim: the
    //     VTT is the narration verbatim (same words as the kinetic text), exact by
    //     construction — there is no separate transcript to reconcile.
    const served = mattTrustServedPaths(scope);
    const now = nowIso();
    const record: MattTrustVideoRecord = {
      scope,
      voiceoverId,
      narrationRevision,
      scriptVersion: TRUST_VIDEO_SCRIPT_VERSION,
      mp4Key: mp4Put.key,
      posterKey: posterPut.key,
      captionsKey: captionsPut.key,
      mp4Url: served.mp4Url,
      posterUrl: served.posterUrl,
      captionsUrl: served.captionsUrl,
      captionsVerified: plan.captionsVerbatim,
      durationSeconds: result.durationSeconds,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await setMattTrustVideo(record, ACTOR);

    console.log(JSON.stringify({
      scope,
      status: "READY",
      reused: false,
      mp4Key: record.mp4Key,
      voiceoverId,
      voiceover: vo.status,
      durationSeconds: Math.round(result.durationSeconds * 100) / 100,
      totalFrames: result.totalFrames,
      vttCues: result.vttCueCount,
      narrationRevision,
    }, null, 2));
  } finally {
    await browser.close();
    // Clean the render scratch — the durable object store is the source of truth.
    rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  const scope = argVal("--scope");
  if (!scope) {
    console.error("Usage:");
    console.error("  pnpm -s tsx scripts/matt-trust-video-render.ts --scope <scope>            # dry run");
    console.error("  pnpm -s tsx scripts/matt-trust-video-render.ts --scope <scope> --render   # real render");
    console.error(`  scopes: ${RENDERABLE_SCOPES.join(", ")}`);
    process.exit(2);
  }
  if (!isRenderableScope(scope)) {
    console.error(`Unknown or non-renderable scope: ${JSON.stringify(scope)}. Renderable scopes: ${RENDERABLE_SCOPES.join(", ")}`);
    process.exit(2);
  }

  if (process.argv.includes("--render")) {
    await runRender(scope);
    return;
  }
  // No --render → dry run only. A real render mutates persisted state + spends credits.
  await runDryRun(scope);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
