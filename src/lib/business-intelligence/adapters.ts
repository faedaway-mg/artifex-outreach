// ─────────────────────────────────────────────────────────────────────────────
// Adapters — the Profile projected into the shapes other systems already consume.
//
// The Business Intelligence Profile is the single source of truth. Rather than
// each consumer re-analyzing a business, it reads the profile through one of these
// pure projections. Adding a consumer means adding a projection here — the
// analysis lives in exactly one place.
// ─────────────────────────────────────────────────────────────────────────────
import { openingConversation, type OpeningConversation } from "../conversation-engine";
import type { DeliverableContent } from "../types";
import type { BusinessProfile } from "./types";

/**
 * The call opening, built from the profile's canonical conversation input. This
 * is how the Conversation Engine is sourced from the profile — one analytical
 * source, one opening.
 */
export function openingFromProfile(profile: BusinessProfile): OpeningConversation {
  return openingConversation(profile.conversationInput, profile.presence);
}

/**
 * Project the profile's categorized opportunities into the opportunity shape the
 * Business Technology Review PDF and the investment model consume. Lets those
 * systems price and present a business straight from the profile.
 */
export function toDeliverableOpportunities(profile: BusinessProfile): DeliverableContent["opportunities"] {
  return profile.opportunities.map((o) => ({
    observation: o.observation,
    evidence: `${o.confidence.label} confidence · basis: ${o.basis.join("; ")}`,
    businessConsequence: o.whyItMatters,
    modernizationDirection: `${o.category}: ${o.estimatedImpact.rationale}`,
  }));
}

/**
 * A compact, human executive read of the profile — for the operator briefing,
 * CRM summary line, and anywhere a one-glance picture is needed.
 */
export function toExecutiveDigest(profile: BusinessProfile): {
  headline: string;
  summary: string;
  strengths: string[];
  topOpportunities: Array<{ category: string; observation: string; impact: string; confidence: string }>;
  evidenceConfidence: number;
} {
  return {
    headline: profile.headline,
    summary: profile.executiveSummary,
    strengths: profile.strengths,
    topOpportunities: profile.opportunities.slice(0, 3).map((o) => ({
      category: o.category,
      observation: o.observation,
      impact: o.estimatedImpact.level,
      confidence: o.confidence.label,
    })),
    evidenceConfidence: profile.evidenceConfidence,
  };
}
