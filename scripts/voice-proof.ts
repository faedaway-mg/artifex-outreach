#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED MATT PROOF — ONE real ElevenLabs generation against an ISOLATED
// internal test lead. Proves the narration→Matt-audio→persist→playable→usage chain
// end-to-end in production. NEVER sends anything, never prints the API key, and uses
// an internal lead id that is NOT a prospect and cannot enter any outbound queue.
//
//   railway run --service Postgres bash -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" CS_STORAGE_PROVIDER=postgres \
//      ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" ELEVENLABS_VOICE_ID="$ELEVENLABS_VOICE_ID" \
//      ELEVENLABS_MODEL_ID="$ELEVENLABS_MODEL_ID" ELEVENLABS_OUTPUT_FORMAT="$ELEVENLABS_OUTPUT_FORMAT" \
//      ./node_modules/.bin/tsx scripts/voice-proof.ts'
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Fail-closed: strip any send/charge credentials so this can NEVER dispatch.
for (const k of ["RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_QUICKFIX_SECRET_KEY", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY"]) delete process.env[k];

import { generateLeadVoiceover } from "../src/lib/voice/generate";
import { getVoiceover, listVoiceovers, getVoiceConfig } from "../src/lib/voice/store";
import { getArtifactStore } from "../src/lib/content-studio/storage-factory";
import { computeVoiceUsage } from "../src/lib/voice/usage";
import { publicElevenLabsConfig } from "../src/lib/voice/elevenlabs-config";

const LEAD = "voice_proof_internal"; // isolated internal fixture — never a prospect
const NARRATION = "Hi, this is Artifex Labs. We took a close look at your website and put together a short walkthrough of what we found and the exact fix we would make.";

function probe(buf: Buffer): number {
  const dir = mkdtempSync(path.join(tmpdir(), "vproof-"));
  try {
    const f = path.join(dir, "a.mp3");
    writeFileSync(f, buf);
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", f], { encoding: "utf8" }).trim();
    return Number(out) || 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const cfg = publicElevenLabsConfig(); // safe: booleans + non-secret knobs only
  const before = (await listVoiceovers()).filter((v) => v.status === "VOICEOVER_READY").length;

  const res = await generateLeadVoiceover({
    leadId: LEAD,
    company: "Internal Proof (not a prospect)",
    offerId: null,
    narrationId: `${LEAD}_proof`,
    narrationScript: NARRATION,
    actor: "voice-proof",
    // deterministic-ish narrationRevision so re-runs are idempotent (reuse, no extra credits)
    narrationRevision: "proof-rev-1",
    // Internal operator proof (not a prospect) — hidden admin-recovery scope, not finalist-gated.
    authorization: { scope: "admin-recovery", operator: "voice-proof" },
  });

  const report: Record<string, unknown> = {
    elevenLabsConfig: cfg, // { configured, hasApiKey, hasVoiceId, modelId, outputFormat } — NO key/voiceId value
    status: res.status,
    voice: (res as any).voiceDisplayName ?? null,
    reason: (res as any).reason ?? null,
  };

  if (res.status === "ready" || res.status === "reused") {
    const rec = await getVoiceover(res.voiceover.id);
    let playableSeconds = 0;
    let servedBytes = 0;
    if (rec?.assetKey) {
      const bytes = await getArtifactStore().readFull(rec.assetKey);
      if (bytes) {
        servedBytes = bytes.byteLength;
        playableSeconds = probe(bytes);
      }
    }
    const usage = computeVoiceUsage(await listVoiceovers(), await getVoiceConfig(), new Date().toISOString());
    Object.assign(report, {
      voiceoverId: rec?.id,
      voiceKey: rec?.voiceKey,
      recordDurationSeconds: rec?.durationSeconds,
      persistedAssetBytes: rec?.assetBytes,
      servedBytesFromStore: servedBytes,
      ffprobePlayableSeconds: Math.round(playableSeconds * 100) / 100,
      kind: rec?.kind,
      readyBefore: before,
      readyAfter: (await listVoiceovers()).filter((v) => v.status === "VOICEOVER_READY").length,
      usageMinutesThisPeriod: usage.minutesThisPeriod,
      usageVoiceoversThisPeriod: usage.voiceoversThisPeriod,
      usageAverageSeconds: usage.averageSeconds,
    });
  }

  report.sendsPerformed = 0; // this script has no send path at all
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("voice-proof failed:", (e as Error).message);
  process.exit(1);
});
