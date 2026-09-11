// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT PACKAGE QA + ACTIVE-INVENTORY SWEEP (Active Inventory Integrity mandate
// §32–§36). "The most important architecture change": Breakbot must audit EVERY real
// ACTIVE customer-facing package, not just golden fixtures — and bind each verdict to
// the EXACT package revision, so any change to customer-facing material invalidates the
// prior PASS (§33). This is the sweep the deploy gate + the pre-outbound gate run.
//
// It is READ-ONLY over the store (it never sends, charges, or mutates copy). The caller
// (a script against prod, or the deploy preflight) may persist verdicts via
// store.recordPackageQA — but the judgement itself performs no writes.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import type { StoredOffer } from "./store";
import { buildCanonicalPackage, type CanonicalPackage, type PackageReadiness } from "./canonical-package";
import { packageQAStale } from "./store";
import type { CoherenceIssue } from "./package-coherence";

export type PackageVerdict = "PASS" | "BLOCKED" | "WAITING_FOR_PAID" | "REPAIRING" | "NEEDS_QA" | "RETIRED";

export interface PackageQAResult {
  offerId: string;
  leadId: string;
  company: string;
  revision: string;
  /** Verdict for the CURRENT live revision. */
  verdict: PackageVerdict;
  readiness: PackageReadiness;
  reasons: string[];
  coherenceIssues: CoherenceIssue[];
  /** Dependency keys still missing/stale. */
  open: string[];
  /** True when a stored PASS existed but the revision changed under it (§33). */
  wasInvalidatedByTouch: boolean;
}

function verdictFromReadiness(readiness: PackageReadiness): PackageVerdict {
  switch (readiness) {
    case "READY": return "PASS";
    case "BLOCKED": return "BLOCKED";
    case "WAITING_FOR_PAID": return "WAITING_FOR_PAID";
    case "PREPARING": return "REPAIRING";
    case "NOT_ACTIVE": return "RETIRED";
  }
}

/**
 * Run Breakbot PACKAGE QA for one offer. Builds the canonical package (§1) and derives a
 * verdict from its readiness + coherence, bound to `pkg.revision`. If a prior verdict was
 * recorded against a DIFFERENT revision, the live judgement stands and `wasInvalidatedByTouch`
 * is set (the old PASS did not carry over — §33).
 */
export async function runPackageQA(
  offer: QuickFixOffer,
  opts: { stored?: StoredOffer | null; personalizedVideoRequired?: boolean; pkg?: CanonicalPackage } = {},
): Promise<PackageQAResult> {
  const pkg = opts.pkg ?? (await buildCanonicalPackage(offer, { stored: opts.stored ?? null, personalizedVideoRequired: opts.personalizedVideoRequired }));
  const liveVerdict = verdictFromReadiness(pkg.readiness);
  const wasInvalidatedByTouch =
    !!opts.stored && opts.stored.qaVerdict === "PASS" && packageQAStale(opts.stored, pkg.revision);

  const reasons = [
    ...pkg.blockers,
    ...pkg.coherence.issues.filter((i) => i.severity === "BLOCK").map((i) => i.detail),
  ];

  return {
    offerId: pkg.offerId,
    leadId: pkg.leadId,
    company: pkg.company,
    revision: pkg.revision,
    verdict: liveVerdict,
    readiness: pkg.readiness,
    reasons: Array.from(new Set(reasons)),
    coherenceIssues: pkg.coherence.issues,
    open: [...pkg.completeness.missing, ...pkg.completeness.stale].map((d) => `${d.dep}:${d.status}`),
    wasInvalidatedByTouch,
  };
}

export interface InventorySweepCounts {
  total: number;
  active: number;
  retired: number;
  pass: number;
  blocked: number;
  waitingForPaid: number;
  repairing: number;
  readyToSend: number;
}

export interface InventorySweep {
  results: PackageQAResult[];
  counts: InventorySweepCounts;
  /** ACTIVE packages that are NOT PASS, with their blocker reasons (for the gate report). */
  notReady: PackageQAResult[];
}

export interface SweepInput {
  /** The stored offers to audit (caller supplies — from store.listOffers or a fixture set). */
  offers: StoredOffer[];
  /** Which offerIds are #202-authorized finalists (personalized video required). */
  personalizedVideoRequired?: (offer: StoredOffer) => boolean;
}

/**
 * Sweep an ACTIVE inventory of stored offers and produce per-package verdicts + honest
 * counts (§35/§50). Retired + non-eligible (conversation-only) offers are classified out
 * of ACTIVE so they never inflate the active/ready numbers (§39). READ-ONLY.
 */
export async function packageInventorySweep(input: SweepInput): Promise<InventorySweep> {
  const results: PackageQAResult[] = [];
  let retired = 0;
  for (const stored of input.offers) {
    const offer = stored as unknown as QuickFixOffer;
    // Retired or conversation-only ⇒ not active work; count separately, do not QA as active.
    if (stored.retiredAt || !offer.quickFixEligible) {
      retired += stored.retiredAt ? 1 : 0;
      continue;
    }
    const res = await runPackageQA(offer, {
      stored,
      personalizedVideoRequired: input.personalizedVideoRequired ? input.personalizedVideoRequired(stored) : false,
    });
    results.push(res);
  }

  const counts: InventorySweepCounts = {
    total: input.offers.length,
    active: results.length,
    retired,
    pass: results.filter((r) => r.verdict === "PASS").length,
    blocked: results.filter((r) => r.verdict === "BLOCKED").length,
    waitingForPaid: results.filter((r) => r.verdict === "WAITING_FOR_PAID").length,
    repairing: results.filter((r) => r.verdict === "REPAIRING").length,
    readyToSend: results.filter((r) => r.verdict === "PASS").length,
  };
  const notReady = results.filter((r) => r.verdict !== "PASS");
  return { results, counts, notReady };
}

export interface PreSendGate {
  sendable: boolean;
  verdict: PackageVerdict;
  reasons: string[];
  revision: string;
}

/**
 * PRE-SEND PACKAGE RE-GATE (§36). Immediately before a package would move Scheduled → Sent,
 * revalidate the EXACT current revision. A package that is not a live PASS — or whose
 * revision changed since it was last QA'd — must NOT send; it is removed from send capacity
 * to be repaired/replaced. Never sends anything itself; purely a gate decision.
 */
export async function preSendRegate(offer: QuickFixOffer, stored: StoredOffer | null): Promise<PreSendGate> {
  const res = await runPackageQA(offer, { stored });
  const sendable = res.verdict === "PASS";
  const reasons = sendable ? [] : res.reasons.length ? res.reasons : [`package is ${res.verdict}, not PASS`];
  if (res.wasInvalidatedByTouch) reasons.push("customer-facing material changed since the last QA — re-audited");
  return { sendable, verdict: res.verdict, reasons, revision: res.revision };
}
