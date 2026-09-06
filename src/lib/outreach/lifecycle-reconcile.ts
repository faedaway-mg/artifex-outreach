// ─────────────────────────────────────────────────────────────────────────────
// WHOLE-BOOK PROSPECT LIFECYCLE RECONCILER (mandate 12 parts 4/5/6). Idempotent, never sends. Drives every
// prospect-video record to a coherent canonical state by completing the automation the operator started:
//   1) ASSEMBLE  — every verified render → READY_TO_APPROVE (binds video to the package). Reuses the proven
//      reconcileReadyProspectPackages(); this repairs "verified MP4 but package never bound it" (Motion).
//   2) SUPERSEDE — when a lead now has a video-bound package AND a stale email-only scheduled binding, the
//      completed video supersedes the email send: cancel the binding (operator decision). Never double-sends.
//   3) ENQUEUE   — a persisted voiceover upload with no render job gets exactly one render enqueued.
// Bounded + apply-gated (dryRun measures without mutating). Never contacts a prospect.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads } from "../repo";
import { listJobs, listTemplateIds, latestUpload } from "../content-studio/store";
import { latestReadyJob } from "../content-studio/job";
import { reconcileReadyProspectPackages, latestProspectPackage } from "./prospect-package-store";
import { listScheduledBindings, cancelScheduled } from "./scheduled-batch";
import { isRejectedLead } from "./rejection-core";

export interface LifecycleReconcileResult {
  ranAt: string;
  assembled: Array<{ leadId: string; state: string }>;
  assembleIdempotent: number;
  assembleFailed: Array<{ leadId: string; reason: string }>;
  superseded: Array<{ leadId: string; canceledBinding: boolean }>;
  rendersEnqueued: Array<{ leadId: string; jobId: string; deduped: boolean }>;
  scanned: number;
}

export async function reconcileProspectLifecycle(opts: { now?: Date; apply?: boolean } = {}): Promise<LifecycleReconcileResult> {
  const apply = opts.apply !== false; // default: apply
  const res: LifecycleReconcileResult = { ranAt: (opts.now ?? new Date()).toISOString(), assembled: [], assembleIdempotent: 0, assembleFailed: [], superseded: [], rendersEnqueued: [], scanned: 0 };

  // 1) ASSEMBLE every verified render into its READY_TO_APPROVE package (idempotent).
  if (apply) {
    const r = await reconcileReadyProspectPackages();
    res.assembled = r.assembled; res.assembleIdempotent = r.idempotent; res.assembleFailed = r.failed; res.scanned = r.scanned;
  }

  const [leads, jobs, tidList, bindings] = await Promise.all([listLeads(), listJobs(), listTemplateIds().catch(() => [] as string[]), listScheduledBindings()]);
  const templateIds = new Set(tidList);
  const scheduledByLead = new Map(bindings.map((b) => [b.leadId, b.binding]));
  const jobPieces = new Set(jobs.map((j) => j.pieceId));
  // Rejected companies (mandate 21) are terminal — the reconciler never reactivates them (no assemble, no
  // supersede bookkeeping, no render enqueue). ASSEMBLE above is already gated inside autoAssembleFromRender.
  const rejected = new Set(leads.filter((l) => isRejectedLead(l)).map((l) => l.id));

  // 2) SUPERSEDE — a lead with a video-bound package AND a scheduled email binding: cancel the binding.
  for (const [leadId] of scheduledByLead) {
    if (rejected.has(leadId)) continue;
    const pkg = await latestProspectPackage(leadId).catch(() => null);
    const hasVideoPackage = !!pkg?.video && (pkg.state === "READY_TO_APPROVE" || pkg.state === "FROZEN");
    if (!hasVideoPackage) continue;
    if (apply) { const ok = await cancelScheduled(leadId).catch(() => false); res.superseded.push({ leadId, canceledBinding: ok }); }
    else res.superseded.push({ leadId, canceledBinding: false });
  }

  // 3) ENQUEUE — a persisted upload with NO render job at all gets exactly one render (deduped downstream).
  const clientPieces = new Set<string>([...templateIds].filter((t) => t.startsWith("client-")));
  for (const p of jobPieces) if (p.startsWith("client-")) clientPieces.add(p);
  const { createRenderJob } = apply ? await import("../content-studio/runner") : { createRenderJob: null as any };
  for (const pieceId of clientPieces) {
    const leadId = pieceId.slice("client-".length);
    if (rejected.has(leadId)) continue; // never enqueue a render for a rejected company (mandate 21)
    const up = await latestUpload(pieceId).catch(() => null);
    if (!up) continue;
    const ready = latestReadyJob(jobs, pieceId);
    const active = jobs.some((j) => j.pieceId === pieceId && (j.status === "queued" || j.status === "rendering"));
    if (ready?.outputKey || active) continue; // already rendered or rendering
    if (apply && createRenderJob) {
      try { const { job, deduped } = await createRenderJob(pieceId, { useUpload: true }); res.rendersEnqueued.push({ leadId, jobId: job.id, deduped }); }
      catch { /* best-effort */ }
    } else res.rendersEnqueued.push({ leadId, jobId: "(dry)", deduped: false });
  }

  return res;
}
