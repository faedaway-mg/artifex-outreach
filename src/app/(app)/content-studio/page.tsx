import { studioSnapshot, readPosted } from "@/lib/content-studio/store";
import { ContentStudioClient, type StudioWorkspacesProp } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";
import { allTasks } from "@/lib/repo";
import { pendingClientVideoCount } from "@/lib/content-studio/client-video-tasks";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { buildStudioWorkspaces, focusStateToProspect, type LeadLifecycle } from "@/lib/content-studio/studio-workspaces";

export const dynamic = "force-dynamic";

// Server component: load the snapshot and hand the client ONLY public-safe fields (no absolute private
// filesystem paths for uploads or render outputs).
export default async function ContentStudioPage({ searchParams }: { searchParams?: { piece?: string; lead?: string; section?: string; from?: string; type?: string } }) {
  const [raw, tasks, posted, workerHealth, company] = await Promise.all([studioSnapshot(), allTasks(), readPosted(), getWorkerHealth(), buildCompanySnapshot().catch(() => null)]);
  // Canonical "videos to create" (section C) — SAME function Today uses, so the counts match.
  const videosToCreate = pendingClientVideoCount(tasks, Object.keys(posted));
  const items: StudioItem[] = raw.map(({ piece, jobs, uploads, postedAt, caption, provenance }) => ({
    piece,
    postedAt,
    provenance,
    caption: caption ? { text: caption.text, source: caption.source, edited: caption.edited, revisions: caption.revisions, updatedAt: caption.updatedAt } : null,
    uploads: uploads.map((u) => ({ name: u.name, bytes: u.bytes, durationSeconds: u.durationSeconds, uploadedAt: u.uploadedAt, kind: u.kind })),
    jobs: jobs.map(sanitizeJob),
  }));
  // Deep-link from Today (section F): ?lead=<id> maps to the stable project id client-<id>; ?piece=<id>
  // selects an exact piece; ?from=today renders a Back-to-Today control preserving Today's state.
  const deepLink = {
    piece: searchParams?.piece ?? null,
    lead: searchParams?.lead ?? null,
    section: searchParams?.section ?? null,
    from: searchParams?.from ?? null,
  };
  // Two-tab workspace split (mandate 25 §B3–B5). The canonical company snapshot supplies each proposal's
  // authoritative lifecycle state + finding; the studio snapshot supplies render/approval status.
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
  const activeType: "proposal" | "content" = searchParams?.type === "content" ? "content" : "proposal";
  const workspaces: StudioWorkspacesProp = {
    activeType,
    counts: { proposal: split.proposal.count, content: split.content.count, unclassified: split.unclassified.length },
    proposal: { groups: split.proposal.groups },
    content: { groups: split.content.groups },
  };

  return <ContentStudioClient initialItems={items} deepLink={deepLink} videosToCreate={videosToCreate} workerHealth={workerHealth} workspaces={workspaces} />;
}

function sanitizeJob(j: any): SafeJob {
  return {
    id: j.id, pieceId: j.pieceId, inputVersion: j.inputVersion, status: j.status,
    progress: j.progress, stage: j.stage, mode: j.mode, audioKind: j.audioKind, audioLabel: j.audioLabel,
    outputRel: j.outputRel, thumbRel: j.thumbRel, error: j.error,
    attempt: j.attempt ?? 1,
    createdAt: j.createdAt, updatedAt: j.updatedAt ?? j.createdAt, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt,
  };
}
