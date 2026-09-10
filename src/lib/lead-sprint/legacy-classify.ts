// ─────────────────────────────────────────────────────────────────────────────
// LEGACY / STALE PROSPECT CLASSIFIER (master mandate §1-3).
//
// A PURE, DETERMINISTIC rule engine that decides whether an existing prospect/Content-Studio record is
// still a valid CURRENT candidate or should be moved OUT of active operations into an archival state.
// It NEVER deletes anything — classification is a state, so history / generated assets / send +
// suppression + unsubscribe state / audit lineage are all preserved (§2). It spends ZERO paid credits:
// nothing here regenerates or modernizes a record (§3, §43).
//
// Two archival states (§2), using the canonical state vocabulary:
//   • LEGACY_ARCHIVED     — off-strategy by PROVENANCE or GEOGRAPHY (test/demo/experiment/old-market).
//                           Requalifiable ONLY by the current system re-discovering + qualifying it.
//   • DISQUALIFIED_LEGACY — a genuine current-ICP FIT failure (wrong company type / doesn't meet the
//                           qualification model). Not grandfathered back in (§3 "do not grandfather").
//
// Named examples (Liberty Tax, Motion Recruitment) are NOT hard-coded as special cases — they fall out
// of the general rules (wrong company type / off-ICP) like any comparable record (§1 "do not limit to").
// ─────────────────────────────────────────────────────────────────────────────

export const LEGACY_CLASSIFY_VERSION = "v1-2026-09";

export type LegacyDisposition = "active" | "LEGACY_ARCHIVED" | "DISQUALIFIED_LEGACY";

export interface LegacyClassifyInput {
  leadId: string;
  businessName: string;
  city: string;
  state: string;
  // ── provenance / experiment signals → LEGACY_ARCHIVED ──
  isSyntheticProvenance: boolean;   // internal-test / synthetic / demo record
  isProspectVideoDemo: boolean;     // an old prospect-video demonstration artifact
  isSupersededExperiment: boolean;  // an old proposal/content test / prior-generation experiment
  alreadyGeneratedHistorical: boolean; // a previously-completed historical package, not current work
  isDuplicateHistorical: boolean;   // duplicate historical lead record
  // ── current-ICP fit signals → DISQUALIFIED_LEGACY ──
  isEnterpriseOrPublic: boolean;    // wrong company type
  isFranchiseCorporateControlled: boolean; // corporate-controlled franchise location
  meetsCurrentIcpFit: boolean;      // passes the current qualification model (persona fit, not DO_NOT_PREPARE)
  // ── geography (strategy) → LEGACY_ARCHIVED ──
  inCurrentTargetMarket: boolean;   // inside a current pod OR an in-policy market
}

export interface LegacyClassification {
  version: string;
  leadId: string;
  disposition: LegacyDisposition;
  /** True when a future current-system pass COULD requalify it (geography/market change) — never for
   *  terminal type/provenance failures (enterprise/franchise/synthetic). */
  requalifiable: boolean;
  reasons: string[];
}

/**
 * Classify a record. PURE + DETERMINISTIC. Priority: provenance/experiment archival first, then hard
 * company-type disqualification, then geography archival, then current-ICP fit. Anything that survives
 * all rules stays `active`.
 */
export function classifyLegacyRecord(i: LegacyClassifyInput): LegacyClassification {
  const base = { version: LEGACY_CLASSIFY_VERSION, leadId: i.leadId };

  // 1. Provenance / experiment / historical artifacts → archived (off-strategy, kept for audit).
  if (i.isSyntheticProvenance) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: false, reasons: ["Synthetic/internal-test/demo provenance — not a real current candidate."] };
  if (i.isProspectVideoDemo) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: false, reasons: ["Prior prospect-video demonstration artifact — historical, not active production."] };
  if (i.isSupersededExperiment) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: false, reasons: ["Superseded proposal/content experiment from a prior generation."] };
  if (i.alreadyGeneratedHistorical) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: false, reasons: ["Already-generated historical package — not current work."] };
  if (i.isDuplicateHistorical) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: false, reasons: ["Duplicate historical lead record."] };

  // 2. Wrong company type → disqualified (a genuine ICP fit failure; not grandfathered).
  if (i.isEnterpriseOrPublic) return { ...base, disposition: "DISQUALIFIED_LEGACY", requalifiable: false, reasons: ["National enterprise / public company — outside the owner-led local-business ICP."] };
  if (i.isFranchiseCorporateControlled) return { ...base, disposition: "DISQUALIFIED_LEGACY", requalifiable: false, reasons: ["Corporate-controlled franchise location — no local decision path."] };

  // 3. Wrong geography → archived (off the CURRENT market strategy; requalifiable if strategy shifts or
  //    the current system independently re-discovers it in-market).
  if (!i.inCurrentTargetMarket) return { ...base, disposition: "LEGACY_ARCHIVED", requalifiable: true, reasons: ["Outside the current target geography/market experiment."] };

  // 4. Doesn't meet the current qualification model → disqualified (§3: do not grandfather bad leads).
  if (!i.meetsCurrentIcpFit) return { ...base, disposition: "DISQUALIFIED_LEGACY", requalifiable: true, reasons: ["Does not meet the current qualification model (weak fit / unsupported)."] };

  // 5. Survives every rule → genuinely current, stays active.
  return { ...base, disposition: "active", requalifiable: false, reasons: ["Meets the current ICP and target market — retained as an active current opportunity."] };
}

/** True for any archival/disqualification state — the single predicate active views filter OUT (§2). */
export function isArchivedDisposition(d: LegacyDisposition): boolean {
  return d === "LEGACY_ARCHIVED" || d === "DISQUALIFIED_LEGACY";
}
