// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE MATERIALIZATION — COMPLETE PACKAGE + REPAIR ALL ELIGIBLE (Active Inventory
// Integrity mandate §4–§9, §34, §38).
//
// One action ("Complete Package") tells Acquisition OS: "bring this package to the
// highest valid state currently permitted by policy." The engine decides which cheap,
// deterministic dependencies are missing/stale and reconciles them — subject, scope
// copy, screenshots (queued), approval — WITHOUT spending paid media (personalized
// video / TTS stay behind #202 + the Voice Capacity policy, and are only ever queued,
// never generated inline here). "Repair All Eligible" runs the same over the whole
// active inventory: idempotent, bounded, cost-aware, auditable.
//
// The DECISION is a pure function (packageRepairPlan) so it is unit-testable; the thin
// executor performs the I/O by composing already-audited store primitives.
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import type { QuickFixOffer } from "./types";
import { buildCanonicalPackage } from "./canonical-package";
import { offerSubject } from "./offer-outreach";
import { classifyDefectFamily, SUBJECT_POLICY_VERSION } from "./subject-engine";
import { regeneratePlainScope, offerNeedsScopeRegeneration } from "./scope-regeneration";

export type Viewport = "mobile" | "desktop";

export interface RepairPlanInput {
  eligible: boolean;
  retired: boolean;
  hasFinding: boolean;
  scopeNeedsRegen: boolean;
  /** A specific subject is already persisted (selected or frozen). */
  subjectPersisted: boolean;
  /** The canonical subject is specific (not empty / "website note"). */
  subjectSpecific: boolean;
  approved: boolean;
  coherenceBlocks: boolean;
  screenshotsMissing: boolean;
  mobileRequired: boolean;
  mobilePresent: boolean;
  desktopPresent: boolean;
  websiteKnown: boolean;
}

export interface RepairPlan {
  /** Non-null ⇒ nothing to do (retired / conversation-only). */
  skip: string | null;
  regenScope: boolean;
  persistSubject: boolean;
  queueScreenshots: Viewport[];
  approve: boolean;
  /** The honest action is to retire, not to dress this up (§10/§14). */
  retireRecommended: boolean;
  actions: string[];
}

/**
 * Decide which cheap, deterministic repairs a package needs. PURE — no I/O. Never
 * proposes paid media (that is separated into the WAITING_FOR_PAID completeness lane).
 */
export function packageRepairPlan(input: RepairPlanInput): RepairPlan {
  if (input.retired) return { skip: "retired", regenScope: false, persistSubject: false, queueScreenshots: [], approve: false, retireRecommended: false, actions: [] };
  if (!input.eligible) return { skip: "conversation-only", regenScope: false, persistSubject: false, queueScreenshots: [], approve: false, retireRecommended: false, actions: [] };

  // No evidence-backed finding, or only a generic/immaterial one ⇒ recommend retire.
  const retireRecommended = !input.hasFinding || !input.subjectSpecific;

  const regenScope = input.scopeNeedsRegen;
  const persistSubject = input.subjectSpecific && !input.subjectPersisted;
  const queueScreenshots: Viewport[] = [];
  if (input.websiteKnown && input.screenshotsMissing) {
    if (!input.desktopPresent) queueScreenshots.push("desktop");
    if (input.mobileRequired && !input.mobilePresent) queueScreenshots.push("mobile");
  }
  // Only approve a coherent package with a real finding — never auto-approve a BLOCKED one.
  const approve = !input.approved && !input.coherenceBlocks && input.hasFinding && !retireRecommended;

  const actions: string[] = [];
  if (regenScope) actions.push("scope-regenerated");
  if (persistSubject) actions.push("subject-persisted");
  if (queueScreenshots.length) actions.push(`screenshots-queued:${queueScreenshots.join("+")}`);
  if (approve) actions.push("approved");
  if (retireRecommended) actions.push("retire-recommended");

  return { skip: null, regenScope, persistSubject, queueScreenshots, approve, retireRecommended, actions };
}

export interface CompletePackageResult {
  offerId: string;
  company: string;
  skip: string | null;
  applied: string[];
  retireRecommended: boolean;
  readinessBefore: string;
  readinessAfter: string;
  remaining: string[];
}

/**
 * Bring a single package to its highest valid cheap state. Idempotent: a steady-state
 * package performs no writes. Never spends paid media (only queues capture jobs, which
 * are free). `opts.enqueueScreenshots` (default true) can be disabled for a dry pass.
 */
export async function completePackage(
  offerId: string,
  opts: { actor: string; now: string; enqueueScreenshots?: boolean },
): Promise<CompletePackageResult> {
  const enqueue = opts.enqueueScreenshots ?? true;
  const stored0 = await store.getOffer(offerId);
  if (!stored0) return { offerId, company: "", skip: "not_found", applied: [], retireRecommended: false, readinessBefore: "", readinessAfter: "", remaining: [] };
  const offer0 = stored0 as unknown as QuickFixOffer;

  const before = await buildCanonicalPackage(offer0, { stored: stored0 });
  const subjectSpecific = before.story.subject.trim().toLowerCase() !== "website note" && before.story.subject.trim() !== "";

  const plan = packageRepairPlan({
    eligible: offer0.quickFixEligible,
    retired: !!stored0.retiredAt,
    hasFinding: offer0.findingIds.length > 0 && before.evidence.findings.length > 0,
    scopeNeedsRegen: offerNeedsScopeRegeneration(stored0).needs,
    subjectPersisted: !!(stored0.approvedSubjectFrozen || stored0.subjectSelected),
    subjectSpecific,
    approved: stored0.approvalStatus === "approved",
    coherenceBlocks: before.coherence.blocks,
    screenshotsMissing: before.assets.screenshots.status !== "READY",
    mobileRequired: before.assets.screenshots.mobileRequired,
    mobilePresent: before.assets.screenshots.mobilePresent,
    desktopPresent: before.assets.screenshots.desktopPresent,
    websiteKnown: !!before.websiteUrl,
  });

  if (plan.skip) {
    return { offerId, company: before.company, skip: plan.skip, applied: [], retireRecommended: false, readinessBefore: before.readiness, readinessAfter: before.readiness, remaining: [] };
  }

  const applied: string[] = [];

  if (plan.regenScope) {
    await store.replaceOfferScope(offerId, regeneratePlainScope(stored0), { actor: opts.actor, now: opts.now, reason: "complete-package materialization" });
    applied.push("scope-regenerated");
  }

  if (plan.persistSubject) {
    const subject = offerSubject(offer0);
    const family = classifyDefectFamily({ observation: offer0.scope.problemBeingSolved, context: offer0.scope.proposedSolution });
    await store.selectOutreachSubject(offerId, subject, { family, policyVersion: SUBJECT_POLICY_VERSION, actor: opts.actor, now: opts.now });
    applied.push("subject-persisted");
  }

  if (enqueue && plan.queueScreenshots.length && before.websiteUrl) {
    try {
      const { createScreenshotJob } = await import("../content-studio/screenshot-jobs");
      for (const viewport of plan.queueScreenshots) {
        await createScreenshotJob({ businessId: offer0.leadId, requestedUrl: before.websiteUrl, viewport });
      }
      applied.push(`screenshots-queued:${plan.queueScreenshots.join("+")}`);
    } catch {
      /* capture enqueue is best-effort — a missing screenshot DB never blocks the cheap repairs */
    }
  }

  // Re-approve only a coherent package (reconcile is idempotent + preserves human approval).
  const storedMid = await store.getOffer(offerId);
  const offerMid = (storedMid ?? stored0) as unknown as QuickFixOffer;
  const midPkg = await buildCanonicalPackage(offerMid, { stored: storedMid });
  if (!midPkg.coherence.blocks && storedMid?.approvalStatus !== "approved" && offerMid.findingIds.length > 0 && subjectSpecific) {
    await store.reconcileQuickCashOffers([offerMid], { now: opts.now });
    applied.push("approved");
  }

  const storedAfter = await store.getOffer(offerId);
  const after = await buildCanonicalPackage((storedAfter ?? stored0) as unknown as QuickFixOffer, { stored: storedAfter });
  const remaining = [
    ...after.blockers,
    ...[...after.completeness.missing, ...after.completeness.stale].map((d) => `${d.dep}:${d.status}`),
  ];

  return {
    offerId,
    company: after.company,
    skip: null,
    applied,
    retireRecommended: plan.retireRecommended,
    readinessBefore: before.readiness,
    readinessAfter: after.readiness,
    remaining: Array.from(new Set(remaining)),
  };
}

export interface RepairAllResult {
  processed: number;
  changed: number;
  readyNow: number;
  waitingForPaid: number;
  blocked: number;
  retireRecommended: number;
  perOffer: CompletePackageResult[];
}

/**
 * REPAIR ALL ELIGIBLE (§9). Runs Complete Package over every ACTIVE, eligible package.
 * Idempotent, bounded (`limit`), cost-aware (never spends paid media). Retired +
 * conversation-only offers are skipped. Returns a summary + per-offer detail.
 */
export async function repairAllEligible(opts: { actor: string; now: string; limit?: number; enqueueScreenshots?: boolean }): Promise<RepairAllResult> {
  const all = await store.listOffers();
  const eligible = all
    .filter((o) => !o.retiredAt && (o as unknown as QuickFixOffer).quickFixEligible)
    .slice(0, opts.limit ?? 1000);

  const perOffer: CompletePackageResult[] = [];
  for (const o of eligible) {
    perOffer.push(await completePackage(o.offerId, { actor: opts.actor, now: opts.now, enqueueScreenshots: opts.enqueueScreenshots }));
  }

  return {
    processed: perOffer.length,
    changed: perOffer.filter((r) => r.applied.length > 0).length,
    readyNow: perOffer.filter((r) => r.readinessAfter === "READY").length,
    waitingForPaid: perOffer.filter((r) => r.readinessAfter === "WAITING_FOR_PAID").length,
    blocked: perOffer.filter((r) => r.readinessAfter === "BLOCKED").length,
    retireRecommended: perOffer.filter((r) => r.retireRecommended).length,
    perOffer,
  };
}
