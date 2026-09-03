// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT-VIDEO PREPARATION ORCHESTRATOR — the missing upstream system. Converts already-qualified
// leads (stored evidence + SENDABLE review + public recipient) into PREPARED prospect-video pieces that
// await ONLY the operator's voiceover. It composes the existing, tested building blocks — it invents no
// evidence and weakens no gate:
//   buildQuickReview → (SENDABLE only) → buildBusinessTemplate+saveTemplate (client-<leadId> piece with
//   evidence-bound 70–110w narration) → enqueue SHA-verified screenshot → approveAndFreezeQuickReview
//   (frozen PDF) → ensureDraftPackage (incomplete draft "awaiting voiceover").
// Idempotent: buildBusinessTemplate respects owner-edits + bumps revision; freeze is idempotent; the
// screenshot job de-dupes; the draft package de-dupes on review version. Frozen/scheduled/sent stay
// immutable. Never sends, never contacts a prospect, never touches Field Notes.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, getLead, getBusinessIntelligence } from "../repo";
import { listScheduledBindings } from "../outreach/scheduled-batch";
import { isInternalLead } from "../operators/assignment";
import { validEmail } from "../acquisition/compliance";
import { buildQuickReview, cachedBrand } from "../outreach/quick-review";
import { quickReviewApproved } from "../outreach/review-approval";
import { approveAndFreezeQuickReview, resolveFrozenReviewForSend } from "../outreach/quick-review-freeze";
import { ensureDraftPackage } from "../outreach/prospect-package-store";
import { draftEmailCopy } from "../outreach/prospect-package-store";
import { buildBusinessTemplate, composeReviewNarration, type ScreenshotByFinding } from "./client-video";
import { saveTemplate, loadTemplate } from "./store";
import { createScreenshotJob, latestReadyShot, captureTargetFor } from "./screenshot-jobs";
import { normalizeCaptureUrl } from "./ssrf-guard";
import type { BusinessProfile } from "../business-intelligence/types";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture", "Closed Won", "Closed Lost", "Client"]);

export interface PrepareResult {
  ranAt: string;
  considered: number;
  prepared: Array<{ leadId: string; business: string; pieceId: string; state: string }>;
  skipped: Record<string, number>;
  errors: Array<{ leadId: string; reason: string }>;
}

function skip(s: PrepareResult, reason: string) { s.skipped[reason] = (s.skipped[reason] ?? 0) + 1; }

/** Prepare up to `max` qualified candidates into voiceover-ready prospect pieces. `leadIds` restricts the
 *  set (used by the canary); otherwise it scans the whole book. Bounded + idempotent. */
export async function prepareProspectVideoCandidates(opts: { now?: Date; max?: number; leadIds?: string[]; includeInternal?: boolean } = {}): Promise<PrepareResult> {
  const now = opts.now ?? new Date();
  const max = opts.max ?? 20;
  const s: PrepareResult = { ranAt: now.toISOString(), considered: 0, prepared: [], skipped: {}, errors: [] };
  const leads = opts.leadIds ? (await Promise.all(opts.leadIds.map((id) => getLead(id)))).filter((l): l is NonNullable<typeof l> => !!l) : await listLeads();
  // Protect committed sends: never re-prepare a lead that already has a SCHEDULED binding (its email-only
  // package is committed to send). Prior-contacted leads may still become video prospects (a follow-up can
  // carry a video), so they are NOT excluded. Skipped only when this is an explicit leadIds run (canary).
  const bindings = opts.leadIds ? [] : await listScheduledBindings();
  const committed = new Set<string>(bindings.map((b) => b.leadId));

  for (const lead of leads) {
    if (s.prepared.length >= max) break;
    // Never prepare a real prospect that's terminal/contacted-out; canary/test leads only when asked.
    const isCanary = /canary/i.test(lead.businessName) || (lead as { test_only?: boolean }).test_only === true;
    if (!opts.includeInternal && (isInternalLead(lead) || lead.source === "internal-test" || isCanary)) { skip(s, "internal/test"); continue; }
    if (TERMINAL.has(lead.pipelineStage)) { skip(s, "terminal-stage"); continue; }
    if (committed.has(lead.id)) { skip(s, "already-scheduled-or-sent"); continue; }
    if (!lead.website) { skip(s, "no-website"); continue; }
    if (!validEmail(lead.publicEmail)) { skip(s, "no-recipient"); continue; }

    const bi = await getBusinessIntelligence(lead.id);
    const profile = ((bi?.profile as { businessProfile?: BusinessProfile } | undefined)?.businessProfile ?? null);
    if (!profile) { skip(s, "no-stored-evidence"); continue; }

    const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(lead.id) });
    if (review.status !== "SENDABLE") { skip(s, review.status === "NEEDS_REVIEW" ? "needs-operator-review" : "insufficient-evidence"); continue; }
    if (!review.findings?.length) { skip(s, "no-finding"); continue; }
    s.considered += 1;

    try {
      const templateId = `client-${lead.id}`.replace(/[^0-9a-z_-]/gi, "-").slice(0, 40);
      const existing = await loadTemplate(templateId);
      // 1) Client piece (evidence-bound narration + storyboard). Respect owner-edits.
      if (!(existing?.ownerEdited)) {
        const screenshots: ScreenshotByFinding = {};
        const shot = await latestReadyShot(lead.id, "mobile").catch(() => null);
        if (shot?.outputKey && review.findings[0]) screenshots[review.findings[0].id] = shot.outputKey;
        const composedNarration = composeReviewNarration(review, lead.industry ?? null);
        const { template } = buildBusinessTemplate(review, { leadId: lead.id, allowOverride: false, screenshots, composedNarration });
        if (!template) { skip(s, "evidence-gate-blocked-template"); continue; }
        template.revision = (existing?.revision ?? 0) + 1;
        template.ownerEdited = false;
        (template as { workflow?: "social" | "prospect" }).workflow = "prospect";
        await saveTemplate(template);
      }
      // 2) SHA-verified website screenshot (idempotent; in-flight capture reused).
      const norm = normalizeCaptureUrl(lead.website);
      if (norm.ok) { try { await createScreenshotJob({ businessId: lead.id, pieceId: templateId, requestedUrl: captureTargetFor(norm.url!.href), viewport: "mobile" }); } catch { /* best-effort */ } }
      // 3) Freeze the Quick Review PDF (idempotent; only when SENDABLE gates pass — enforced inside).
      const froze = await approveAndFreezeQuickReview({ leadId: lead.id });
      if (!froze.ok) { skip(s, "freeze-blocked"); continue; }
      const frozen = await resolveFrozenReviewForSend(lead.id);
      if (!frozen.ok) { skip(s, "frozen-review-unresolved"); continue; }
      // 4) Incomplete draft prospect package (awaiting only voiceover/video). Idempotent.
      const subject = `Quick Review — ${lead.businessName}`;
      const copy = draftEmailCopy(lead.businessName);
      const draft = await ensureDraftPackage(lead.id, { subject, bodyHtml: copy.bodyHtml, bodyText: copy.bodyText });
      s.prepared.push({ leadId: lead.id, business: lead.businessName, pieceId: templateId, state: draft.state ?? "INCOMPLETE" });
    } catch (e) {
      s.errors.push({ leadId: lead.id, reason: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }
  return s;
}
