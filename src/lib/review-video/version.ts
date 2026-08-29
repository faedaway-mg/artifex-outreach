// ─────────────────────────────────────────────────────────────────────────────
// Render input versioning (Batch M1.1 step 2) — a STABLE, deterministic hash of the meaningful render
// inputs, so the queue can reuse artifacts, detect stale ones, and later invalidate approvals. The
// VISUAL version excludes Lucas audio (a preview doesn't depend on it); the FINAL version includes the
// Lucas identity (a new take → a new final). Never uses timestamps (that would make everything stale).
// Pure — same inputs → same version.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickReview } from "../outreach/quick-review";
import type { StoredBusinessIntelligence } from "../types";

/** Bump when the renderer's visual behavior changes so old artifacts invalidate. */
export const RENDERER_VERSION = "m2.2";

/** Deterministic stringify with sorted keys (stable across object key order). */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit hex — small, fast, dependency-free, deterministic. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

type SurfacePkg = StoredBusinessIntelligence["surfacePackage"];

/** The VISUAL render's input version — review content + surfaces + renderer version. NO audio. */
export function visualInputVersion(review: QuickReview, surfacePackage: SurfacePkg, rendererVersion = RENDERER_VERSION): string {
  const meaningful = {
    business: review.businessName,
    openingHook: review.openingHook,
    findings: review.findings.map((f) => ({ id: f.id, topic: f.topic, observation: f.observation, whatWedDo: f.whatWedDo })),
    presentations: review.presentations.map((p) => ({ hook: p.textHook, type: p.visualHook.type, value: p.visualHook.primaryValue, cmp: p.visualHook.comparison })),
    start: review.start ? { label: review.start.label, why: review.start.why } : null,
    surfaces: (surfacePackage?.pages ?? []).map((pg) => ({ url: pg.url, len: pg.html.length, role: pg.role })),
    renderer: rendererVersion,
  };
  return `v-${fnv1a(stable(meaningful))}`;
}

/** The FINAL render's input version — the visual version PLUS the Lucas audio identity. A new Lucas take
 *  (different key/duration) yields a different final version; the visual version is unchanged. */
export function finalInputVersion(visualVersion: string, audio: { key?: string | null; durationSeconds?: number | null } | null): string {
  const audioId = audio ? `${audio.key ?? "-"}:${audio.durationSeconds != null ? Math.round(audio.durationSeconds * 100) : "-"}` : "-";
  return `f-${fnv1a(`${visualVersion}|${audioId}`)}`;
}
