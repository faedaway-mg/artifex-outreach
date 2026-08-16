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
import { analyzeBusiness, type BusinessIntelligence } from "./intelligence/engine";
import { diffIntelligence } from "./intelligence/enrichment-delta";
import { findingsForLead, contactsForLead, getBusinessIntelligence, upsertBusinessIntelligence, getLead, updateLead, appendAudit } from "./repo";
import { isSameSiteEmail } from "./intelligence/providers/website-intelligence";
import { isValidEmail } from "./outreach/contact-strategy";
import { resolveCallWorkForEmail } from "./outreach/contact-route";
import { buildSurfacePackage } from "./review-video/surface";

/**
 * Value-first supply: the website crawler already fetched the HTML and (now) extracted the
 * business's published email. If the lead has NO send route yet and the discovered address is
 * on the business's OWN domain (reasonably trustworthy — never a stray third party), adopt it
 * as the lead's public email. This flips the lead from cold-call-first to email-first through
 * the EXISTING contact-strategy engine, and resolveCallWorkForEmail supersedes any obsolete
 * cold-call task and queues the review-and-send. Idempotent: only fills a MISSING route, never
 * overwrites one; audited; no new network I/O (reuses the crawl). Sends nothing.
 */
async function promoteDiscoveredEmail(leadId: string, profile: BusinessIntelligence): Promise<void> {
  const fresh = await getLead(leadId);
  if (!fresh || isValidEmail(fresh.publicEmail)) return; // never overwrite an existing route
  const evidence = profile.evidence.find((e: { field: string; value: unknown }) => e.field === "publicEmail");
  const email = typeof evidence?.value === "string" ? evidence.value.trim().toLowerCase() : null;
  if (!email || !isSameSiteEmail(email, fresh.websiteDomain)) return;
  await updateLead(leadId, { publicEmail: email });
  await appendAudit({ action: "lead.email.discovered", actor: "system", targetType: "lead", targetId: leadId, meta: { email, source: "website-crawl" }, ip: null });
  await resolveCallWorkForEmail(leadId, fresh.businessName); // supersede cold-call work, queue review-and-send
}

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

  // Persist a sanitized snapshot of the analyzed public surface so the review-video renderer can show
  // the real page later WITHOUT re-crawling. Reuse the prior package when this run supplied no pages.
  const surfacePackage = opts.pages?.length ? buildSurfacePackage(opts.pages, generatedAt) : (prev?.surfacePackage ?? null);
  const stored = await upsertBusinessIntelligence({ leadId: lead.id, profile, enrichmentDelta, generatedAt, surfacePackage });
  // Value-first: adopt a same-domain published email as the send route so the review can be
  // emailed rather than the lead falling through to a cold call. Best-effort — never break BI.
  try { await promoteDiscoveredEmail(lead.id, profile); } catch { /* enrichment must not fail on this */ }
  return stored;
}
