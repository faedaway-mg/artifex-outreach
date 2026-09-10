"use server";
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — IDEA QUEUE ACTIONS (mandate D). The operator curates a feed the
// system fills. Generating an IDEA is cheap and spends NOTHING (no TTS, no render) —
// paid Matt/video begins only when the operator presses Generate on a specific concept,
// which routes the idea's auto-written brief into the existing Zero-Touch pipeline.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { generateSocialIdeas } from "./social-ideas";
import { addIdeas, archiveIdea, getIdea, setIdea, activeIdeaTitles } from "./idea-store";
import { generateZeroTouch, type GenerateZeroTouchResult } from "./zero-touch-actions";

export interface GenerateIdeaResult {
  ok: boolean;
  added: number;
  reason?: string;
}

/** Generate one or more NEW social concepts (optionally steered). NO paid resources. */
export async function generateIdeaAction(steer?: string, count = 1): Promise<GenerateIdeaResult> {
  if (!isAuthenticated()) return { ok: false, added: 0, reason: "unauthorized" };
  const { keys, titles } = await activeIdeaTitles();
  const seed = Date.now() % 100000; // rotation only; not security-sensitive
  const ideas = generateSocialIdeas({ existingKeys: keys, existingTitles: titles, steer: steer?.trim() || null, count, seed });
  if (!ideas.length) return { ok: true, added: 0, reason: "No fresh concepts right now — archive a few to make room." };
  const added = await addIdeas(ideas);
  revalidatePath("/content-studio");
  return { ok: true, added: added.length };
}

/** Dismiss / archive an idea (reduces similar future suggestions). */
export async function archiveIdeaAction(id: string): Promise<{ ok: boolean }> {
  if (!isAuthenticated()) return { ok: false };
  await archiveIdea(id);
  revalidatePath("/content-studio");
  return { ok: true };
}

/**
 * Produce the finished video for a chosen idea. Routes the idea's canonical (auto-written)
 * brief into Zero-Touch — the operator never re-describes it. Honors the capacity reserve:
 * a generation crossing the Acquisition reserve returns needsOverride (no spend) until the
 * operator explicitly authorizes THIS one via override.
 */
export async function generateIdeaVideoAction(id: string, override = false): Promise<GenerateZeroTouchResult & { ideaId: string }> {
  if (!isAuthenticated()) return { ok: false, reason: "unauthorized", ideaId: id };
  const idea = await getIdea(id);
  if (!idea) return { ok: false, reason: "idea not found", ideaId: id };

  const res = await generateZeroTouch({
    pieceId: idea.pieceId ?? undefined,
    title: idea.title,
    brief: idea.brief,
    override,
  });

  if (res.needsOverride) return { ...res, ideaId: id }; // held at the reserve boundary — nothing generated
  if (res.ok && res.pieceId) {
    await setIdea(id, { state: "GENERATING", pieceId: res.pieceId });
  } else if (!res.ok) {
    await setIdea(id, { state: "FAILED" });
  }
  revalidatePath("/content-studio");
  return { ...res, ideaId: id };
}
