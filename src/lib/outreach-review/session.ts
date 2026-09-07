// ─────────────────────────────────────────────────────────────────────────────
// NARRATION SPRINT SESSION (mandate 28). A pure, deterministic state machine for a back-to-back narration
// sprint: ordered lead ids, current position, and per-lead disposition (completed / skipped / rejected /
// needs-attention). Skip is SESSION-LOCAL (moves the lead to the end; never a lead disposition). The session
// survives refresh/exit/deploy because it is a serializable value persisted by the caller and resumed by id.
// ─────────────────────────────────────────────────────────────────────────────

export interface SprintSession {
  id: string;
  operator: string;
  createdAt: string;
  batchSize: number | "all";
  order: string[];               // ordered lead ids (skip appends to the end)
  position: number;              // index into `order` of the CURRENT lead
  completed: string[];
  skipped: string[];             // session-local; still narration-ready
  rejected: string[];            // canonical rejection applied elsewhere
  needsAttention: string[];      // evidence problem reported
  exitedAt: string | null;
  resumedAt: string | null;
}

export interface SprintProgress { completed: number; skipped: number; rejected: number; needsAttention: number; remaining: number; position: number; total: number }

export function createSprintSession(args: { id: string; operator: string; order: string[]; batchSize: number | "all"; now: string }): SprintSession {
  const size = args.batchSize === "all" ? args.order.length : Math.min(args.batchSize, args.order.length);
  return {
    id: args.id, operator: args.operator, createdAt: args.now, batchSize: args.batchSize,
    order: args.order.slice(0, size), position: 0,
    completed: [], skipped: [], rejected: [], needsAttention: [], exitedAt: null, resumedAt: null,
  };
}

export function currentLead(s: SprintSession): string | null {
  return s.position >= 0 && s.position < s.order.length ? s.order[s.position] : null;
}

/** Move to the next not-yet-disposed lead. Returns a NEW session (immutable). */
export function advance(s: SprintSession): SprintSession {
  let p = s.position + 1;
  const done = new Set([...s.completed, ...s.rejected, ...s.needsAttention]);
  while (p < s.order.length && done.has(s.order[p])) p++;
  return { ...s, position: p };
}

const withCurrentAppended = (s: SprintSession, bucket: "completed" | "rejected" | "needsAttention"): SprintSession => {
  const lead = currentLead(s);
  if (!lead) return s;
  return advance({ ...s, [bucket]: [...s[bucket], lead] } as SprintSession);
};

/** Complete the current lead (audio uploaded + render queued elsewhere) and auto-advance. */
export function markComplete(s: SprintSession): SprintSession { return withCurrentAppended(s, "completed"); }
/** Canonical reject applied elsewhere; remove from sprint + advance. */
export function markRejected(s: SprintSession): SprintSession { return withCurrentAppended(s, "rejected"); }
/** Evidence problem → out of READY_FOR_NARRATION + advance. */
export function markNeedsAttention(s: SprintSession): SprintSession { return withCurrentAppended(s, "needsAttention"); }

/** Skip is SESSION-LOCAL: move the current lead to the END of the order (still narration-ready) and advance. */
export function skipForNow(s: SprintSession): SprintSession {
  const lead = currentLead(s);
  if (!lead) return s;
  const rest = s.order.slice(0, s.position).concat(s.order.slice(s.position + 1));
  const order = [...rest, lead]; // moved to end
  const skipped = s.skipped.includes(lead) ? s.skipped : [...s.skipped, lead];
  // position stays (now points at what was the next lead), unless we were at the end
  const position = Math.min(s.position, order.length - 1);
  return { ...s, order, skipped, position };
}

/** Resume by id: a lead that is no longer eligible is skipped truthfully with a reason. */
export function resume(s: SprintSession, opts: { now: string; stillEligible: (leadId: string) => boolean }): { session: SprintSession; skippedIneligible: string[] } {
  let session = { ...s, resumedAt: opts.now, exitedAt: null };
  const skippedIneligible: string[] = [];
  // advance past any leading disposed/ineligible leads at the current position
  const done = new Set([...session.completed, ...session.rejected, ...session.needsAttention]);
  let p = session.position;
  while (p < session.order.length) {
    const lead = session.order[p];
    if (done.has(lead)) { p++; continue; }
    if (!opts.stillEligible(lead)) { skippedIneligible.push(lead); p++; continue; }
    break;
  }
  session.position = p;
  return { session, skippedIneligible };
}

export function exitSprint(s: SprintSession, now: string): SprintSession { return { ...s, exitedAt: now }; }

export function progress(s: SprintSession): SprintProgress {
  // Disposed = completed ∪ rejected ∪ needs-attention. Skipped leads are NOT disposed (still remaining).
  const disposed = new Set([...s.completed, ...s.rejected, ...s.needsAttention]);
  const remaining = s.order.filter((l) => !disposed.has(l)).length;
  return {
    completed: s.completed.length, skipped: s.skipped.length, rejected: s.rejected.length,
    needsAttention: s.needsAttention.length, remaining, position: s.position, total: s.order.length,
  };
}

/** Ranking for "highest-scoring oldest-ready first" (mandate 28): score → growth → freshness → recipient → oldest. */
export interface SprintRankable { leadId: string; score: number; growth: number; evidenceFreshnessTs: number; recipientConfidence: number; readySinceTs: number }
export function orderForSprint(items: SprintRankable[]): string[] {
  return [...items].sort((a, b) =>
    b.score - a.score ||
    b.growth - a.growth ||
    b.evidenceFreshnessTs - a.evidenceFreshnessTs ||
    b.recipientConfidence - a.recipientConfidence ||
    a.readySinceTs - b.readySinceTs, // oldest-ready first
  ).map((x) => x.leadId);
}
