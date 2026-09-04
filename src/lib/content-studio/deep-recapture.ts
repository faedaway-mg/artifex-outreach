// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIC DEEP-RECAPTURE LOOP (mandate part 3). For companies that are ELIGIBLE (canonical selector) but
// stuck short of voiceover-ready because their stored evidence is thin, contradicted, or their narration
// fails the quality gate, this re-runs the REAL capture chain end-to-end:
//
//   canonical eligibility  → runWebsiteAnalysisAction (fresh interior-page crawl + DOM facts + screenshot
//   + regenerated BusinessIntelligence, with contradictions invalidated by the refreshed primaryCTA)
//   → prepareProspectVideoCandidates (recompose 85–130w narration, quality+contradiction+similarity gate,
//   frozen PDF, INCOMPLETE draft package) → VOICEOVER_READY.
//
// It composes ONLY already-tested building blocks — it invents no evidence, weakens no gate, and NEVER
// sends or contacts a prospect. Every attempt is bounded by the state machine (attempt#, backoff,
// max attempts) so "being reanalyzed" always resolves to a terminal outcome. Ineligible companies
// (contacted / scheduled / suppressed / already-assembled) are never touched.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, getLead, allEmailSends, getBusinessIntelligence, isSuppressed } from "../repo";
import { listScheduledBindings } from "../outreach/scheduled-batch";
import { isInternalLead } from "../operators/assignment";
import { validEmail } from "../acquisition/compliance";
import { PROSPECT_PACKAGE_ACTION } from "../outreach/prospect-package-store";
import type { FrozenProspectPackage, ProspectPackageState } from "../outreach/prospect-package";
import { reanalysisEligibility, type PrepEligibilityVerdict } from "../outreach/reanalysis-eligibility";
import {
  decideOutcome, recordRecaptureAttempt, readAllRecaptureStates, isRecaptureDue,
  type RecaptureOutcome, type RecaptureState,
} from "./recapture-state";
import { listTemplateIds, loadTemplate } from "./store";
import { gateNarration } from "./narration-quality-gate";
import { buildQuickReview, cachedBrand } from "../outreach/quick-review";
import { quickReviewApproved } from "../outreach/review-approval";
import { listAudit } from "../repo";
import type { BusinessProfile } from "../business-intelligence/types";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture", "Closed Won", "Closed Lost", "Client"]);

export interface RecaptureRunResult {
  ranAt: string;
  eligible: number;                 // leads eligible per the canonical selector
  due: number;                      // eligible AND due for an attempt this tick
  attempted: number;                // attempts actually made (bounded by max)
  outcomes: Array<{ leadId: string; business: string; outcome: RecaptureOutcome; reason: string; finding?: string | null; nextAttemptAt?: string | null; pagesCrawled?: number }>;
  skipped: Record<string, number>;  // why eligible-but-not-attempted (already-ready, not-due, cap, ...)
}

function bump(m: Record<string, number>, k: string) { m[k] = (m[k] ?? 0) + 1; }

/** Latest prospect package per lead from the append-only audit log (recent-first → first seen is latest). */
function latestPackagesByLead(audit: Array<{ action?: string; meta?: unknown }>): Map<string, FrozenProspectPackage> {
  const byLead = new Map<string, FrozenProspectPackage>();
  for (const a of audit) {
    if (a.action !== PROSPECT_PACKAGE_ACTION) continue;
    const pkg = (a.meta as { pkg?: FrozenProspectPackage } | undefined)?.pkg;
    if (pkg?.leadId && !byLead.has(pkg.leadId)) byLead.set(pkg.leadId, pkg);
  }
  return byLead;
}

/** Cheap pre-check: is this lead ALREADY voiceover-ready? (template + INCOMPLETE draft + passing gate).
 *  Lets us record terminal success without a needless re-crawl. Best-effort — any error ⇒ not-ready. */
async function alreadyVoiceoverReady(leadId: string, pkg: FrozenProspectPackage | undefined, templateIds: Set<string>): Promise<boolean> {
  try {
    const pieceId = `client-${leadId}`;
    if (!pkg || pkg.state !== "INCOMPLETE" || !templateIds.has(pieceId)) return false;
    const lead = await getLead(leadId);
    if (!lead) return false;
    const bi = await getBusinessIntelligence(leadId);
    const profile = ((bi?.profile as { businessProfile?: BusinessProfile } | undefined)?.businessProfile ?? null);
    const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });
    const t = await loadTemplate(pieceId).catch(() => null);
    const evidence = ((bi?.profile as unknown as { evidence?: Array<{ field?: string; value?: unknown }> })?.evidence) ?? [];
    const cta = evidence.find((e) => e.field === "primaryCTA")?.value;
    const verdict = gateNarration({
      narration: t?.narration ?? [],
      finding: { key: String(review.findings?.[0]?.id ?? ""), observation: review.findings?.[0]?.observation ?? null },
      domFacts: { primaryCta: cta != null ? String(cta) : null },
      businessName: lead.businessName, url: lead.website, reviewCount: lead.reviewCount ?? null,
    });
    return verdict.ok;
  } catch { return false; }
}

/**
 * Run one bounded deep-recapture cycle. `max` caps how many live crawls we perform this tick (network +
 * cost bound). `leadIds` restricts the candidate set (used by tests / a targeted operator run).
 */
export async function runDeepRecapture(opts: { now?: Date; max?: number; leadIds?: string[] } = {}): Promise<RecaptureRunResult> {
  const now = opts.now ?? new Date();
  const max = opts.max ?? 10;
  const res: RecaptureRunResult = { ranAt: now.toISOString(), eligible: 0, due: 0, attempted: 0, outcomes: [], skipped: {} };

  const [allLeads, emailSends, scheduledBindings, audit, templateIdList, recaptureStates] = await Promise.all([
    listLeads(), allEmailSends(), listScheduledBindings(), listAudit(5000), listTemplateIds().catch(() => [] as string[]), readAllRecaptureStates(),
  ]);
  const leads = opts.leadIds ? allLeads.filter((l) => opts.leadIds!.includes(l.id)) : allLeads;
  const contacted = new Set(emailSends.filter((e) => e.leadId).map((e) => e.leadId as string));
  const scheduled = new Set(scheduledBindings.map((b) => b.leadId));
  const templateIds = new Set(templateIdList);
  const pkgByLead = latestPackagesByLead(audit as Array<{ action?: string; meta?: unknown }>);

  // Lazy-imported to avoid a heavy import graph at module load (actions.ts pulls providers).
  const { runWebsiteAnalysisAction } = await import("../actions");
  const { prepareProspectVideoCandidates } = await import("./prepare-orchestrator");

  for (const lead of leads) {
    if (isInternalLead(lead) || lead.source === "internal-test") continue;
    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const verdict: PrepEligibilityVerdict = reanalysisEligibility({
      internal: false,
      pipelineStage: lead.pipelineStage,
      terminal: TERMINAL.has(lead.pipelineStage),
      contacted: contacted.has(lead.id),
      scheduled: scheduled.has(lead.id),
      suppressed,
      hasWebsite: !!lead.website,
      recipientValid: validEmail(lead.publicEmail),
      packageState: (pkgByLead.get(lead.id)?.state ?? null) as ProspectPackageState | null,
    });
    if (!verdict.eligible) continue; // not a recapture candidate (ineligible companies are never touched)
    res.eligible += 1;

    const state: RecaptureState | undefined = recaptureStates.get(lead.id);
    if (!isRecaptureDue(state, now)) { bump(res.skipped, state?.terminal ? `terminal:${state.lastOutcome}` : "not-due"); continue; }

    // Already voiceover-ready? Record terminal success (idempotent) without a needless re-crawl.
    if (await alreadyVoiceoverReady(lead.id, pkgByLead.get(lead.id), templateIds)) {
      const attempt = (state?.attempts ?? 0) + 1;
      await recordRecaptureAttempt({ leadId: lead.id, attempt, at: now.toISOString(), outcome: "VOICEOVER_READY", reason: "already-voiceover-ready", nextAttemptAt: null });
      res.outcomes.push({ leadId: lead.id, business: lead.businessName, outcome: "VOICEOVER_READY", reason: "already-voiceover-ready" });
      bump(res.skipped, "already-ready");
      continue;
    }

    res.due += 1;
    if (res.attempted >= max) { bump(res.skipped, "cap-reached"); continue; }
    res.attempted += 1;
    const attempt = (state?.attempts ?? 0) + 1;

    let succeeded = false, humanOnly = false, reason = "unknown", finding: string | null = null, pagesCrawled = 0;
    try {
      // 1) FRESH deep capture: re-crawl interior pages, refresh DOM facts + screenshot, regenerate BI (this
      //    invalidates a stale/contradicted finding by refreshing primaryCTA + the opportunity graph).
      await runWebsiteAnalysisAction(lead.id);
      const bi = await getBusinessIntelligence(lead.id);
      const pages = ((bi?.surfacePackage as { pages?: unknown[] } | null | undefined)?.pages) ?? [];
      pagesCrawled = Array.isArray(pages) ? pages.length : 0;

      // 2) Rebuild the full chain from the fresh evidence: recompose narration, run the quality gate,
      //    freeze the PDF, ensure the INCOMPLETE draft package. Only the SINGLE lead, idempotent.
      const pr = await prepareProspectVideoCandidates({ now, max: 1, leadIds: [lead.id] });
      const prepared = pr.prepared.find((p) => p.leadId === lead.id);
      if (prepared) {
        succeeded = true; reason = "voiceover-ready";
        const t = await loadTemplate(prepared.pieceId).catch(() => null);
        finding = t?.narration?.[0] ?? null;
      } else if (pr.errors.length) {
        humanOnly = true; reason = "error:" + pr.errors[0].reason.slice(0, 80);
      } else {
        reason = Object.keys(pr.skipped)[0] ?? "not-prepared";
      }
    } catch (e) {
      humanOnly = true; reason = "crash:" + String((e as Error)?.message ?? e).slice(0, 80);
    }

    const decision = decideOutcome({ attempt, succeeded, humanOnly, now });
    await recordRecaptureAttempt({ leadId: lead.id, attempt, at: now.toISOString(), outcome: decision.outcome, reason, nextAttemptAt: decision.nextAttemptAt, finding });
    res.outcomes.push({ leadId: lead.id, business: lead.businessName, outcome: decision.outcome, reason, finding, nextAttemptAt: decision.nextAttemptAt, pagesCrawled });
  }

  return res;
}
