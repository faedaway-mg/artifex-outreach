// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ACTIVE-VIEW EXCLUSION (master mandate §4 / #203) — the reusable seam that turns the pure
// classifyLegacyRecord() judgement into a decision every ACTIVE operational view can share: "is this
// lead an active current candidate, or a legacy/disqualified record that must be excluded from active
// operations (but preserved in history)?"
//
// It derives the classifier's signals from a real Lead using ONLY cheap, deterministic fields (source,
// pipeline stage, locationsCount, note) — never a paid call, never a write. Named legacy examples
// (Liberty Tax, Motion Recruitment) are NOT hard-coded: a national franchise/enterprise falls out of the
// general locationsCount rule; a test/demo record falls out of the provenance rule. Callers that know a
// stronger signal (a real duplicate, a historically-generated package) pass it via `overrides`.
//
// EXCLUSION, NOT DELETION: an archived/disqualified lead is removed from active pool / ranked / finalists
// / Ready-to-Send / allocation / counts — its history, evidence, suppression and audit lineage are
// untouched. Zero paid credits are consumed here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import { classifyLegacyRecord, isArchivedDisposition, type LegacyClassification, type LegacyClassifyInput } from "./legacy-classify";

// A record with this many locations is not an owner-led local business — it is a national/public
// enterprise (terminal ICP failure). Liberty Tax / Motion Recruitment-scale records fall out here.
const ENTERPRISE_LOCATION_THRESHOLD = 50;
// Multi-location above this is a corporate-controlled franchise (no local decision path) — terminal.
const FRANCHISE_LOCATION_THRESHOLD = 15;

// Cheap provenance heuristics (deterministic; never paid).
const SYNTHETIC_SOURCE = /test|seed|synthetic|demo|fixture|sample/i;
const PROSPECT_VIDEO_DEMO = /prospect[-_\s]?video|video[-_\s]?demo|demo[-_\s]?package/i;
const SUPERSEDED_EXPERIMENT = /experiment|superseded|proposal[-_\s]?test|legacy[-_\s]?test|old[-_\s]?gen/i;

/** Caller-supplied stronger signals the Lead row alone cannot carry (both default false). */
export interface LegacyClassifyOverrides {
  /** The lead is a confirmed post-hoc duplicate of another active record. */
  isDuplicateHistorical?: boolean;
  /** A previously-completed historical package exists for this lead — not current work. */
  alreadyGeneratedHistorical?: boolean;
  /** Whether the lead sits inside a currently-sanctioned market. Defaults true (a real US lead is
   *  in-market); pass false only for an explicitly abandoned market/geo experiment. */
  inCurrentTargetMarket?: boolean;
}

/** Map a real Lead → the classifier's input using only cheap deterministic fields. Pure. */
export function leadLegacyInput(lead: Lead, overrides: LegacyClassifyOverrides = {}): LegacyClassifyInput {
  const provenanceText = `${lead.source ?? ""} ${lead.note ?? ""}`;
  const locations = lead.locationsCount ?? 1;
  const rejected = lead.pipelineStage === "Rejected" || lead.pipelineStage === "Disqualified";
  return {
    leadId: lead.id,
    businessName: lead.businessName,
    city: lead.city,
    state: lead.state,
    isSyntheticProvenance: SYNTHETIC_SOURCE.test(lead.source ?? ""),
    isProspectVideoDemo: PROSPECT_VIDEO_DEMO.test(provenanceText),
    isSupersededExperiment: SUPERSEDED_EXPERIMENT.test(provenanceText),
    alreadyGeneratedHistorical: overrides.alreadyGeneratedHistorical ?? false,
    isDuplicateHistorical: overrides.isDuplicateHistorical ?? false,
    isEnterpriseOrPublic: locations >= ENTERPRISE_LOCATION_THRESHOLD,
    isFranchiseCorporateControlled: locations >= FRANCHISE_LOCATION_THRESHOLD && locations < ENTERPRISE_LOCATION_THRESHOLD,
    // A pipeline-Rejected/Disqualified lead is not a current-ICP fit; otherwise fit is assumed until a
    // real qualification pass proves otherwise (the Lead Sprint's own scoring is the finer gate).
    meetsCurrentIcpFit: !rejected,
    inCurrentTargetMarket: overrides.inCurrentTargetMarket ?? true,
  };
}

/** Classify a real Lead for active-view exclusion. Pure + deterministic; never paid. */
export function classifyLead(lead: Lead, overrides: LegacyClassifyOverrides = {}): LegacyClassification {
  return classifyLegacyRecord(leadLegacyInput(lead, overrides));
}

/** The single predicate every active view shares: does this lead belong in active operations? */
export function isActiveLead(lead: Lead, overrides: LegacyClassifyOverrides = {}): boolean {
  return classifyLead(lead, overrides).disposition === "active";
}

export interface LeadActivityPartition {
  active: Lead[];
  archived: Lead[];       // LEGACY_ARCHIVED
  disqualified: Lead[];   // DISQUALIFIED_LEGACY
  classifications: Record<string, LegacyClassification>; // by leadId — for Archive/History surfaces
}

/**
 * Partition leads into active vs excluded (archived/disqualified), keeping every classification for the
 * read-only Archive/History/Admin surfaces. Active views consume `.active`; history surfaces keep the
 * rest. No lead is dropped from the dataset — only from ACTIVE operations.
 */
export function partitionLeadsByActivity(
  leads: Lead[],
  overridesFor: (lead: Lead) => LegacyClassifyOverrides = () => ({}),
): LeadActivityPartition {
  const out: LeadActivityPartition = { active: [], archived: [], disqualified: [], classifications: {} };
  for (const lead of leads) {
    const c = classifyLead(lead, overridesFor(lead));
    out.classifications[lead.id] = c;
    if (c.disposition === "active") out.active.push(lead);
    else if (c.disposition === "LEGACY_ARCHIVED") out.archived.push(lead);
    else out.disqualified.push(lead);
  }
  return out;
}

export { isArchivedDisposition };
