// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — SOCIAL IDEA QUEUE STORE (mandate D). Persists the curated idea feed
// in the Settings JSONB singleton (contentStudio.ideas) — survives deploys, no migration.
// Read-mostly; idea creation spends nothing. A generated idea links to its Zero-Touch
// pieceId once the operator presses Generate, so the finished video shows on its own card.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings } from "../repo";
import type { SocialIdea } from "./social-ideas";
import { seedSocialIdeas } from "./social-ideas";

export type IdeaState = "IDEA" | "GENERATING" | "READY" | "FAILED" | "ARCHIVED";

export interface SocialIdeaRecord extends SocialIdea {
  id: string;
  state: IdeaState;
  /** The Zero-Touch render piece id once Generate has been pressed (links the finished video). */
  pieceId: string | null;
  createdAt: string;
  updatedAt: string;
}

function ideaId(key: string): string {
  return `idea_${key}`.replace(/[^a-z0-9_]/gi, "-").slice(0, 48);
}

async function readMap(): Promise<Record<string, SocialIdeaRecord>> {
  const s = (await getSettings()) as any;
  return (s.contentStudio?.ideas ?? {}) as Record<string, SocialIdeaRecord>;
}
async function writeMap(next: Record<string, SocialIdeaRecord>): Promise<void> {
  const s = (await getSettings()) as any;
  await updateSettings({ contentStudio: { ...(s.contentStudio ?? {}), ideas: next } } as any);
}

/** All idea records (any state), newest first. Seeds the initial curated feed once when empty. */
export async function getIdeaRecords(nowIso = new Date().toISOString()): Promise<SocialIdeaRecord[]> {
  let map = await readMap();
  if (Object.keys(map).length === 0) {
    map = {};
    for (const idea of seedSocialIdeas(4)) {
      const id = ideaId(idea.key);
      map[id] = { ...idea, id, state: "IDEA", pieceId: null, createdAt: nowIso, updatedAt: nowIso };
    }
    await writeMap(map);
  }
  return Object.values(map).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The active (non-archived) feed. */
export async function getActiveIdeas(nowIso = new Date().toISOString()): Promise<SocialIdeaRecord[]> {
  return (await getIdeaRecords(nowIso)).filter((r) => r.state !== "ARCHIVED");
}

/** Append newly-generated ideas (skips ids already present). Idea creation spends nothing. */
export async function addIdeas(ideas: SocialIdea[], nowIso = new Date().toISOString()): Promise<SocialIdeaRecord[]> {
  const map = await readMap();
  const added: SocialIdeaRecord[] = [];
  for (const idea of ideas) {
    const id = ideaId(idea.key);
    if (map[id]) continue;
    const rec: SocialIdeaRecord = { ...idea, id, state: "IDEA", pieceId: null, createdAt: nowIso, updatedAt: nowIso };
    map[id] = rec;
    added.push(rec);
  }
  if (added.length) await writeMap(map);
  return added;
}

export async function getIdea(id: string): Promise<SocialIdeaRecord | null> {
  return (await readMap())[id] ?? null;
}

/** Patch an idea's state / linked pieceId. */
export async function setIdea(id: string, patch: Partial<Pick<SocialIdeaRecord, "state" | "pieceId">>, nowIso = new Date().toISOString()): Promise<SocialIdeaRecord | null> {
  const map = await readMap();
  const rec = map[id];
  if (!rec) return null;
  map[id] = { ...rec, ...patch, updatedAt: nowIso };
  await writeMap(map);
  return map[id];
}

/** Archive (dismiss) an idea — used to reduce similar future suggestions. */
export async function archiveIdea(id: string, nowIso = new Date().toISOString()): Promise<SocialIdeaRecord | null> {
  return setIdea(id, { state: "ARCHIVED" }, nowIso);
}

/** Titles of active ideas — the dedup basis for new generation. */
export async function activeIdeaTitles(): Promise<{ keys: string[]; titles: string[] }> {
  const recs = await getIdeaRecords();
  const nonArchived = recs.filter((r) => r.state !== "ARCHIVED");
  return { keys: nonArchived.map((r) => r.key), titles: nonArchived.map((r) => r.title) };
}
