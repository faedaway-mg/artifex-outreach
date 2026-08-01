/**
 * Adds real Los Angeles-area restaurant and salon leads (operator-created) so the
 * restaurant/salon presence profiles and conversation logic can be verified on
 * live records. Idempotent (dedupes by normalized name). No outreach is sent;
 * insertLead + generateAndStoreBI are internal-only.
 *
 * Public data only; phone/email left null so no accidental contact vector exists.
 * Real Places discovery is preferred when a key is available, but local has none —
 * these are legitimate real businesses entered by hand.
 *
 *   AI_PROVIDER=mock STORAGE_PROVIDER=mock pnpm exec tsx scripts/add-verification-leads.ts
 */
import "./loadEnv";
import { insertLead, listLeads } from "../src/lib/repo";
import { normalizeName, nowIso, domainFromUrl } from "../src/lib/store";
import { generateAndStoreBI } from "../src/lib/intelligence-actions";
import { detectPresence } from "../src/lib/presence";

const BUSINESSES = [
  {
    businessName: "Bottega Louie",
    industry: "Restaurant",
    normalizedCategory: "restaurants",
    categoryGroup: "Hospitality and Experiences",
    address: "700 S Grand Ave",
    city: "Los Angeles",
    state: "CA",
    postalCode: "90017",
    website: "https://bottegalouie.com",
    rating: 4.4,
    reviewCount: 9500,
  },
  {
    businessName: "Nine Zero One Salon",
    industry: "Salon",
    normalizedCategory: "salons",
    categoryGroup: "Health and Wellness",
    address: "8590 Sunset Blvd",
    city: "West Hollywood",
    state: "CA",
    postalCode: "90069",
    website: "https://nzsalon.com",
    rating: 4.6,
    reviewCount: 360,
  },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");
  const existing = await listLeads();
  const seen = new Set(existing.map((l) => normalizeName(l.businessName)));

  for (const b of BUSINESSES) {
    const norm = normalizeName(b.businessName);
    if (seen.has(norm)) {
      console.log(`[skip] already present: ${b.businessName}`);
      continue;
    }
    const s = nowIso();
    const lead = await insertLead({
      googlePlaceId: null,
      businessName: b.businessName,
      normalizedName: norm,
      industry: b.industry,
      normalizedCategory: b.normalizedCategory,
      categoryGroup: b.categoryGroup as any,
      address: b.address,
      city: b.city,
      state: b.state,
      postalCode: b.postalCode,
      latitude: null,
      longitude: null,
      phone: null,
      website: b.website,
      websiteDomain: domainFromUrl(b.website),
      publicEmail: null,
      contactFormUrl: null,
      socialLinks: [],
      locationsCount: null,
      rating: b.rating,
      reviewCount: b.reviewCount,
      businessStatus: "OPERATIONAL",
      googleMapsUrl: null,
      hours: null,
      source: "Manual (operator-created, public data)",
      retrievedAt: s,
      tier: null,
      leadScore: null,
      scoreBreakdown: null,
      pipelineStage: "Discovered",
      estimatedValueLow: null,
      estimatedValueHigh: null,
      recommendedService: null,
      recommendedAction: null,
      recommendationReason: null,
      opportunitySummary: null,
      strengths: [],
      acquisitionStrategy: null,
      acquisitionScore: null,
      acquisitionReason: null,
      acquisitionScoreBreakdown: null,
      acquisitionOverride: false,
      assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null,
      note: null,
      lastContactAt: null,
      nextFollowUpAt: null,
    } as any);

    const presence = detectPresence(lead);
    const bi = await generateAndStoreBI(lead);
    console.log(`[added] ${lead.id}  ${b.businessName}  presence=${presence.profile}  BIconf=${(bi as any).evidenceConfidence ?? "?"}`);
  }
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
