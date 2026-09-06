// ─────────────────────────────────────────────────────────────────────────────
// SERVER ASSEMBLY for the Content Studio two-workspace UI (mandate 25 §B3–B5). Turns the studio snapshot
// (piece + jobs + provenance + posted marker) plus the canonical company snapshot (per-lead lifecycle state
// + finding) into WorkspaceVideo[] for splitWorkspaces(). Proposal grouping is driven by the AUTHORITATIVE
// prospect lifecycle state; content grouping by the content render lifecycle. Deterministic + pure over its
// inputs (the caller injects the two snapshots), so it is unit-testable without I/O.
// ─────────────────────────────────────────────────────────────────────────────
import type { WorkspaceVideo, VideoRenderStatus, ProspectStateLike } from "./video-workspace";
import { splitWorkspaces } from "./video-workspace";

export interface SnapshotItemLike {
  piece: { id: string; businessId?: string | null; workflow?: "social" | "prospect" | null; title?: string | null; businessName?: string | null; narration?: string[]; revision?: number | null };
  jobs: Array<{ status: string; createdAt?: string }>;
  provenance?: { approved?: boolean; approvalStale?: boolean } | null;
  postedAt?: string | null;
}

// Per-lead canonical lifecycle facts, projected from CompanySnapshot (leadId → {state, finding}).
export interface LeadLifecycle { state: ProspectStateLike; finding: string | null; packageVersion?: number | null }

const FOCUS_TO_STATE: Record<string, ProspectStateLike> = {
  "needs-voiceover": "NEEDS_VOICEOVER", generating: "PREPARING_AUTOMATICALLY", rendering: "RENDERING",
  "needs-attention": "NEEDS_ATTENTION", "ready-to-schedule": "READY_TO_APPROVE", scheduled: "SCHEDULED", sent: "SENT",
};
/** Map a FocusRow-style state string to the canonical ProspectStateLike used for grouping. */
export function focusStateToProspect(s: string): ProspectStateLike | null { return FOCUS_TO_STATE[s] ?? null; }

function renderStatusOf(item: SnapshotItemLike): VideoRenderStatus {
  if (item.postedAt) return "posted";
  const jobs = [...(item.jobs ?? [])].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const active = jobs.find((j) => j.status === "queued" || j.status === "rendering");
  if (active) return active.status === "queued" ? "queued" : "rendering";
  const last = jobs[jobs.length - 1];
  if (last?.status === "ready") return "ready";
  if (last?.status === "failed") return "failed";
  return "needs-narration";
}

const leadIdOfPiece = (id: string, businessId?: string | null): string | null =>
  businessId ?? (id.startsWith("client-") ? id.slice("client-".length) : null);

/** Assemble WorkspaceVideo[] from the two snapshots. `byLead` supplies canonical lifecycle for proposals. */
export function assembleWorkspaceVideos(items: SnapshotItemLike[], byLead: Record<string, LeadLifecycle>): WorkspaceVideo[] {
  return items.map((item) => {
    const p = item.piece;
    const leadId = leadIdOfPiece(p.id, p.businessId);
    const lc = leadId ? byLead[leadId] : undefined;
    const prospectState = lc?.state ?? null;
    const frozen = prospectState === "SCHEDULED" || prospectState === "SENT";
    return {
      id: p.id, businessId: p.businessId ?? null, workflow: p.workflow ?? null,
      title: p.title ?? p.id, businessName: p.businessName ?? p.title ?? null,
      narration: (p.narration ?? []).join(" "),
      evidenceSummary: lc?.finding ?? null,
      findings: lc?.finding ? [lc.finding] : [],
      hasScreenshot: !!lc?.finding, // a finding in the canonical snapshot implies verified evidence exists
      renderStatus: renderStatusOf(item),
      packageVersion: lc?.packageVersion ?? null,
      revision: p.revision ?? null,
      frozen,
      approved: !!item.provenance?.approved,
      approvalStale: !!item.provenance?.approvalStale,
      prospectState,
    } satisfies WorkspaceVideo;
  });
}

/** One-call assembly: snapshots → the split workspaces (proposal + content + unclassified). */
export function buildStudioWorkspaces(items: SnapshotItemLike[], byLead: Record<string, LeadLifecycle>) {
  return splitWorkspaces(assembleWorkspaceVideos(items, byLead));
}
