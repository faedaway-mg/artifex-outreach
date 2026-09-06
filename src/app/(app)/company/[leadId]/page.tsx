import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { studioSnapshot } from "@/lib/content-studio/store";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";
import { allTasks, getLead } from "@/lib/repo";
import { pendingClientVideoCount } from "@/lib/content-studio/client-video-tasks";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";
import { readPosted } from "@/lib/content-studio/store";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { ApproveScheduleButton } from "@/components/queue/ApproveScheduleButton";

export const dynamic = "force-dynamic";

// Mandate II: the ONE operator-facing company screen — one company at a time. Legacy /leads/[id] links
// redirect here (middleware). It reuses the proven prospect-package piece UI (exact subject/body, PDF
// preview, narration + copy, upload/replace voiceover, package state) but is fed ONLY this company's
// prospect piece, so nothing else is visible. A Prev/Next rail walks the focus queue (voiceover → ready).
export default async function CompanyFocusPage({ params }: { params: { leadId: string } }) {
  const leadId = params.leadId;
  const pieceId = `client-${leadId}`;
  const [raw, tasks, posted, workerHealth, lead, snap] = await Promise.all([
    studioSnapshot(), allTasks(), readPosted(), getWorkerHealth(), getLead(leadId), buildCompanySnapshot(),
  ]);
  if (!lead) notFound();

  const match = raw.find((r) => r.piece.id === pieceId);
  const items: StudioItem[] = match
    ? [{
        piece: match.piece, postedAt: match.postedAt, provenance: match.provenance,
        caption: match.caption ? { text: match.caption.text, source: match.caption.source, edited: match.caption.edited, revisions: match.caption.revisions, updatedAt: match.caption.updatedAt } : null,
        uploads: match.uploads.map((u) => ({ name: u.name, bytes: u.bytes, durationSeconds: u.durationSeconds, uploadedAt: u.uploadedAt, kind: u.kind })),
        jobs: match.jobs.map(sanitizeJob),
      }]
    : [];
  const videosToCreate = pendingClientVideoCount(tasks, Object.keys(posted));

  // Prev/Next across the focus queue (needs-you first, then ready-to-schedule).
  const queue = snap.focusQueueIds;
  const idx = queue.indexOf(leadId);
  const prev = idx > 0 ? queue[idx - 1] : null;
  const next = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;
  const pos = idx >= 0 ? `${idx + 1} of ${queue.length}` : "";
  // Full Package "Approve & schedule" (mandate 20): shown when this company's package is READY_TO_APPROVE,
  // invoking the SAME canonical operation as the Ready-to-Approve card.
  const isReadyToApprove = snap.ready.some((r) => r.leadId === leadId);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Focused rail — company name, position, and Previous / Next (mandate II items 1 & 10). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/" aria-label="Close" className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        <div className="min-w-0 text-center">
          <div className="truncate text-sm font-semibold text-chalk-50">{lead.businessName}</div>
          {pos && <div className="text-[11px] text-chalk-500">{pos} in your queue</div>}
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={prev ? `/company/${prev}` : "#"} aria-disabled={!prev} className={`rounded-lg border border-white/10 p-2 ${prev ? "text-chalk-300 hover:text-chalk-100" : "pointer-events-none text-chalk-700"}`}><ChevronLeft size={16} /></Link>
          <Link href={next ? `/company/${next}` : "#"} aria-disabled={!next} className={`rounded-lg border border-white/10 p-2 ${next ? "text-chalk-300 hover:text-chalk-100" : "pointer-events-none text-chalk-700"}`}><ChevronRight size={16} /></Link>
        </div>
      </div>

      {/* READY_TO_APPROVE → the canonical Approve & schedule action, right at the top of the Full Package. */}
      {isReadyToApprove && (
        <div data-approve-fullpackage className="mb-4 rounded-2xl border border-teal-400/25 bg-teal-400/[0.05] p-4">
          <div className="text-[13px] font-medium text-chalk-100">Ready to approve — {lead.businessName}</div>
          <div className="mt-0.5 text-[12px] text-chalk-400">Approving freezes the exact package revision and schedules it for the next eligible window.</div>
          <ApproveScheduleButton leadId={leadId} className="mt-3" />
        </div>
      )}

      {match ? (
        <ContentStudioClient initialItems={items} deepLink={{ piece: pieceId, lead: leadId, section: "client", from: "today" }} videosToCreate={videosToCreate} workerHealth={workerHealth} advanceHref={next ? `/company/${next}` : "/"} />
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-[13px] text-chalk-400">
          No prospect video package exists for {lead.businessName} yet. The backend prepares one automatically once its evidence and recipient are resolved.
          <div className="mt-3"><Link href="/" className="btn-ghost text-xs">Back to Today</Link></div>
        </div>
      )}
    </div>
  );
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
