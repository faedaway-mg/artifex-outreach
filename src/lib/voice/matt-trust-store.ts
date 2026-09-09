// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST-VIDEO LIBRARY — persistent registry of the incrementally-built Matt
// trust videos, keyed by SCOPE (not by lead). The trust narration is the SAME for
// every Matt journey of a scope (trustVideoScript(scope)), so a Matt trust video is
// generated ONCE per scope and REUSED across all Matt journeys — reuse never counts
// as a new generation. Persisted in the Settings JSONB singleton (namespace
// `voice.mattTrustVideos`); no migration. Legacy Lucas assets in public/trust-videos/
// are untouched by this module — it only ever ADDS Matt assets.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";
import type { TrustVideoScope } from "../quick-fix/trust-videos";

export interface MattTrustVideoRecord {
  scope: TrustVideoScope;
  /** The canonical (Matt) voiceover this render was muxed against — reuse lineage. */
  voiceoverId: string | null;
  /** The trust script narration revision this render is bound to (staleness detection). */
  narrationRevision: string;
  scriptVersion: string;
  // Durable object-store keys (source of truth for the served bytes).
  mp4Key: string | null;
  posterKey: string | null;
  captionsKey: string | null;
  // App-managed served routes (never a raw storage URL / filesystem path).
  mp4Url: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  captionsVerified: boolean;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

async function readMattTrust(): Promise<Record<string, MattTrustVideoRecord>> {
  const s = (await getSettings()) as any;
  return (s.voice?.mattTrustVideos ?? {}) as Record<string, MattTrustVideoRecord>;
}

async function mutateMattTrust(fn: (m: Record<string, MattTrustVideoRecord>) => void): Promise<void> {
  const s = (await getSettings()) as any;
  const voice = (s.voice ?? {}) as any;
  const m = { ...(voice.mattTrustVideos ?? {}) } as Record<string, MattTrustVideoRecord>;
  fn(m);
  await updateSettings({ voice: { ...voice, mattTrustVideos: m } } as any);
}

/** The Matt trust video for a scope, or null when one has not been built yet. */
export async function getMattTrustVideo(scope: TrustVideoScope): Promise<MattTrustVideoRecord | null> {
  return (await readMattTrust())[scope] ?? null;
}

export async function listMattTrustVideos(): Promise<MattTrustVideoRecord[]> {
  return Object.values(await readMattTrust());
}

/** The set of scopes that already have a Matt trust video — feeds the coherence resolver. */
export async function mattTrustScopeSet(): Promise<Set<TrustVideoScope>> {
  const recs = await listMattTrustVideos();
  return new Set(recs.filter((r) => !!r.mp4Key).map((r) => r.scope));
}

export async function setMattTrustVideo(rec: MattTrustVideoRecord, actor: string): Promise<void> {
  await mutateMattTrust((m) => {
    m[rec.scope] = rec;
  });
  await appendAudit({ action: "voice.matt_trust_video_set", actor, targetType: "trust_video", targetId: rec.scope, meta: { voiceoverId: rec.voiceoverId, durationSeconds: rec.durationSeconds }, ip: null });
}

/** App-managed served routes for a scope's Matt trust video (public evergreen content). */
export function mattTrustServedPaths(scope: TrustVideoScope): { mp4Url: string; posterUrl: string; captionsUrl: string } {
  const base = `/api/quick-fix/trust-video/${encodeURIComponent(scope)}`;
  return { mp4Url: base, posterUrl: `${base}/poster`, captionsUrl: `${base}/captions` };
}
