// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH STATE STORE. Persists the per-piece zero-touch generation
// state (the operator's brief, the system-written script, the script revision, and the
// last calm stage) in the Settings JSONB singleton (namespace contentStudio.zeroTouch).
// No migration. The brief is the operator's only creative input; everything downstream
// (script, voice, animation, captions, render) is derived and reproducible.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { getSettings, updateSettings, appendAudit } from "../repo";

export interface ZeroTouchState {
  pieceId: string;
  brief: string;
  /** System-written narration lines (derived from the brief). */
  script: string[];
  /** Changes when the script changes → justifies a new voice; stable render reuse otherwise. */
  scriptRevision: string;
  updatedAt: string;
}

/** Deterministic revision for a script (stable across identical scripts → audio reuse). */
export function scriptRevisionOf(script: string[]): string {
  return createHash("sha256").update(script.join("\n")).digest("hex").slice(0, 16);
}

async function readAll(): Promise<Record<string, ZeroTouchState>> {
  const s = (await getSettings()) as any;
  return (s.contentStudio?.zeroTouch ?? {}) as Record<string, ZeroTouchState>;
}

export async function getZeroTouchState(pieceId: string): Promise<ZeroTouchState | null> {
  return (await readAll())[pieceId] ?? null;
}

export async function listZeroTouchStates(): Promise<Record<string, ZeroTouchState>> {
  return readAll();
}

export async function setZeroTouchState(state: ZeroTouchState, actor: string): Promise<void> {
  const s = (await getSettings()) as any;
  const cs = (s.contentStudio ?? {}) as any;
  const m = { ...(cs.zeroTouch ?? {}) } as Record<string, ZeroTouchState>;
  m[state.pieceId] = state;
  await updateSettings({ contentStudio: { ...cs, zeroTouch: m } } as any);
  await appendAudit({ action: "content_studio.zero_touch_state_set", actor, targetType: "content_piece", targetId: state.pieceId, meta: { scriptRevision: state.scriptRevision }, ip: null });
}
