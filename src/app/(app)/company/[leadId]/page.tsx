import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { studioSnapshot } from "@/lib/content-studio/store";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";
import type { StudioItem, SafeJob } from "@/components/content-studio/types";
import { allTasks, getLead } from "@/lib/repo";
import { pendingClientVideoCount } from "@/lib/content-studio/client-video-tasks";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";
import { readPosted } from "@/lib/content-studio/store";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { resolveScheduledDetail } from "@/lib/outreach/scheduled-detail";
import { resolveCurrentVideo } from "@/lib/outreach/prospect-package-store";
import { ScheduledPackageCard } from "@/components/queue/ScheduledPackageCard";
import { OperatorVideoPreview } from "@/components/content-studio/OperatorVideoPreview";
import { ApproveScheduleButton } from "@/components/queue/ApproveScheduleButton";
import { RejectControl } from "@/components/queue/RejectControl";

export const dynamic = "force-dynamic";

// The operator queue a company was opened FROM, so Prev/Next walk the correct ordering and Back/Close
// return to the right list (mandate 22). Falls back to the focus queue when no context is supplied.
type QueueCtx = "scheduled" | "ready" | "attention" | "voiceover" | "rendering" | "today";
const CTX_ROUTE: Record<QueueCtx, string> = {
  scheduled: "/queue/scheduled", ready: "/queue/ready", attention: "/queue/attention",
  voiceover: "/queue/voiceover", rendering: "/queue/rendering", today: "/",
};

// Mandate II: the ONE operator-facing company screen — one company at a time. Legacy /leads/[id] links
// redirect here (middleware). It reuses the proven prospect-package piece UI (exact subject/body, PDF
// preview, narration + copy, upload/replace voiceover, package state) but is fed ONLY this company's
// prospect piece, so nothing else is visible. A Prev/Next rail walks the focus queue (voiceover → ready).
export default async function CompanyFocusPage({ params, searchParams }: { params: { leadId: string }; searchParams?: { from?: string } }) {
  const leadId = params.leadId;
  const pieceId = `client-${leadId}`;
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const baseUrl = host ? `${proto}://${host}` : (process.env.APP_BASE_URL ?? "");
  const [raw, tasks, posted, workerHealth, lead, snap, scheduledDetail, currentVideo] = await Promise.all([
    studioSnapshot(), allTasks(), readPosted(), getWorkerHealth(), getLead(leadId), buildCompanySnapshot(), resolveScheduledDetail(leadId, baseUrl), resolveCurrentVideo(leadId, { baseUrl }),
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

  // Prev/Next across the CURRENT list context (mandate 22). The `from` query param names the queue the
  // company was opened from, so navigation matches that list's exact ordering — including Scheduled, which
  // the focus queue does not contain. We pick the ordering that actually holds this lead, preferring `from`.
  const orderings: Record<QueueCtx, string[]> = {
    scheduled: snap.scheduled.map((s) => s.leadId),
    ready: snap.ready.map((r) => r.leadId),
    attention: snap.needsAttention.map((r) => r.leadId),
    voiceover: snap.needsVoiceover.map((r) => r.leadId),
    rendering: snap.rendering.map((r) => r.leadId),
    today: snap.focusQueueIds,
  };
  const requested = (searchParams?.from as QueueCtx | undefined);
  const ctx: QueueCtx = (requested && orderings[requested]?.includes(leadId)) ? requested
    : (orderings.scheduled.includes(leadId) ? "scheduled"
    : (orderings.ready.includes(leadId) ? "ready"
    : (snap.focusQueueIds.includes(leadId) ? "today" : (requested ?? "today"))));
  const queue = orderings[ctx];
  const idx = queue.indexOf(leadId);
  const prev = idx > 0 ? queue[idx - 1] : null;
  const next = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;
  const pos = idx >= 0 ? `${idx + 1} of ${queue.length}` : "";
  const backHref = CTX_ROUTE[ctx];
  const withCtx = (id: string) => `/company/${id}?from=${ctx}`;
  // Full Package "Approve & schedule" (mandate 20): shown when this company's package is READY_TO_APPROVE,
  // invoking the SAME canonical operation as the Ready-to-Approve card.
  const isReadyToApprove = snap.ready.some((r) => r.leadId === leadId);
  // A previously-contacted company shows "Stop future outreach"; an unsent one shows "Reject" (mandate 21).
  const contacted = !!lead.lastContactAt || lead.pipelineStage === "Contacted" || lead.pipelineStage === "Follow-Up";

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Focused rail — company name, position, and Previous / Next (mandate 22: real ordering + edge
          disabling). Disabled controls are rendered as inert spans (no href="#"), so nothing looks
          clickable without a working target. Back/Close return to the list this company was opened from. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={backHref} aria-label="Close" data-nav-close className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        <div className="min-w-0 text-center">
          <div className="truncate text-sm font-semibold text-chalk-50">{lead.businessName}</div>
          {pos && <div className="text-[11px] text-chalk-500" data-nav-position>{pos} in {ctx === "today" ? "your queue" : ctx}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          {prev ? (
            <Link href={withCtx(prev)} aria-label="Previous company" data-nav-prev className="rounded-lg border border-white/10 p-2 text-chalk-300 hover:text-chalk-100"><ChevronLeft size={16} /></Link>
          ) : (
            <span aria-label="Previous company" aria-disabled="true" data-nav-prev data-nav-disabled className="rounded-lg border border-white/10 p-2 text-chalk-700 opacity-40 cursor-not-allowed"><ChevronLeft size={16} /></span>
          )}
          {next ? (
            <Link href={withCtx(next)} aria-label="Next company" data-nav-next className="rounded-lg border border-white/10 p-2 text-chalk-300 hover:text-chalk-100"><ChevronRight size={16} /></Link>
          ) : (
            <span aria-label="Next company" aria-disabled="true" data-nav-next data-nav-disabled className="rounded-lg border border-white/10 p-2 text-chalk-700 opacity-40 cursor-not-allowed"><ChevronRight size={16} /></span>
          )}
        </div>
      </div>

      {/* Package-aware Scheduled detail (mandate 22): show the EXACT frozen content this binding will send,
          resolved by package type — never a bogus "no video package" message for an email package. */}
      {scheduledDetail && (
        <div className="mb-4">
          <ScheduledPackageCard detail={scheduledDetail} />
        </div>
      )}

      {/* Full Package / pre-narration operator preview (mandate 23): preview the CANONICAL current video via
          the authenticated operator route before sending — and before narration when only a base render
          exists — never a recipient share. Only when not already shown by the scheduled card above. */}
      {!scheduledDetail && currentVideo.available && (
        <div data-fullpackage-video className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="text-[12.5px] text-chalk-400">
            {currentVideo.source === "frozen-package" ? "Approved video" : "Current video"} for {lead.businessName}
            {currentVideo.stale ? " · a newer render is available" : ""}
          </div>
          <OperatorVideoPreview leadId={leadId} available={currentVideo.available} reason={currentVideo.reason}
            revisionId={currentVideo.revisionId} source={currentVideo.source} triggerLabel="Preview video"
            note={currentVideo.source === "frozen-package" ? null : "narration/approval pending"} />
        </div>
      )}

      {/* READY_TO_APPROVE → the canonical Approve & schedule action, right at the top of the Full Package. */}
      {isReadyToApprove && (
        <div data-approve-fullpackage className="mb-4 rounded-2xl border border-teal-400/25 bg-teal-400/[0.05] p-4">
          <div className="text-[13px] font-medium text-chalk-100">Ready to approve — {lead.businessName}</div>
          <div className="mt-0.5 text-[12px] text-chalk-400">Approving freezes the exact package revision and schedules it for the next eligible window.</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ApproveScheduleButton leadId={leadId} />
            <RejectControl leadId={leadId} contacted={contacted} />
          </div>
        </div>
      )}

      {/* The shared Reject / Stop-future-outreach control is available on the Full Package view for EVERY
          state (mandate 21), so a poor-fit company can be removed regardless of where it sits in the pipeline. */}
      {!isReadyToApprove && (
        <div data-reject-fullpackage className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="text-[12.5px] text-chalk-400">Not a fit? Remove {lead.businessName} from the pipeline.</div>
          <RejectControl leadId={leadId} contacted={contacted} />
        </div>
      )}

      {match ? (
        <ContentStudioClient initialItems={items} deepLink={{ piece: pieceId, lead: leadId, section: "client", from: "today" }} videosToCreate={videosToCreate} workerHealth={workerHealth} advanceHref={next ? withCtx(next) : backHref} />
      ) : scheduledDetail ? (
        // A scheduled EMAIL_ONLY / EMAIL_PDF item has no Content Studio video piece — and that is CORRECT.
        // The package-aware card above already shows the exact outreach; no missing-video warning here.
        null
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-[13px] text-chalk-400">
          No prospect video package exists for {lead.businessName} yet. The backend prepares one automatically once its evidence and recipient are resolved.
          <div className="mt-3"><Link href={backHref} className="btn-ghost text-xs">Back</Link></div>
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
