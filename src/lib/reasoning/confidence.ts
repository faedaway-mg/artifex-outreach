// ─────────────────────────────────────────────────────────────────────────────
// The confidence engine — measured, never invented.
//
// Confidence in any conclusion comes from the evidence beneath it, per the spec:
//   • how many memories support it        • how recent they are
//   • whether they've been verified        • whether they agree
//   • whether the operator confirmed them
// The score is transparent: every point is explained by a factor the operator can
// read. A single unverified observation can never reach "High" — we treat it as a
// lead, not a fact.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem, MemoryConfidence } from "../types";
import type { ConfidenceRead, ConfidenceFactor } from "./types";

const RANK: Record<MemoryConfidence, number> = { High: 3, Medium: 2, Low: 1 };
const DAY = 86_400_000;

/** Active = still standing. Superseded / Resolved memories no longer support a claim. */
export function isActive(m: RelationshipMemoryItem): boolean {
  return m.status !== "Superseded" && m.status !== "Resolved";
}

function updatedMs(m: RelationshipMemoryItem): number {
  return Date.parse(m.updatedAt || m.createdAt) || 0;
}

/**
 * Score the confidence of a claim supported by `memories`, as of `now` (ms).
 * `now` is passed in so the result is deterministic and testable.
 */
export function scoreConfidence(memories: RelationshipMemoryItem[], now: number): ConfidenceRead {
  const active = memories.filter(isActive);
  const factors: ConfidenceFactor[] = [];

  if (active.length === 0) {
    return { label: "Low", score: 0, factors: [{ label: "No standing evidence", detail: "Nothing supports this yet." }] };
  }

  let score = 0;

  // ── Count — more independent observations, more weight (capped) ─────────────
  score += Math.min(40, active.length * 16);
  factors.push({
    label: `${active.length} supporting ${active.length === 1 ? "memory" : "memories"}`,
    detail:
      active.length >= 3 ? "Several observations point the same way."
      : active.length === 2 ? "Two observations agree."
      : "A single observation — treat it as a lead, not a fact.",
  });

  // ── Verification ────────────────────────────────────────────────────────────
  const verified = active.filter((m) => m.status === "Verified").length;
  score += Math.round((verified / active.length) * 25);
  factors.push({
    label: verified > 0 ? `${verified} verified` : "None verified yet",
    detail:
      verified === active.length ? "Every supporting memory has been confirmed."
      : verified > 0 ? "Some supporting memories are confirmed; others are still proposed."
      : "All supporting memories are still proposed — awaiting confirmation.",
  });

  // ── Operator confirmation ───────────────────────────────────────────────────
  const confirmed = active.some((m) => m.source === "Manual Confirmation" || m.status === "Verified");
  if (confirmed) {
    score += 10;
    factors.push({ label: "Operator-confirmed", detail: "You've personally confirmed at least one supporting memory." });
  }

  // ── Agreement — average of each memory's own confidence ─────────────────────
  const avg = active.reduce((a, m) => a + RANK[m.confidence], 0) / active.length;
  score += Math.round((avg / 3) * 15);
  factors.push({
    label: `Source confidence ${avg >= 2.5 ? "high" : avg >= 1.75 ? "medium" : "low"}`,
    detail: "How sure each supporting memory is on its own.",
  });

  // ── Recency ─────────────────────────────────────────────────────────────────
  const newest = Math.max(...active.map(updatedMs));
  const days = newest ? Math.floor((now - newest) / DAY) : 999;
  if (days <= 30) {
    score += 10;
    factors.push({ label: "Recent", detail: "Learned within the last month." });
  } else if (days <= 120) {
    score += 5;
    factors.push({ label: "Fairly recent", detail: `Last updated about ${Math.max(1, Math.round(days / 30))} months ago.` });
  } else {
    factors.push({ label: "Ageing", detail: "Not confirmed in a while — worth revisiting." });
  }

  score = Math.max(0, Math.min(100, score));
  // Humility guard: one lone observation is never more than "Medium".
  let label: MemoryConfidence = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  if (active.length === 1 && label === "High") label = "Medium";

  return { label, score, factors };
}
