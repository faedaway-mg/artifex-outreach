// ─────────────────────────────────────────────────────────────────────────────
// LEAD SPRINT SNAPSHOT (track #183) — the production entry point that runs the FREE pipeline over the
// live lead inventory and returns a serializable LeadSprintReport. READ-ONLY: it reads leads + real
// suppression state, scores + ranks them, and returns counts. It performs NO paid compute, NO prospect
// contact, and NO writes to lead state. The dashboard renders it and a cron can trigger/log it.
//
// Finalists require a constructible, evidence-backed, reachable PACKAGE — which the gated paid pipeline
// builds. Until then this snapshot shows a real, ranked, market-distributed QUALIFIED POOL with zero
// finalists, which is the correct and safe state while delivery is OFF.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, buildSuppressionChecker } from "../repo";
import type { Lead } from "../types";
import { podForLocation } from "./pods";
import { buildLeadSprintReport, type LeadSprintContext, type LeadSprintReadModelReport } from "./read-model";

const domainOf = (lead: Lead): string | null => lead.websiteDomain ?? (lead.website ? lead.website.replace(/^https?:\/\//, "").split("/")[0] : null);

// Provenance heuristics for synthetic/test records — a cheap, deterministic signal (never paid).
const SYNTHETIC_SOURCE = /test|seed|synthetic|demo|fixture|sample/i;

export interface LeadSprintSnapshot extends LeadSprintReadModelReport {
  generatedAt: string;
  scope: "pods" | "national";
}

export interface ComputeSnapshotOpts {
  now: string;                 // caller supplies the timestamp (Date.now() is unavailable in some contexts)
  nearTermCapacity: number;    // combined ramp capacity today
  podsOnly?: boolean;          // default true — focus the four initial priority pods
}

/**
 * Compute the live Lead Sprint snapshot. Suppression is applied for real; findings/contacts/offer-
 * readiness default to the not-yet-analyzed state (contexts accrue those as the pipeline enriches them),
 * so raw leads populate the ranked pool and finalists remain gated until real packages exist.
 */
export async function computeLeadSprintSnapshot(opts: ComputeSnapshotOpts): Promise<LeadSprintSnapshot> {
  const podsOnly = opts.podsOnly !== false;
  const [leads, isSuppressed] = await Promise.all([listLeads(), buildSuppressionChecker()]);

  const contexts: LeadSprintContext[] = leads.map((lead) => ({
    lead,
    findings: [], // enrichment accrues real findings; empty → pooled but not finalist-eligible yet
    contact: null,
    isSuppressed: isSuppressed({ email: lead.publicEmail, domain: domainOf(lead), phone: lead.phone }),
    isDuplicate: false, // DB leads are deduped at insert; a post-hoc dup flag would set this
    quickFixEligible: false,   // requires a scoped offer (gated paid pipeline builds it)
    clearsMarginGate: false,
    voiceGenerationResolved: true,
    compatibleTrustAvailable: false,
    isSynthetic: SYNTHETIC_SOURCE.test(lead.source ?? ""),
  }));

  const report = buildLeadSprintReport(contexts, { nearTermCapacity: opts.nearTermCapacity, podsOnly });
  return { ...report, generatedAt: opts.now, scope: podsOnly ? "pods" : "national" };
}

/** The four initial priority pods' labels — for the dashboard's "markets currently running" line. */
export function activePodLabels(): string[] {
  return ["Greenville region", "Huntsville region", "Chattanooga region", "Northwest Arkansas"];
}

/** Convenience: does a lead fall inside any current pod? (used to tag/filter active inventory). */
export function leadInAnyPod(lead: Pick<Lead, "city" | "state">): boolean {
  return podForLocation(lead.city, lead.state).pod !== null;
}
