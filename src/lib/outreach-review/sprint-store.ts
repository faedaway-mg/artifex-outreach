// ─────────────────────────────────────────────────────────────────────────────
// SPRINT SESSION PERSISTENCE (mandate 28). Stores SprintSession in the Settings jsonb — DB-backed in prod
// (survives refresh / logout / deploy) and in-memory in the isolated Breakbot tenant — with NO migration.
// The pure state machine lives in session.ts; this is the read/write + prune layer.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings } from "../repo";
import type { SprintSession } from "./session";

const MAX_KEPT = 40; // keep the most-recently-updated sessions; prune older ones

function touch(s: SprintSession): SprintSession { return s; }

export async function saveSprintSession(session: SprintSession, now: string): Promise<SprintSession> {
  const settings = await getSettings();
  const all: Record<string, SprintSession> = { ...(settings.sprintSessions ?? {}) };
  all[session.id] = touch({ ...session });
  // Prune: keep the newest MAX_KEPT by createdAt (completed sessions age out first as new ones arrive).
  const entries = Object.values(all).sort((a, b) => (b.resumedAt ?? b.createdAt).localeCompare(a.resumedAt ?? a.createdAt));
  const kept: Record<string, SprintSession> = {};
  for (const s of entries.slice(0, MAX_KEPT)) kept[s.id] = s;
  kept[session.id] = all[session.id]; // never prune the one we just saved
  await updateSettings({ sprintSessions: kept });
  return session;
}

export async function loadSprintSession(id: string): Promise<SprintSession | null> {
  const settings = await getSettings();
  return settings.sprintSessions?.[id] ?? null;
}

export async function listSprintSessions(operator?: string): Promise<SprintSession[]> {
  const settings = await getSettings();
  const all = Object.values(settings.sprintSessions ?? {});
  const filtered = operator ? all.filter((s) => s.operator === operator) : all;
  return filtered.sort((a, b) => (b.resumedAt ?? b.createdAt).localeCompare(a.resumedAt ?? a.createdAt));
}

/** The most recent still-open (not fully complete, not exited-and-complete) session for an operator. */
export async function activeSprintSession(operator?: string): Promise<SprintSession | null> {
  const list = await listSprintSessions(operator);
  return list.find((s) => s.order.some((l) => ![...s.completed, ...s.rejected, ...s.needsAttention].includes(l))) ?? null;
}
