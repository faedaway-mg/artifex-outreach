// ─────────────────────────────────────────────────────────────────────────────
// Data integrity — the reliability audit, as a function.
//
// Verifies the persistence invariants the Founder OS depends on: no duplicate or
// orphaned records, no impossible states, and no lost provenance. Deterministic and
// side-effect-free — it reads the collections and reports. Used by the diagnostics
// endpoint and by tests, so "is the data sound?" always has an honest answer.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem, RoadmapProgressItem, OutcomeReviewItem, EngagementSnapshotItem } from "./types";
import { ROADMAP_STATUSES, OUTCOME_STATUSES, MEMORY_STATUSES } from "./types";

export interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheck[];
}

export interface IntegrityInput {
  leadIds: Set<string>;
  memory: RelationshipMemoryItem[];
  progress: RoadmapProgressItem[];
  reviews: OutcomeReviewItem[];
  snapshots: EngagementSnapshotItem[];
}

function dupIds<T extends { id: string }>(rows: T[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of rows) { if (seen.has(r.id)) dups.push(r.id); seen.add(r.id); }
  return dups;
}

export function checkIntegrity(input: IntegrityInput): IntegrityReport {
  const { leadIds, memory, progress, reviews, snapshots } = input;
  const checks: IntegrityCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // ── No duplicate ids ────────────────────────────────────────────────────────
  const allDups = [...dupIds(memory), ...dupIds(progress), ...dupIds(reviews), ...dupIds(snapshots)];
  add("No duplicate record ids", allDups.length === 0, allDups.length ? `Duplicates: ${allDups.join(", ")}` : "All ids unique across memory, journal, reviews, snapshots.");

  // ── No orphaned records (every leadId resolves) ──────────────────────────────
  const orphans = [
    ...memory.filter((m) => !leadIds.has(m.leadId)).map((m) => `memory ${m.id}`),
    ...progress.filter((p) => !leadIds.has(p.leadId)).map((p) => `journal ${p.id}`),
    ...reviews.filter((r) => !leadIds.has(r.leadId)).map((r) => `review ${r.id}`),
    ...snapshots.filter((s) => !leadIds.has(s.leadId)).map((s) => `snapshot ${s.id}`),
  ];
  add("No orphaned records", orphans.length === 0, orphans.length ? `Orphans: ${orphans.slice(0, 10).join(", ")}` : "Every record references an existing lead.");

  // ── One journal entry per (lead, recommendation) ─────────────────────────────
  const progKeys = new Map<string, number>();
  for (const p of progress) progKeys.set(`${p.leadId}|${p.recommendationId}`, (progKeys.get(`${p.leadId}|${p.recommendationId}`) ?? 0) + 1);
  const progDupes = [...progKeys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  add("One journal entry per recommendation", progDupes.length === 0, progDupes.length ? `Duplicated: ${progDupes.join(", ")}` : "No duplicated implementation-journal entries.");

  // ── One outcome review per (lead, recommendation) ────────────────────────────
  const revKeys = new Map<string, number>();
  for (const r of reviews) revKeys.set(`${r.leadId}|${r.recommendationId}`, (revKeys.get(`${r.leadId}|${r.recommendationId}`) ?? 0) + 1);
  const revDupes = [...revKeys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  add("One outcome review per recommendation", revDupes.length === 0, revDupes.length ? `Duplicated: ${revDupes.join(", ")}` : "No duplicated outcome reviews.");

  // ── No impossible states ─────────────────────────────────────────────────────
  const badStatus = [
    ...memory.filter((m) => !(MEMORY_STATUSES as readonly string[]).includes(m.status)).map((m) => `memory ${m.id}`),
    ...progress.filter((p) => !(ROADMAP_STATUSES as readonly string[]).includes(p.status)).map((p) => `journal ${p.id}`),
    ...reviews.filter((r) => !(OUTCOME_STATUSES as readonly string[]).includes(r.status)).map((r) => `review ${r.id}`),
  ];
  add("No impossible states", badStatus.length === 0, badStatus.length ? `Invalid status: ${badStatus.join(", ")}` : "Every status is within its known lifecycle.");

  // ── Provenance intact ────────────────────────────────────────────────────────
  const noProvenance = memory.filter((m) => !m.source).map((m) => m.id);
  const unparseable = snapshots.filter((s) => { try { JSON.parse(s.payload); return false; } catch { return true; } }).map((s) => s.id);
  add("Provenance intact", noProvenance.length === 0 && unparseable.length === 0,
    noProvenance.length || unparseable.length
      ? `Memory without source: ${noProvenance.length}; unreadable snapshots: ${unparseable.length}`
      : "Every memory carries a source; every snapshot payload is readable.");

  // ── Snapshots immutable-shaped (one per lead×rec×trigger) ────────────────────
  const snapKeys = new Map<string, number>();
  for (const s of snapshots) snapKeys.set(`${s.leadId}|${s.recommendationId}|${s.trigger}`, (snapKeys.get(`${s.leadId}|${s.recommendationId}|${s.trigger}`) ?? 0) + 1);
  const snapDupes = [...snapKeys.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  add("No duplicate baselines", snapDupes.length === 0, snapDupes.length ? `Duplicated: ${snapDupes.join(", ")}` : "At most one baseline per recommendation × trigger.");

  return { ok: checks.every((c) => c.ok), checks };
}
