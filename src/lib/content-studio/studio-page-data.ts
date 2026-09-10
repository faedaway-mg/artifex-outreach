// Shared server-side data assembly for the Content Studio index (/content-studio) and the dedicated
// full-page company workspace (/content-studio/[purpose]/[leadId]) — mandate 26 §2. Building the two-tab
// split in ONE place keeps the index and the deep pages perfectly consistent (same grouping, same lifecycle
// state, same counts), so a card in the list and its dedicated page can never disagree.
import { studioSnapshot, readPosted } from "@/lib/content-studio/store";
import { allTasks } from "@/lib/repo";
import { pendingClientVideoCount } from "@/lib/content-studio/client-video-tasks";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { buildStudioWorkspaces, focusStateToProspect, type LeadLifecycle } from "@/lib/content-studio/studio-workspaces";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";
import type { StudioWorkspacesProp } from "@/components/content-studio/ContentStudioClient";
import { PROPOSAL_GROUP_ORDER, CONTENT_GROUP_ORDER, type ProposalCard, type ContentCard, type ProposalGroup, type ContentGroup } from "@/lib/content-studio/video-workspace";

export function sanitizeJob(j: any): SafeJob {
  return {
    id: j.id, pieceId: j.pieceId, inputVersion: j.inputVersion, status: j.status,
    progress: j.progress, stage: j.stage, mode: j.mode, audioKind: j.audioKind, audioLabel: j.audioLabel,
    outputRel: j.outputRel, thumbRel: j.thumbRel, error: j.error,
    attempt: j.attempt ?? 1,
    createdAt: j.createdAt, updatedAt: j.updatedAt ?? j.createdAt, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt,
  };
}

export interface StudioPageData {
  items: StudioItem[];
  videosToCreate: number;
  workerHealth: Awaited<ReturnType<typeof getWorkerHealth>>;
  split: ReturnType<typeof buildStudioWorkspaces>;
  workspaces: (activeType: "proposal" | "content") => StudioWorkspacesProp;
}

export async function loadStudioPageData(): Promise<StudioPageData> {
  const [raw, tasks, posted, workerHealth, company] = await Promise.all([
    studioSnapshot(), allTasks(), readPosted(), getWorkerHealth(), buildCompanySnapshot().catch(() => null),
  ]);
  const videosToCreate = pendingClientVideoCount(tasks, Object.keys(posted));
  const items: StudioItem[] = raw.map(({ piece, jobs, uploads, postedAt, caption, provenance }) => ({
    piece,
    postedAt,
    provenance,
    caption: caption ? { text: caption.text, source: caption.source, edited: caption.edited, revisions: caption.revisions, updatedAt: caption.updatedAt } : null,
    uploads: uploads.map((u) => ({ name: u.name, bytes: u.bytes, durationSeconds: u.durationSeconds, uploadedAt: u.uploadedAt, kind: u.kind })),
    jobs: jobs.map(sanitizeJob),
  }));

  const byLead: Record<string, LeadLifecycle> = {};
  if (company) {
    const addFocus = (rows: Array<{ leadId: string; state: string; finding: string | null }>) =>
      rows.forEach((r) => { byLead[r.leadId] = { state: focusStateToProspect(r.state) ?? "NEEDS_ATTENTION", finding: r.finding }; });
    addFocus(company.needsVoiceover); addFocus(company.rendering); addFocus(company.needsAttention); addFocus(company.ready);
    company.scheduled.forEach((r) => { byLead[r.leadId] = { state: "SCHEDULED", finding: byLead[r.leadId]?.finding ?? null }; });
    company.sentToday.forEach((r) => { byLead[r.leadId] = { state: "SENT", finding: byLead[r.leadId]?.finding ?? null }; });
  }
  const split = buildStudioWorkspaces(
    items.map((it) => ({ piece: it.piece as any, jobs: it.jobs, provenance: it.provenance as any, postedAt: it.postedAt })),
    byLead,
  );
  // §13-18 SOCIAL-ONLY: the NORMAL Content Studio feed is social/content ONLY (see contentOnlyWorkspaces).
  // The full `split` (including proposal groups) is still returned for Admin/Detail surfaces (the dedicated
  // per-company workspace + orderedCardIds); only the normal page-facing `workspaces()` is content-scoped.
  const workspaces = (_activeType: "proposal" | "content"): StudioWorkspacesProp => contentOnlyWorkspaces(split);
  return { items, videosToCreate, workerHealth, split, workspaces };
}

/** §13-18 SOCIAL-ONLY projection: the NORMAL Content Studio page shows CONTENT (social) videos ONLY.
 *  Proposal (prospect) cards and their count are NEVER surfaced here — the tab is forced to "content", the
 *  proposal count is 0, and the proposal groups are empty. Pure + deterministic over the split so the
 *  social-only contract is directly unit-testable without I/O. (The prospect split remains available to
 *  Admin/Detail surfaces via `split` / `orderedCardIds`.) */
export function contentOnlyWorkspaces(split: ReturnType<typeof buildStudioWorkspaces>): StudioWorkspacesProp {
  const emptyProposalGroups = () =>
    Object.fromEntries(PROPOSAL_GROUP_ORDER.map((g) => [g, [] as ProposalCard[]])) as Record<ProposalGroup, ProposalCard[]>;
  return {
    activeType: "content",
    counts: { proposal: 0, content: split.content.count, unclassified: split.unclassified.length },
    proposal: { groups: emptyProposalGroups() },
    content: { groups: split.content.groups },
  };
}

/** Ordered flat list of card ids within a purpose (for Prev/Next on the dedicated page), in canonical group
 *  order. Content cards and proposal cards both expose a stable `id` (the piece id). */
export function orderedCardIds(split: ReturnType<typeof buildStudioWorkspaces>, purpose: "proposal" | "content"): string[] {
  const out: string[] = [];
  if (purpose === "proposal") {
    const groups = split.proposal.groups as Record<ProposalGroup, ProposalCard[]>;
    for (const key of PROPOSAL_GROUP_ORDER) for (const c of groups[key] ?? []) out.push(c.id);
  } else {
    const groups = split.content.groups as Record<ContentGroup, ContentCard[]>;
    for (const key of CONTENT_GROUP_ORDER) for (const c of groups[key] ?? []) out.push(c.id);
  }
  return out;
}
