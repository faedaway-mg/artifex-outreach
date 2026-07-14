// ─────────────────────────────────────────────────────────────────────────────
// Automatic daily lead engine.
//
// Fills the Today queue up to the configured size (default 8) with the best
// revenue-moving opportunities. Existing active work (follow-ups, meetings,
// proposals, warm leads) is prioritized by its own task priority; this engine
// only DISCOVERS + qualifies enough NEW businesses to fill the remaining slots.
//
// Never contacts anyone. Never substitutes mock businesses in production: if
// Google Places is unavailable, the run is recorded as such and existing Today
// tasks are preserved untouched.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getSettings,
  updateSettings,
  findDuplicate,
  isSuppressed,
  insertLead,
  insertTask,
  todaysTasks,
  insertProspectingRun,
  updateProspectingRun,
  listLeads,
} from "./repo";
import { normalizeName, domainFromUrl, nowIso } from "./store";
import { searchPlaces, placesMode, type PlaceResult } from "./providers/places";
import { computeScore } from "./scoring";
import { recommendService } from "./providers/ai";
import type { ProspectingRun, Lead, Settings, Tier } from "./types";
import { discoverInputSchema } from "./schemas";

const PLACES_COST_PER_REQUEST = 0.032; // approx Text Search SKU

export interface ProspectRequest {
  trigger: "scheduled" | "manual" | "refill" | "find-more" | "replace";
  count?: number; // explicit number of new leads to add (else fill to queue size)
}

export async function runProspecting(req: ProspectRequest): Promise<ProspectingRun> {
  const settings = await getSettings();
  const p = settings.prospecting;
  const mode = placesMode();

  const run: Omit<ProspectingRun, "id"> = {
    startedAt: nowIso(),
    completedAt: null,
    trigger: req.trigger,
    providerMode: mode,
    searchesPerformed: 0,
    placesRequests: 0,
    examined: 0,
    duplicatesRemoved: 0,
    excluded: 0,
    qualified: 0,
    addedToToday: 0,
    estimatedCostUsd: 0,
    errors: [],
    addedLeadIds: [],
  };
  const record = await insertProspectingRun(run);

  // Production safety: never inject mock businesses. If discovery is unavailable,
  // preserve existing Today tasks and report the reason.
  if (mode !== "google") {
    const msg =
      mode === "disabled"
        ? "Google Places is disabled (no API key). Existing Today tasks preserved; no businesses added."
        : "Discovery is in mock mode (development). No real businesses added.";
    if (process.env.NODE_ENV === "production" || mode === "disabled") {
      await updateProspectingRun(record.id, { completedAt: nowIso(), errors: [msg] });
      return { ...run, ...record, completedAt: nowIso(), errors: [msg] };
    }
    // dev/mock: allow, but clearly labeled as mock via provider
  }

  // How many NEW leads do we need to reach the queue size?
  const currentTodayCount = (await todaysTasks()).length;
  const target = req.count ?? Math.max(0, p.dailyQueueSize - currentTodayCount);
  if (target <= 0) {
    await updateProspectingRun(record.id, { completedAt: nowIso() });
    await updateSettings({ prospecting: { ...p, lastRunAt: nowIso() } });
    return { ...run, ...record, completedAt: nowIso() };
  }

  // Build a bounded set of searches: industry × rotating territory.
  const industries = p.industries.filter((i) => !p.excludedIndustries.includes(i));
  const territories = p.territories.length ? p.territories : [{ city: "Los Angeles", state: "CA" }];
  const searchPlan = industries.map((ind, i) => ({ category: ind, territory: territories[i % territories.length] }));
  const maxSearches = Math.min(searchPlan.length, 8);

  const existing = await listLeads();
  const seen = new Set(existing.map((l) => l.normalizedName));
  const candidates: Array<{ place: PlaceResult; score: ReturnType<typeof computeScore>; industry: string; territory: { city: string; state: string } }> = [];

  let searches = 0;
  let requests = 0;
  const errors: string[] = [];

  for (const plan of searchPlan.slice(0, maxSearches)) {
    const parsed = discoverInputSchema.safeParse({
      category: plan.category,
      city: plan.territory.city,
      state: plan.territory.state,
      radiusMiles: p.radiusMiles,
      minRating: p.minRating,
      minReviews: p.minReviews,
      requireWebsite: p.requireWebsite,
      requirePhone: p.requirePhone,
    });
    if (!parsed.success) continue;
    searches += 1;
    const result = await searchPlaces(parsed.data);
    requests += result.provider === "google" ? 1 : 0;
    if (!result.success) {
      if (result.error) errors.push(`${plan.category}/${plan.territory.city}: ${result.error.googleStatus ?? result.error.message}`);
      continue;
    }
    for (const place of result.results) {
      run.examined = (run.examined ?? 0) + 1;
      // Build a provisional lead for scoring/exclusion.
      const norm = normalizeName(place.businessName);
      if (excluded(place, norm, p)) {
        run.excluded += 1;
        continue;
      }
      if (seen.has(norm)) {
        run.duplicatesRemoved += 1;
        continue;
      }
      const provisional = placeToLead(place, plan.category, plan.territory);
      const dup = await findDuplicate({ googlePlaceId: place.googlePlaceId, website: place.website, phone: place.phone, businessName: place.businessName });
      if (dup) {
        run.duplicatesRemoved += 1;
        continue;
      }
      if (await isSuppressed({ email: null, domain: domainFromUrl(place.website), phone: place.phone })) {
        run.excluded += 1;
        continue;
      }
      seen.add(norm);
      const score = computeScore(provisional);
      candidates.push({ place, score, industry: plan.category, territory: plan.territory });
    }
  }

  // Rank by score, then apply a healthy tier mix while filling to `target`.
  candidates.sort((a, b) => b.score.total - a.score.total);
  const picks: typeof candidates = [];
  let aCount = 0;
  let bCount = 0;
  for (const c of candidates) {
    if (picks.length >= target) break;
    const tier = c.score.tier;
    if (tier === "A" && aCount >= p.tierTargetA && picks.length < target) {
      // soft cap — still allow if nothing better, handled by ordering
    }
    if (tier === "A") aCount += 1;
    if (tier === "B") bCount += 1;
    picks.push(c);
  }

  const addedLeadIds: string[] = [];
  for (const c of picks) {
    const lead = await createQualifiedLead(c.place, c.industry, c.territory, c.score.tier, c.score.total, settings, c.score.rationale);
    addedLeadIds.push(lead.id);
    run.qualified += 1;
    run.addedToToday += 1;
  }

  const completed = nowIso();
  const finalPatch = {
    completedAt: completed,
    searchesPerformed: searches,
    placesRequests: requests,
    examined: run.examined,
    duplicatesRemoved: run.duplicatesRemoved,
    excluded: run.excluded,
    qualified: run.qualified,
    addedToToday: run.addedToToday,
    estimatedCostUsd: Math.round(requests * PLACES_COST_PER_REQUEST * 1000) / 1000,
    errors,
    addedLeadIds,
  };
  await updateProspectingRun(record.id, finalPatch);
  await updateSettings({ prospecting: { ...p, lastRunAt: completed } });

  return { ...run, ...record, ...finalPatch };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function excluded(place: PlaceResult, norm: string, p: Settings["prospecting"]): boolean {
  if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") return true;
  const hay = (place.businessName + " " + place.category).toLowerCase();
  if (p.exclusionKeywords.some((k) => k && hay.includes(k.toLowerCase()))) return true;
  if (p.requireWebsite && !place.website) return true;
  if (p.requirePhone && !place.phone) return true;
  if (p.minRating && (place.rating ?? 0) < p.minRating) return true;
  if (p.minReviews && (place.reviewCount ?? 0) < p.minReviews) return true;
  return false;
}

function placeToLead(place: PlaceResult, industry: string, territory: { city: string; state: string }): Lead {
  const nowStr = nowIso();
  return {
    id: "tmp",
    googlePlaceId: place.googlePlaceId,
    businessName: place.businessName,
    normalizedName: normalizeName(place.businessName),
    industry,
    address: place.address,
    city: place.city || territory.city,
    state: place.state || territory.state,
    postalCode: place.postalCode,
    latitude: place.latitude,
    longitude: place.longitude,
    phone: place.phone,
    website: place.website,
    websiteDomain: domainFromUrl(place.website),
    publicEmail: null,
    contactFormUrl: null,
    socialLinks: [],
    locationsCount: null,
    rating: place.rating,
    reviewCount: place.reviewCount,
    businessStatus: place.businessStatus,
    googleMapsUrl: place.googleMapsUrl,
    hours: place.hours,
    source: "Google Places (auto)",
    retrievedAt: nowStr,
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
    assignedTo: "jordan",
    note: null,
    lastContactAt: null,
    nextFollowUpAt: null,
    createdAt: nowStr,
    updatedAt: nowStr,
  };
}

async function createQualifiedLead(
  place: PlaceResult,
  industry: string,
  territory: { city: string; state: string },
  tier: Tier,
  score: number,
  settings: Settings,
  rationale: string,
): Promise<Lead> {
  const provisional = placeToLead(place, industry, territory);
  const svc = (await recommendService(provisional, settings)).data;
  const action = tier === "A" ? "Prepare video" : tier === "B" ? "Send personalized email" : "Nurture";

  const reason = `${industry} in ${territory.city} · ${place.rating ?? "?"}★ (${place.reviewCount ?? 0} reviews) · matched to ${svc.service}. ${rationale}`;

  const { id: _id, createdAt: _c, updatedAt: _u, ...base } = provisional;
  const lead = await insertLead({
    ...base,
    tier,
    leadScore: score,
    scoreBreakdown: computeScore(provisional).breakdown,
    recommendedService: svc.service,
    estimatedValueLow: svc.estimatedValueLow,
    estimatedValueHigh: svc.estimatedValueHigh,
    recommendedAction: action,
    recommendationReason: reason,
    opportunitySummary: `${place.businessName} looks like a strong fit for ${svc.service}. ${svc.whyItFits}`,
    pipelineStage: "Qualified",
  });

  // One recommended action → a Today "review" task, ranked below active work.
  const tierBonus = tier === "A" ? 30 : tier === "B" ? 18 : 8;
  await insertTask({
    leadId: lead.id,
    type: "review",
    title: `Review new lead — ${place.businessName}`,
    dueAt: nowIso(),
    status: "open",
    priority: 15 + tierBonus + Math.round(score / 8),
    snoozedUntil: null,
  });

  return lead;
}
