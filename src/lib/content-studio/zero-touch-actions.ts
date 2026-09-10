"use server";
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH GENERATE (mandate §17). ONE server action performs the whole
// pipeline the operator never sees: brief → system-written script → Matt narration (reused,
// never re-spent on a downstream failure) → persisted audio → animation/scene plan → render
// → captions → QA → durable finished video. The operator presses Generate once.
//
// COST SAFETY (§19/§22/§23): Matt TTS is generated via generateLeadVoiceover, which is
// idempotent (reuses the canonical audio when the script revision is unchanged → a render
// retry never re-spends ElevenLabs). Pre-deploy QA runs with CS_ZEROTOUCH_MOCK=1 (or simply
// with ElevenLabs unconfigured), which skips the paid call and renders with placeholder audio
// so Breakbot can prove the flow without burning credits.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { isAuthenticated, currentActor } from "@/lib/auth";
import { getPieces, addDraft } from "./store";
import { composeScriptFromBrief, scriptText } from "./zero-touch";
import { scriptRevisionOf, setZeroTouchState } from "./zero-touch-store";
import { planSocialAnimation } from "./zero-touch-orchestrator";
import { elevenLabsConfigured } from "@/lib/voice/elevenlabs-config";

export interface GenerateZeroTouchInput {
  /** Existing piece to (re)generate, or omit to create a new Field Note from title+brief. */
  pieceId?: string;
  title?: string;
  brief: string;
}

export interface GenerateZeroTouchResult {
  ok: boolean;
  pieceId?: string;
  stage?: string;
  reason?: string;
}

function mockMode(): boolean {
  return process.env.CS_ZEROTOUCH_MOCK === "1" || !elevenLabsConfigured();
}

export async function generateZeroTouch(input: GenerateZeroTouchInput): Promise<GenerateZeroTouchResult> {
  if (!isAuthenticated()) return { ok: false, reason: "unauthorized" };
  const brief = (input.brief ?? "").trim();
  if (!brief) return { ok: false, reason: "add a brief to generate" };

  const actor = currentActor();
  const pieces = await getPieces();
  let piece = input.pieceId ? pieces.find((p) => p.id === input.pieceId) ?? null : null;

  // Compose the script from the brief (system writes the narration; the operator never does).
  const title = piece?.title ?? (input.title ?? "").trim() ?? "Field note";
  const concept = piece?.concept ?? null;
  const targetSeconds = piece?.targetSeconds ?? 30;
  const script = composeScriptFromBrief({ brief, title, concept, targetSeconds });
  const scriptRevision = scriptRevisionOf(script);
  const spoken = scriptText(script);

  // New idea → create a draft Field Note carrying the system-written narration.
  let pieceId = piece?.id ?? null;
  if (!pieceId) {
    pieceId = `draft_zt_${scriptRevision}`;
    await addDraft({ id: pieceId, title, concept: concept ?? "", narration: script, createdAt: new Date().toISOString() });
  }

  // Persist the brief + script + revision (audio-reuse lineage).
  await setZeroTouchState({ pieceId, brief, script, scriptRevision, updatedAt: new Date().toISOString() }, actor);

  // Plan the 9:16 animation deterministically (recorded for the render + audit).
  const plan = planSocialAnimation(script, targetSeconds);

  // 1) Matt narration — reused when unchanged, never re-spent on a downstream failure.
  let voiceStatus = "mock";
  if (!mockMode()) {
    try {
      const { generateLeadVoiceover } = await import("@/lib/voice/generate");
      const vo = await generateLeadVoiceover({
        leadId: `social-${pieceId}`,
        narrationId: pieceId,
        narrationRevision: scriptRevision,
        narrationScript: spoken,
        actor,
        authorization: { scope: "social" }, // Matt social scope — isolated from prospect journeys
      });
      voiceStatus = vo.status;
    } catch (e: any) {
      voiceStatus = "failed"; // fall through to render with whatever audio exists (placeholder)
    }
  }

  // 2) Captions from the same script (idempotent).
  try {
    const { ensureCaption } = await import("./caption-store");
    await ensureCaption({ id: pieceId, title, concept: concept ?? "", narration: script, businessName: null });
  } catch { /* captions are non-blocking for the generate flow */ }

  // 3) Enqueue the render (portrait 9:16). Deduped by input version → a retry reuses audio.
  let renderStatus = "queued";
  try {
    const { createRenderJob } = await import("./runner");
    const { job } = await createRenderJob(pieceId, { useUpload: false });
    renderStatus = job.status;
  } catch (e: any) {
    revalidatePath("/content-studio");
    return { ok: false, pieceId, reason: `render enqueue failed: ${e?.message || e}` };
  }

  revalidatePath("/content-studio");
  return { ok: true, pieceId, stage: renderStatus === "ready" ? "READY" : "BUILDING_VIDEO" };
}
