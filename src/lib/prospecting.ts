// ─────────────────────────────────────────────────────────────────────────────
// Diversified automatic daily lead engine.
//
// Fills Today up to the configured size with a HEALTHY MIX of categories — never
// dental-only. A rotation engine selects a varied, budget-bounded set of
// categories/territories each run (not the full Cartesian product), enforces
// per-category caps, and aims for ≥ N distinct categories among NEW cold
// prospects. Active work (follow-ups/meetings/proposals/warm leads) is untouched
// and always ranks above new prospects. Never contacts anyone. Never mocks in prod.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getSettings,
  updateSettings,
  findDuplicate,
  isSuppressed,
  insertLead,
  todaysTasks,
  insertProspectingRun,
  updateProspectingRun,
  listLeads,
  allTasks,
} from "./repo";
import { normalizeName, domainFromUrl, nowIso } from "./store";
import { searchPlaces, searchPlacesPaged, placesMode, type PlaceResult } from "./providers/places";
import { computeScore } from "./scoring";
import type { ProspectingRun, Lead, Settings, Tier, ProspectCategoryTarget, ArtifexService, CategoryGroup } from "./types";
import { discoverInputSchema } from "./schemas";
import { categoryGroupOf } from "./categories";
import { assignNewLead } from "./operators/distribute";
import { channelReadiness, channelDeficits, emailInventory, DEFAULT_CALL_TARGET, DEFAULT_EMAIL_TARGET, DEFAULT_VIDEO_TARGET, type ChannelReadiness } from "./work-queue";
import { planDiscovery } from "./acquisition/reservoir";
import { effectiveTerritories } from "./geo-pools";
import { discoveryTerritories, cooldownKey, DEFAULT_MARKET_POLICY } from "./market-policy";

export const PLACES_COST_PER_REQUEST = 0.032;

// Category group → primary/secondary Artifex service (evidence still refines it,
// but the group gives a sensible default match for every new category).
const SERVICE_BY_GROUP: Record<CategoryGroup, { primary: ArtifexService; secondary: string }> = {
  "Professional Services": { primary: "Business Website System", secondary: "AI-assisted consultation intake" },
  "Health and Wellness": { primary: "Business Website System", secondary: "Online booking + automated confirmations" },
  "Home and Property Services": { primary: "Automation Sprint", secondary: "Quote intake + scheduling / customer portal" },
  "Hospitality and Experiences": { primary: "Business Website System", secondary: "Inquiry + event intake workflow" },
  "Specialty Retail and Local Commerce": { primary: "Business Website System", secondary: "Visual Asset System / merchant tools" },
  "Automotive Services": { primary: "Automation Sprint", secondary: "Quote + appointment intake" },
  "Education and Training": { primary: "Business Website System", secondary: "Enrollment + student portal" },
  "Growth-Stage Businesses": { primary: "Product Strategy Engagement", secondary: "Product or MVP Build" },
};

export interface ProspectRequest {
  trigger: "scheduled" | "manual" | "refill" | "find-more" | "replace";
  count?: number;
}

const emptyRun = (trigger: string, mode: string): Omit<ProspectingRun, "id"> => ({
  startedAt: nowIso(),
  completedAt: null,
  trigger,
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
  categoriesConsidered: [],
  categoriesSelected: [],
  selectionReasons: {},
  byCategoryExamined: {},
  byCategoryAdded: {},
  rejectedByCap: 0,
  distinctCategoriesAdded: 0,
  diversityTargetAchieved: false,
  stopReason: null,
});

function resetWeekly(cats: ProspectCategoryTarget[]): ProspectCategoryTarget[] {
  const now = Date.now();
  return cats.map((c) => {
    if (!c.weekAnchor || now - +new Date(c.weekAnchor) > 7 * 86_400_000) {
      return { ...c, searchesThisWeek: 0, leadsFoundThisWeek: 0, leadsQualifiedThisWeek: 0, weekAnchor: nowIso() };
    }
    return c;
  });
}

function brandKey(normalizedName: string): string {
  return normalizedName.slice(0, 14); // multi-location heuristic
}

export async function runProspecting(req: ProspectRequest): Promise<ProspectingRun> {
  const settings = await getSettings();
  const p = settings.prospecting;
  const mode = placesMode();
  const run = emptyRun(req.trigger, mode);
  const record = await insertProspectingRun(run);
  const finalize = async (patch: Partial<ProspectingRun>) => {
    const merged = { ...run, ...record, ...patch, completedAt: nowIso() };
    await updateProspectingRun(record.id, { ...patch, completedAt: merged.completedAt });
    return merged;
  };

  // Production safety — never inject mock businesses.
  if (mode !== "google") {
    const msg = mode === "disabled"
      ? "Google Places disabled (no key). Existing Today tasks preserved; no businesses added."
      : "Discovery in mock mode (development). No real businesses added.";
    if (process.env.NODE_ENV === "production" || mode === "disabled") {
      return finalize({ errors: [msg], stopReason: "provider-unavailable" });
    }
  }

  const dueTasks = await todaysTasks();
  const currentTodayCount = dueTasks.length;
  const existing = await listLeads();

  // Active supply goals: a daily target means "attempt to have N legitimate items ready",
  // not "show at most N". The discovery target is the TOTAL positive deficit across the three
  // streams — but CALLS are NOT a supply goal. We no longer manufacture cold-call inventory to
  // hit "10 calls today"; calls should surface only when justified (a review was emailed, a
  // reply, prior context, or a strong no-email opportunity). Discovery therefore replenishes
  // EMAIL and VIDEO deficits only, so an empty email board pulls new email-capable leads while a
  // thin call board is left alone. The old combined floor (dailyQueueSize − what's already
  // queued) is preserved. Quality gates are untouched — discovery still only adds businesses that
  // pass scoring/exclusion, so a deficit is an ATTEMPT, never fabricated work; maxNewLeadsPerRun
  // and the cost budget still bound it.
  const leadMapForReadiness = new Map(existing.map((l) => [l.id, l] as const));
  const ready = channelReadiness(dueTasks, leadMapForReadiness);
  const targets: ChannelReadiness = {
    call: Math.max(0, p.callDailyTarget ?? DEFAULT_CALL_TARGET),
    email: Math.max(0, p.emailDailyTarget ?? DEFAULT_EMAIL_TARGET),
    video: Math.max(0, p.videoDailyTarget ?? DEFAULT_VIDEO_TARGET),
  };
  const deficits = channelDeficits(ready, targets);
  // Only the EMAIL reservoir pulls discovery. Calls have no cold-call quota, and VIDEO is now a
  // signal-triggered escalation (a reply, a warm/high-value opportunity) — never a 3/3 quota, so
  // we never manufacture prospects merely to fill video capacity. Video supply follows real signals.
  const totalDeficit = deficits.email;
  const boardFloor = Math.max(p.dailyQueueSize - currentTodayCount, totalDeficit);

  // DEMAND-AWARE DISCOVERY: size supply from RESERVOIR health, not just the board's email deficit.
  // Production evidence showed each run finds ~120 qualified businesses but adds only 8 (rejecting
  // ~100 already-paid candidates) while spending 16% of the Places budget. So when the reservoir is
  // low/critical we CAPTURE more of the top-scored candidates the same searches already returned
  // (no extra Places cost, quality unchanged — highest-fit-first); when healthy we THROTTLE so we
  // never pay to find businesses we don't need. `req.count` (explicit manual asks) still wins.
  const openReviewTasks = (await allTasks()).filter((t) => t.status === "open");
  const preparedReservoir = emailInventory({ leads: existing, tasks: openReviewTasks, emailsSentToday: 0, sendTarget: targets.email }).prepared;
  const discovery = planDiscovery({ prepared: preparedReservoir, floorLeads: boardFloor });
  const target = Math.max(0, req.count ?? discovery.targetLeads);
  // Reservoir-aware per-run bounds (override the conservative fixed caps; examining returned places
  // is free, and picks remain highest-fit-first through the existing gates).
  const perCategoryCap = req.count ? p.maxPerCategoryPerRun : discovery.perCategoryCap;
  const examineCap = req.count ? p.maxExaminedPerRun : Math.max(p.maxExaminedPerRun, discovery.examineCap);
  if (target <= 0) {
    await updateSettings({ prospecting: { ...p, lastRunAt: nowIso() } });
    return finalize({ stopReason: preparedReservoir >= 20 ? "reservoir-healthy" : "queue-full" });
  }

  // ── Rotation: score + select a diverse, budget-bounded category set ─────────
  const categories = resetWeekly(p.categories ?? []);
  const pipelineByCat = concentration(existing.map((l) => l.normalizedCategory));
  const todayLeadIds = new Set(dueTasks.map((t) => t.leadId));
  const todayByCat = concentration(existing.filter((l) => todayLeadIds.has(l.id)).map((l) => l.normalizedCategory));
  const totalLeads = Math.max(1, existing.length);

  // Effective per-category WEEKLY retention cap: reservoir-aware (diversity-safe) — it can exceed the
  // conservative configured cap when rebuilding so we KEEP more of the excellent supply we already
  // find, but a category is still bounded per week (no monopoly). A manual req.count respects the
  // operator's exact configured cap. Never below the configured value.
  const weeklyCapFor = (c: ProspectCategoryTarget) => req.count ? c.weeklyNewLeadCap : Math.max(c.weeklyNewLeadCap, discovery.weeklyCap);
  const eligible = categories.filter((c) => c.enabled && !isPaused(c) && c.leadsFoundThisWeek < weeklyCapFor(c));
  const ranked = eligible
    .map((c) => ({ c, w: categoryWeight(c, pipelineByCat, todayByCat, totalLeads) }))
    .sort((a, b) => b.w - a.w);

  // Cost budget → how many categories (1 territory each) we can search. When REBUILDING the
  // reservoir we search more categories (more diverse candidates), but NEVER beyond the existing
  // authorized cost budget (byCost = maxDailyCostUsd / cost-per-request). Healthy → the economical
  // legacy cap. This uses more of the ALREADY-authorized $ budget; it does not raise it.
  const byCost = Math.floor(p.maxDailyCostUsd / PLACES_COST_PER_REQUEST);
  const categoryCap = req.count ? p.maxCategoriesPerRun : Math.max(p.maxCategoriesPerRun, Math.min(discovery.targetLeads, byCost, eligible.length));
  const requestCap = Math.max(1, Math.min(categoryCap, p.dailyRequestBudget, byCost));

  // Select ACROSS GROUPS (round-robin) so the search set spans many groups rather
  // than clustering in whichever group has the most high-priority categories.
  const byGroup = new Map<string, Array<{ c: ProspectCategoryTarget; w: number }>>();
  for (const e of ranked) {
    if (!byGroup.has(e.c.group)) byGroup.set(e.c.group, []);
    byGroup.get(e.c.group)!.push(e);
  }
  const selected: Array<{ c: ProspectCategoryTarget; w: number }> = [];
  const perGroup: Record<string, number> = {};
  let progressed = true;
  while (selected.length < requestCap && progressed) {
    progressed = false;
    const groups = [...byGroup.keys()].sort((a, b) => (byGroup.get(b)![perGroup[b] ?? 0]?.w ?? -1) - (byGroup.get(a)![perGroup[a] ?? 0]?.w ?? -1));
    for (const g of groups) {
      if (selected.length >= requestCap) break;
      const idx = perGroup[g] ?? 0;
      const arr = byGroup.get(g)!;
      if (idx >= arr.length) continue;
      selected.push(arr[idx]);
      perGroup[g] = idx + 1;
      progressed = true;
    }
  }
  const skippedForBudget = ranked.length - selected.length;

  // SMALL-MARKET discovery (mandate 26 §4): the operator's local coverage (excluded primaries dropped) PLUS a
  // rotating, region-diverse slice of in-policy SECONDARY/TERTIARY markets — deliberately away from saturated
  // major metros (LA/Denver/etc.). Cost is UNCHANGED — territories only cycle across the already budget-bounded
  // category searches (one territory per search). Rotation is keyed to the lead count so different markets
  // surface each run; a market/category cooldown ledger prevents repetitive discovery.
  const marketCfg = p.marketPolicy ?? DEFAULT_MARKET_POLICY;
  const cooldownMs = Math.max(0, marketCfg.cooldownDays) * 86_400_000;
  const cutoff = Date.now() - cooldownMs;
  const priorLedger = (p.recentMarketSearches ?? []).filter((e) => +new Date(e.at) >= cutoff);
  const recentPairs = new Set(priorLedger.map((e) => e.key));
  const recentMarkets = new Set(priorLedger.map((e) => e.market));
  const disco = discoveryTerritories({ configured: p.territories, cursor: existing.length, recent: recentPairs, recentMarkets, cfg: marketCfg });
  const territories = disco.territories.length ? disco.territories : effectiveTerritories(p.territories, existing.length);
  const terrOffset = existing.length % territories.length;
  const searchedPairs: Array<{ key: string; market: string; category: string; at: string }> = [];

  const candidates: Array<{ place: PlaceResult; score: ReturnType<typeof computeScore>; cat: ProspectCategoryTarget }> = [];
  const seenName = new Set(existing.map((l) => l.normalizedName));
  const seenBrand = new Set(existing.map((l) => brandKey(l.normalizedName)));
  const byCategoryExamined: Record<string, number> = {};
  const selectionReasons: Record<string, string> = {};
  let searches = 0, requests = 0, examined = 0, excluded = 0, dupes = 0;
  const errors: string[] = [];
  let stopReason: string | null = null;

  // ── Pagination: walk nextPageToken to raise raw supply per query when the reservoir is being
  // rebuilt. This does NOT change eligibility, dedup, scoring, or picking — it only feeds more
  // candidates into the SAME gates. It is bounded three ways so we never collect data without need:
  //   1) the run already returned early above when the reservoir is healthy (target ≤ 0);
  //   2) each page is a billable request counted against p.dailyRequestBudget;
  //   3) per-query and per-run targets stop pagination as soon as target + reserve is satisfied.
  const maxPagesCfg = Math.max(1, Math.floor(Number(process.env.PLACES_MAX_PAGES ?? 3)));
  const pageDelayMs = Math.max(0, Number(process.env.PLACES_PAGE_DELAY_MS ?? 2000));
  const reserve = Math.ceil(target * 0.5); // a reasonable next-day buffer above the run target

  for (let i = 0; i < selected.length; i++) {
    if (examined >= examineCap) { stopReason = "max-examined"; break; }
    if (requests >= p.dailyRequestBudget) { stopReason = "request-budget"; break; }
    const cat = selected[i].c;
    selectionReasons[cat.label] = reasonFor(cat, pipelineByCat[cat.normalizedCategory] ?? 0, totalLeads);
    const territory = territories[(terrOffset + i) % territories.length];
    // Record the (market, category) pair for the cooldown ledger so future runs rotate away from it.
    searchedPairs.push({ key: cooldownKey(territory.city, territory.state, cat.normalizedCategory), market: `${territory.city.toLowerCase()}|${territory.state.toUpperCase()}`, category: cat.normalizedCategory, at: nowIso() });
    const query = cat.searchQueries[0] ?? cat.label;
    const parsed = discoverInputSchema.safeParse({
      category: query,
      city: territory.city,
      state: territory.state,
      radiusMiles: p.radiusMiles,
      minRating: cat.minRatingOverride ?? p.minRating,
      minReviews: cat.minReviewsOverride ?? p.minReviews,
      requireWebsite: cat.requireWebsiteOverride ?? p.requireWebsite,
      requirePhone: cat.requirePhoneOverride ?? p.requirePhone,
    });
    if (!parsed.success) continue;
    searches += 1;
    // Per-query page budget: never exceed the run's remaining request budget, and stop paginating
    // this query once we have enough raw supply for the remaining need + reserve.
    const remainingReqBudget = Math.max(1, p.dailyRequestBudget - requests);
    const pagesThisQuery = Math.max(1, Math.min(maxPagesCfg, remainingReqBudget));
    const remainingNeed = Math.max(1, (target + reserve) - candidates.length);
    const perQueryTarget = Math.min(remainingNeed, 20 * pagesThisQuery);
    const result = await searchPlacesPaged(parsed.data, { maxPages: pagesThisQuery, targetResults: perQueryTarget, pageDelayMs });
    requests += result.requestsMade; // billable pages actually issued (0 for mock/disabled)
    if (!result.success) {
      if (result.error) errors.push(`${cat.label}: ${result.error.googleStatus ?? result.error.message}`);
      continue;
    }
    if (result.partialError) errors.push(`${cat.label}: partial page failure (${result.partialError.googleStatus ?? result.partialError.httpStatus ?? "unknown"})`);
    for (const place of result.results) {
      examined += 1;
      byCategoryExamined[cat.label] = (byCategoryExamined[cat.label] ?? 0) + 1;
      const norm = normalizeName(place.businessName);
      const bk = brandKey(norm);
      if (excludedPlace(place, cat, p)) { excluded += 1; continue; }
      if (seenName.has(norm) || seenBrand.has(bk)) { dupes += 1; continue; }
      if (await findDuplicate({ googlePlaceId: place.googlePlaceId, website: place.website, phone: place.phone, businessName: place.businessName })) { dupes += 1; continue; }
      if (await isSuppressed({ email: null, domain: domainFromUrl(place.website), phone: place.phone })) { excluded += 1; continue; }
      seenName.add(norm); seenBrand.add(bk);
      const provisional = placeToLead(place, cat, territory);
      candidates.push({ place, score: computeScore(provisional), cat });
    }
    // Reservoir target + reserve satisfied → stop collecting; don't fetch data we don't need.
    if (candidates.length >= target + reserve) { stopReason = "target-and-reserve-met"; break; }
  }

  // ── Diversified fill: cap per category, aim for distinct categories ─────────
  // Per-category cap is reservoir-aware: when REBUILDING we lift the conservative per-run DAILY cap
  // (which was sized for the old add-8/day model) so the target fills from candidates already found,
  // but the per-category WEEKLY cap STILL bounds it — the anti-concentration protection is untouched.
  // A manual request (req.count) respects the operator's exact configured caps.
  const capFor = (c: ProspectCategoryTarget) => {
    const weeklyRemaining = Math.max(0, weeklyCapFor(c) - c.leadsFoundThisWeek);
    return req.count
      ? Math.min(perCategoryCap, c.dailyNewLeadCap, weeklyRemaining)
      : Math.min(perCategoryCap, weeklyRemaining);
  };
  const { picked: picks, rejectedByCap } = pickDiverse(
    candidates.map((c) => ({ item: c, category: c.cat.normalizedCategory, score: c.score.total })),
    { target, capFor: (key) => capFor(candidates.find((c) => c.cat.normalizedCategory === key)!.cat) },
  );

  const distinctCategories = new Set(picks.map((x) => x.cat.normalizedCategory)).size;
  const diversityTargetAchieved = distinctCategories >= Math.min(p.minDistinctCategories, target);
  if (!stopReason) stopReason = picks.length >= target ? "queue-filled" : "insufficient-qualified";
  if (!diversityTargetAchieved && picks.length > 0) {
    errors.push(`Diversity target not fully met: ${distinctCategories} distinct categories (target ${p.minDistinctCategories}). Broaden enabled categories or territories.`);
  }
  if (skippedForBudget > 0) errors.push(`${skippedForBudget} eligible categories skipped this run to stay within the request budget.`);

  // ── Create leads + tasks; update category counters ──────────────────────────
  const addedLeadIds: string[] = [];
  const byCategoryAdded: Record<string, number> = {};
  const counters: Record<string, { found: number }> = {};
  for (const cand of picks) {
    const lead = await createQualifiedLead(cand.place, cand.cat, settings, cand.score);
    addedLeadIds.push(lead.id);
    byCategoryAdded[cand.cat.label] = (byCategoryAdded[cand.cat.label] ?? 0) + 1;
    counters[cand.cat.id] = { found: (counters[cand.cat.id]?.found ?? 0) + 1 };
  }

  const now = nowIso();
  const updatedCats = categories.map((c) => {
    const searchedThisRun = selected.some((s) => s.c.id === c.id);
    const added = counters[c.id]?.found ?? 0;
    if (!searchedThisRun && !added) return c;
    return {
      ...c,
      lastSearchedAt: searchedThisRun ? now : c.lastSearchedAt,
      searchesThisWeek: c.searchesThisWeek + (searchedThisRun ? 1 : 0),
      leadsFoundThisWeek: c.leadsFoundThisWeek + added,
      leadsQualifiedThisWeek: c.leadsQualifiedThisWeek + added,
    };
  });
  // Persist the market/category cooldown ledger (pruned to the cooldown window; capped so it never grows
  // unbounded). This is the "recently searched market/category ledger" that prevents repetitive discovery.
  const mergedLedger = [...priorLedger, ...searchedPairs]
    .filter((e) => +new Date(e.at) >= Date.now() - cooldownMs)
    .slice(-500);
  await updateSettings({ prospecting: { ...p, categories: updatedCats, lastRunAt: now, recentMarketSearches: mergedLedger } });

  return finalize({
    searchesPerformed: searches,
    placesRequests: requests,
    examined,
    duplicatesRemoved: dupes,
    excluded,
    qualified: picks.length,
    addedToToday: picks.length,
    estimatedCostUsd: Math.round(requests * PLACES_COST_PER_REQUEST * 1000) / 1000,
    errors,
    addedLeadIds,
    categoriesConsidered: eligible.map((c) => c.label),
    categoriesSelected: selected.map((s) => s.c.label),
    selectionReasons,
    byCategoryExamined,
    byCategoryAdded,
    rejectedByCap,
    distinctCategoriesAdded: distinctCategories,
    diversityTargetAchieved,
    stopReason,
  });
}

// Pure, testable diversified fill: highest score first, enforcing a per-category
// cap so no single category dominates. Returns picks (with original item) + count
// rejected purely for exceeding a category cap.
export function pickDiverse<T>(
  entries: Array<{ item: T; category: string; score: number }>,
  opts: { target: number; capFor: (category: string) => number },
): { picked: T[]; rejectedByCap: number } {
  // Group by category, best-first within each group.
  const groups = new Map<string, Array<{ item: T; score: number }>>();
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category)!.push({ item: e.item, score: e.score });
  }
  for (const g of groups.values()) g.sort((a, b) => b.score - a.score);

  const picked: T[] = [];
  const perCat: Record<string, number> = {};
  // Round-robin: take the best remaining from each category per round (round 1 =
  // one per category → maximizes distinct categories), then second, up to the cap.
  let progressed = true;
  let round = 0;
  while (picked.length < opts.target && progressed && round < 50) {
    progressed = false;
    const cats = [...groups.keys()].sort((a, b) => (groups.get(b)![perCat[b] ?? 0]?.score ?? -1) - (groups.get(a)![perCat[a] ?? 0]?.score ?? -1));
    for (const c of cats) {
      if (picked.length >= opts.target) break;
      const idx = perCat[c] ?? 0;
      const g = groups.get(c)!;
      if (idx >= g.length || idx >= opts.capFor(c)) continue;
      picked.push(g[idx].item);
      perCat[c] = idx + 1;
      progressed = true;
    }
    round += 1;
  }
  // Candidates that could never be picked because they exceed the per-category cap.
  let rejectedByCap = 0;
  for (const [c, g] of groups) rejectedByCap += Math.max(0, g.length - opts.capFor(c));
  return { picked, rejectedByCap };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function concentration(cats: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cats) if (c) out[c] = (out[c] ?? 0) + 1;
  return out;
}
function isPaused(c: ProspectCategoryTarget): boolean {
  return Boolean(c.pausedUntil && +new Date(c.pausedUntil) > Date.now());
}
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 } as const;
function categoryWeight(c: ProspectCategoryTarget, pipelineByCat: Record<string, number>, todayByCat: Record<string, number>, total: number): number {
  const priority = PRIORITY_WEIGHT[c.priority];
  const daysSince = c.lastSearchedAt ? (Date.now() - +new Date(c.lastSearchedAt)) / 86_400_000 : 30;
  const recency = Math.min(daysSince, 14) / 14; // 0..1, older = higher
  const pipeShare = (pipelineByCat[c.normalizedCategory] ?? 0) / total;
  const todayShare = (todayByCat[c.normalizedCategory] ?? 0) / total;
  const underrep = 1 - Math.min(1, pipeShare * 2 + todayShare); // lower concentration → higher
  return priority * 2 + recency * 2 + underrep * 3;
}
function reasonFor(c: ProspectCategoryTarget, pipeCount: number, total: number): string {
  const share = Math.round((pipeCount / total) * 100);
  const bits = [`${c.priority} priority`];
  if (!c.lastSearchedAt) bits.push("not searched recently");
  bits.push(`${share}% of pipeline`);
  return bits.join(" · ");
}
function excludedPlace(place: PlaceResult, cat: ProspectCategoryTarget, p: Settings["prospecting"]): boolean {
  if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") return true;
  const hay = (place.businessName + " " + place.category).toLowerCase();
  const kws = [...p.exclusionKeywords, ...cat.excludedKeywords];
  if (kws.some((k) => k && hay.includes(k.toLowerCase()))) return true;
  const minRating = cat.minRatingOverride ?? p.minRating;
  const minReviews = cat.minReviewsOverride ?? p.minReviews;
  if (minRating && (place.rating ?? 0) < minRating) return true;
  if (minReviews && (place.reviewCount ?? 0) < minReviews) return true;
  if ((cat.requireWebsiteOverride ?? p.requireWebsite) && !place.website) return true;
  if ((cat.requirePhoneOverride ?? p.requirePhone) && !place.phone) return true;
  return false;
}

function placeToLead(place: PlaceResult, cat: ProspectCategoryTarget, territory: { city: string; state: string }): Lead {
  const s = nowIso();
  return {
    id: "tmp",
    googlePlaceId: place.googlePlaceId,
    businessName: place.businessName,
    normalizedName: normalizeName(place.businessName),
    industry: cat.label,
    normalizedCategory: cat.normalizedCategory,
    categoryGroup: cat.group,
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
    assignedTo: null,
    assignedAt: null,
    assignmentReason: null,
    lastOperatorActivityAt: null,
    note: null,
    lastContactAt: null,
    nextFollowUpAt: null,
    createdAt: s,
    updatedAt: s,
  };
}

async function createQualifiedLead(place: PlaceResult, cat: ProspectCategoryTarget, settings: Settings, score: ReturnType<typeof computeScore>): Promise<Lead> {
  const provisional = placeToLead(place, cat, { city: place.city, state: place.state });
  const match = SERVICE_BY_GROUP[cat.group as CategoryGroup] ?? SERVICE_BY_GROUP["Professional Services"];
  const price = settings.defaultPricing[match.primary];
  const tier = score.tier;
  const action = tier === "A" ? "Prepare video" : tier === "B" ? "Send personalized email" : "Nurture";
  const reason = `${cat.label} in ${place.city || "the area"} · ${place.rating ?? "?"}★ (${place.reviewCount ?? 0} reviews) · ${cat.group} → matched to ${match.primary} (evidence refines on analysis). Secondary: ${match.secondary}.`;

  const { id: _i, createdAt: _c, updatedAt: _u, ...basewithout } = provisional;
  const lead = await insertLead({
    ...basewithout,
    tier,
    leadScore: score.total,
    scoreBreakdown: score.breakdown,
    recommendedService: match.primary,
    estimatedValueLow: price.low,
    estimatedValueHigh: price.high,
    recommendedAction: action,
    recommendationReason: reason,
    opportunitySummary: `${place.businessName} is a promising ${cat.group.toLowerCase()} fit for ${match.primary}.`,
    pipelineStage: "Qualified",
  });

  // The system has already understood and qualified this business, so it does NOT wait in
  // a "New businesses to understand" placeholder for a human to rubber-stamp. It is routed
  // straight to its first-touch execution stream (Calls / Emails / Videos) by contact
  // strategy; only a lead with no verifiable channel becomes a Needs-attention question.
  const { routeNewLead } = await import("./outreach/auto-route");
  await routeNewLead(lead);
  // Prospecting runs unattended, so a newly discovered business is given an
  // accountable operator immediately rather than waiting in an unassigned pile.
  await assignNewLead(lead.id, { actor: "system" });
  return lead;
}

export { categoryGroupOf };
