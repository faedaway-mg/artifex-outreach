// ─────────────────────────────────────────────────────────────────────────────
// Review Video Pilot board — the operational data API the (mobile-first) operator UI reads. It surfaces
// candidate leads by readiness (before jobs exist) and the live job board + summary counts (after). Pure
// of side effects; it only reads the store. The write actions (prepare/import/approve/retry) live in
// batch.ts + queue.ts and are what the UI's buttons call. This module keeps the READ surface in one place.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, getBusinessIntelligence, allReviewVideoJobs, getLead } from "../repo";
import type { BusinessProfile } from "../business-intelligence/types";
import { buildQuickReview, cachedBrand } from "../outreach/quick-review";
import { quickReviewApproved } from "../outreach/review-approval";
import { reviewVideoReadiness, rankCandidates, type ReviewVideoReadiness } from "./readiness";
import { nextAction } from "./job-state";
import type { ReviewVideoJob, ReviewVideoJobStatus } from "../types";

export interface VideoCandidate {
  leadId: string;
  businessName: string;
  readiness: ReviewVideoReadiness;
  /** True when a job already exists for this lead (so the UI shows status instead of Select). */
  hasJob: boolean;
}

/** List leads with a review, scored for video candidacy, strongest-first. The UI's candidate list.
 *  Skips leads without stored BI (no review yet). Read-only. */
export async function listReviewVideoCandidates(): Promise<VideoCandidate[]> {
  const leads = await listLeads();
  const jobs = await allReviewVideoJobs();
  const leadsWithJobs = new Set(jobs.filter((j) => j.status !== "FAILED" && j.status !== "DELIVERY_READY").map((j) => j.leadId));
  const out: VideoCandidate[] = [];
  for (const lead of leads) {
    const bi = await getBusinessIntelligence(lead.id);
    const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
    if (!profile) continue;
    try {
      const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(lead.id) });
      out.push({ leadId: lead.id, businessName: lead.businessName, readiness: reviewVideoReadiness(review), hasJob: leadsWithJobs.has(lead.id) });
    } catch { /* skip a lead whose review can't be built */ }
  }
  return rankCandidates(out);
}

export interface BoardRow { jobId: string; leadId: string; businessName: string; status: ReviewVideoJobStatus; nextAction: string; failure: ReviewVideoJob["failure"]; expectedAudioFilename: string; targetSeconds: number; finalDurationSeconds: number | null }

/** The live job board — one row per job with its next operator action. Read-only. */
export async function reviewVideoBoard(): Promise<{ rows: BoardRow[]; summary: Record<string, number> }> {
  const jobs = await allReviewVideoJobs();
  const rows: BoardRow[] = [];
  const summary: Record<string, number> = {};
  for (const j of jobs) {
    const lead = await getLead(j.leadId);
    rows.push({ jobId: j.id, leadId: j.leadId, businessName: lead?.businessName ?? j.leadId, status: j.status, nextAction: nextAction(j.status), failure: j.failure, expectedAudioFilename: j.expectedAudioFilename, targetSeconds: j.targetSeconds, finalDurationSeconds: j.finalDurationSeconds });
    summary[j.status] = (summary[j.status] ?? 0) + 1;
  }
  return { rows, summary };
}
