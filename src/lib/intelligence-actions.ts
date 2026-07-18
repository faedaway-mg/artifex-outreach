// ─────────────────────────────────────────────────────────────────────────────
// Business Intelligence generation — connects the engine to the live OS.
//
// Runs analyzeBusiness() for a lead using content ALREADY collected (website pages
// exposed by analyzeWebsite, plus any available review text), computes the
// enrichment delta against the previously stored profile, and persists the result.
// Not a server-action module (mixes helpers) — the "use server" wrappers live in
// actions.ts and call generateAndStoreBI().
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, StoredBusinessIntelligence } from "./types";
import type { WebsiteSignals } from "./scoring";
import type { SuppliedPage, SuppliedReview } from "./intelligence/providers";
import { analyzeBusiness } from "./intelligence/engine";
import { diffIntelligence } from "./intelligence/enrichment-delta";
import { findingsForLead, contactsForLead, getBusinessIntelligence, upsertBusinessIntelligence } from "./repo";

/**
 * The single wiring point for review TEXT. Review intelligence needs review bodies,
 * which the current Google Places integration does not fetch (count/rating only).
 * When a review source becomes available (Places reviews field, or a review
 * provider), return normalized review text here — nothing else changes. Until then
 * the Review Intelligence provider stays inert and degrades gracefully.
 */
export async function gatherReviewsForLead(_lead: Lead): Promise<SuppliedReview[]> {
  return [];
}

export interface GenerateBIOptions {
  pages?: SuppliedPage[];
  reviews?: SuppliedReview[];
  signals?: WebsiteSignals;
}

/** Generate a full BusinessIntelligence profile, diff vs. the last one, persist. */
export async function generateAndStoreBI(lead: Lead, opts: GenerateBIOptions = {}): Promise<StoredBusinessIntelligence> {
  const [findings, contacts] = await Promise.all([findingsForLead(lead.id), contactsForLead(lead.id)]);
  const reviews = opts.reviews ?? (await gatherReviewsForLead(lead));

  const profile = await analyzeBusiness({ lead, findings, contacts, signals: opts.signals, pages: opts.pages, reviews });

  const prev = await getBusinessIntelligence(lead.id);
  const enrichmentDelta = prev ? diffIntelligence(prev.profile, profile) : null;
  const generatedAt = new Date().toISOString();

  return upsertBusinessIntelligence({ leadId: lead.id, profile, enrichmentDelta, generatedAt });
}
