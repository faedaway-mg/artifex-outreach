// ─────────────────────────────────────────────────────────────────────────────
// Google Places adapter (Places API — New: places:searchText).
//
// Mode is decided PER REQUEST from process.env — never memoized at module load:
//   • google   — GOOGLE_PLACES_API_KEY present → real Google results.
//   • mock      — no key AND (not production OR ALLOW_MOCK_PLACES=true).
//   • disabled  — no key in production → live discovery is off; NO mock substituted.
//
// Google errors are surfaced as structured errors. We NEVER silently substitute
// mock businesses for real ones, and never expose the API key or request headers.
// ─────────────────────────────────────────────────────────────────────────────
import type { DiscoverInput } from "../schemas";

export type PlacesMode = "google" | "mock" | "disabled";

export interface PlaceResult {
  googlePlaceId: string;
  businessName: string;
  category: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string;
  googleMapsUrl: string;
  hours: string | null;
}

export interface PlacesError {
  provider: string;
  success: false;
  httpStatus: number | null;
  googleStatus: string | null;
  message: string;
  timestamp: string;
}

export interface PlacesSearchResult {
  provider: "google" | "mock" | "none";
  mode: PlacesMode;
  success: boolean;
  results: PlaceResult[];
  count: number;
  attribution: string;
  timestamp: string;
  filtersApplied: boolean;
  pagination: boolean;
  error?: PlacesError;
}

const ATTRIBUTION = "Business data from Google. Powered by Google Places.";
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/** Per-request mode decision. Read at call time so it can never go stale. */
export function placesMode(): PlacesMode {
  if (process.env.GOOGLE_PLACES_API_KEY) return "google";
  if (process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_PLACES === "true") return "mock";
  return "disabled";
}

// ── Cost control / throttle (per running instance) ───────────────────────────
const CALL_STATE = ((): { count: number; windowStart: number; last: number } => {
  const g = globalThis as any;
  if (!g.__places_calls__) g.__places_calls__ = { count: 0, windowStart: Date.now(), last: 0 };
  return g.__places_calls__;
})();

function withinBudget(): boolean {
  const cap = Number(process.env.GOOGLE_PLACES_DAILY_CAP ?? 500);
  if (Date.now() - CALL_STATE.windowStart > 86_400_000) {
    CALL_STATE.windowStart = Date.now();
    CALL_STATE.count = 0;
  }
  return CALL_STATE.count < cap;
}

function hasFilters(input: DiscoverInput): boolean {
  return Boolean(input.minRating || input.minReviews || input.requireWebsite || input.requirePhone || input.keyword);
}

function applyFilters(results: PlaceResult[], input: DiscoverInput): PlaceResult[] {
  return results.filter((r) => {
    if (input.minRating && (r.rating ?? 0) < input.minRating) return false;
    if (input.minReviews && (r.reviewCount ?? 0) < input.minReviews) return false;
    if (input.requireWebsite && !r.website) return false;
    if (input.requirePhone && !r.phone) return false;
    if (input.keyword && !r.businessName.toLowerCase().includes(input.keyword.toLowerCase())) return false;
    return true;
  });
}

// ── Mock generator (clearly labeled; dev only) ───────────────────────────────
const NAME_BANK: Record<string, string[]> = {
  dental: ["Bright Smile Dental", "Cedar Park Dentistry", "Lakeview Family Dental", "Summit Dental Care"],
  law: ["Anchor Legal Group", "Westside Law Partners", "Harbor & Vance LLP", "Redwood Legal"],
  fitness: ["Ironworks Fitness", "Pulse Studio", "Northgate Athletic Club", "Elevate Pilates"],
  plumbing: ["Reliable Rooter", "AllFlow Plumbing", "Summit Home Services", "BlueLine Plumbing & HVAC"],
  consultant: ["Marlowe Advisory", "Peak Strategy Co.", "Juniper Consulting", "Kestrel Partners"],
  retail: ["Maple & Co. Goods", "The Corner Provisions", "Fieldnote Supply", "Harborlight Home"],
  default: ["Downtown Business Co.", "Central Ave Services", "Parkside Group", "Meridian & Main"],
};

function bankFor(category: string): string[] {
  const c = category.toLowerCase();
  if (c.includes("dent")) return NAME_BANK.dental;
  if (c.includes("law") || c.includes("attorney") || c.includes("legal")) return NAME_BANK.law;
  if (c.includes("fit") || c.includes("gym") || c.includes("yoga") || c.includes("pilates")) return NAME_BANK.fitness;
  if (c.includes("plumb") || c.includes("hvac") || c.includes("roof") || c.includes("electric")) return NAME_BANK.plumbing;
  if (c.includes("consult") || c.includes("advis") || c.includes("coach")) return NAME_BANK.consultant;
  if (c.includes("retail") || c.includes("shop") || c.includes("store") || c.includes("boutique")) return NAME_BANK.retail;
  return NAME_BANK.default;
}

function mockSearch(input: DiscoverInput): PlaceResult[] {
  const names = bankFor(input.category);
  const city = input.city || "Los Angeles";
  const state = input.state || "CA";
  const zip = input.postalCode || "90012";
  return names.map((name, i) => {
    const rating = 3.8 + ((name.length + i) % 12) / 10;
    const reviews = 20 + ((name.length * (i + 3)) % 380);
    const hasWebsite = (name.length + i) % 4 !== 0;
    const hasPhone = (name.length + i) % 5 !== 0;
    const domain = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      googlePlaceId: `MOCK_${domain.slice(0, 10)}${i}`,
      businessName: `[MOCK] ${name}`,
      category: input.category,
      address: `${100 + i * 40} Main St`,
      city,
      state,
      postalCode: zip,
      latitude: 34.05 + i * 0.01,
      longitude: -118.24 - i * 0.01,
      phone: hasPhone ? `(213) 555-0${(100 + i * 7).toString().slice(0, 3)}` : null,
      website: hasWebsite ? `https://${domain}.example` : null,
      rating: Math.round(rating * 10) / 10,
      reviewCount: reviews,
      businessStatus: "OPERATIONAL",
      googleMapsUrl: `https://maps.google.com/?cid=${domain}`,
      hours: "Mon–Fri 9–5",
    };
  });
}

// ── Google response mapping (Places API — New field names) ───────────────────
function mapGooglePlace(p: any, input: DiscoverInput): PlaceResult {
  return {
    googlePlaceId: p.id,
    businessName: p.displayName?.text ?? "Unknown",
    category: p.primaryType ?? (Array.isArray(p.types) ? p.types[0] : undefined) ?? input.category,
    address: p.formattedAddress ?? "",
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    businessStatus: p.businessStatus ?? "OPERATIONAL",
    googleMapsUrl: p.googleMapsUri ?? "",
    hours: normalizeOpeningHours(p.regularOpeningHours),
  };
}

/**
 * Normalize Places API v1 `regularOpeningHours` into the newline-joined "weekday_text"
 * shape the businessHours parser already understands ("Monday: 9:00 AM – 5:00 PM",
 * "Sunday: Closed"). Returns null when hours are absent — UNKNOWN must stay UNKNOWN, so
 * knownClosedNow never withholds a business we simply have no data for. No fabrication.
 */
export function normalizeOpeningHours(regular: any): string | null {
  const days = regular?.weekdayDescriptions;
  if (!Array.isArray(days) || days.length === 0) return null;
  const joined = days.filter((d: unknown) => typeof d === "string" && d.trim()).join("\n").trim();
  return joined || null;
}

function base(mode: PlacesMode, timestamp: string, filtersApplied: boolean) {
  return { mode, attribution: ATTRIBUTION, timestamp, filtersApplied, pagination: false };
}

/** Deterministic text query used for both a single search and a paginated one. */
function buildTextQuery(input: DiscoverInput): string {
  return [input.keyword, input.category, input.city, input.state, input.postalCode].filter(Boolean).join(" ");
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.googleMapsUri",
  "places.regularOpeningHours.weekdayDescriptions",
  "nextPageToken",
].join(",");

interface GooglePage {
  mapped: PlaceResult[];
  nextPageToken: string | null;
  httpStatus: number | null;
  error?: PlacesError;
}

/**
 * ONE Google Places (New) text-search request. `pageToken`, when present, requests the
 * continuation page of the SAME query. Increments the per-instance call counter (each page
 * is a billable request). Never substitutes mock results; never exposes the key/headers.
 */
async function googleTextSearch(query: string, input: DiscoverInput, pageToken: string | null): Promise<GooglePage> {
  const timestamp = new Date().toISOString();
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 20 };
  if (pageToken) body.pageToken = pageToken;
  try {
    CALL_STATE.count += 1;
    CALL_STATE.last = Date.now();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY as string,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        mapped: [],
        nextPageToken: null,
        httpStatus: res.status,
        error: {
          provider: "google",
          success: false,
          httpStatus: res.status,
          googleStatus: data?.error?.status ?? null,
          message: sanitize(data?.error?.message) || `Google Places request failed (HTTP ${res.status}).`,
          timestamp,
        },
      };
    }
    const mapped = (Array.isArray(data.places) ? data.places : []).map((p: any) => mapGooglePlace(p, input));
    return { mapped, nextPageToken: typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null, httpStatus: res.status };
  } catch {
    return {
      mapped: [],
      nextPageToken: null,
      httpStatus: null,
      error: {
        provider: "google",
        success: false,
        httpStatus: null,
        googleStatus: null,
        message: "Network error contacting Google Places. No mock results were substituted.",
        timestamp,
      },
    };
  }
}

export async function searchPlaces(input: DiscoverInput): Promise<PlacesSearchResult> {
  const mode = placesMode();
  const timestamp = new Date().toISOString();
  const filtersApplied = hasFilters(input);

  // ── disabled: production without a key. No mock substitution. ──────────────
  if (mode === "disabled") {
    return {
      provider: "none",
      success: false,
      results: [],
      count: 0,
      ...base(mode, timestamp, filtersApplied),
      error: {
        provider: "none",
        success: false,
        httpStatus: null,
        googleStatus: null,
        message: "Live discovery is disabled: no Google Places API key is configured.",
        timestamp,
      },
    };
  }

  // ── mock: dev / explicitly allowed. Clearly labeled, not real. ─────────────
  if (mode === "mock") {
    const results = applyFilters(mockSearch(input), input);
    return { provider: "mock", success: true, results, count: results.length, ...base(mode, timestamp, filtersApplied) };
  }

  // ── google ─────────────────────────────────────────────────────────────────
  if (!withinBudget()) {
    return {
      provider: "google",
      success: false,
      results: [],
      count: 0,
      ...base(mode, timestamp, filtersApplied),
      error: {
        provider: "google",
        success: false,
        httpStatus: null,
        googleStatus: "RESOURCE_EXHAUSTED",
        message: "Daily Google Places request cap reached. No mock results were substituted.",
        timestamp,
      },
    };
  }

  const page = await googleTextSearch(buildTextQuery(input), input, null);
  if (page.error) {
    return { provider: "google", success: false, results: [], count: 0, ...base(mode, timestamp, filtersApplied), error: page.error };
  }
  const results = applyFilters(page.mapped, input);
  return {
    provider: "google",
    success: true,
    results,
    count: results.length,
    ...base(mode, timestamp, filtersApplied),
    pagination: Boolean(page.nextPageToken),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination — walk nextPageToken up to a strict page budget, stopping as soon as
// the operational target is met (never collecting data without a need). Cross-page
// dedup on place id / domain / phone / name+address. Same eligibility filters as the
// single search; NEVER contacts a business, invents an email, or substitutes mock.
// ─────────────────────────────────────────────────────────────────────────────
export type PagedStopReason = "target-met" | "max-pages" | "no-token" | "budget" | "error" | "single-page";

export interface PagedSearchOptions {
  /** Hard cap on pages per query (Google returns ≤20/page). Default env PLACES_MAX_PAGES or 3. */
  maxPages?: number;
  /** Stop early once this many eligible (filtered, deduped) results are collected. Default ∞. */
  targetResults?: number;
  /** Provider token-readiness delay before each continuation page. Default env PLACES_PAGE_DELAY_MS or 2000. */
  pageDelayMs?: number;
  /** Extra retries when a continuation token is not yet ready (INVALID_ARGUMENT/400). Default 1. */
  tokenRetries?: number;
  /** Retries for transient errors (HTTP 429/5xx). Default 1. */
  transientRetries?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Bypass the query cache for this call. */
  noCache?: boolean;
}

export interface PagedSearchResult extends PlacesSearchResult {
  pagesFetched: number;
  /** Billable Google requests actually issued (includes retries) — for cost accounting. */
  requestsMade: number;
  duplicatesAcrossPages: number;
  cached: boolean;
  stopReason: PagedStopReason;
  /** Present when a later page failed but earlier pages returned usable results (partial success). */
  partialError?: PlacesError;
}

function normText(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function normPhoneDigits(p: string | null): string {
  return (p ?? "").replace(/\D/g, "");
}
function domainOfUrl(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Dedupe results that overlap across pages, on ANY strong identity key: place id, website
 * domain, phone digits, or (business name AND address) together. A chain with the same name
 * at a DIFFERENT address is kept (distinct business); a repeat of the same listing is dropped.
 */
export function dedupeAcrossPages(results: PlaceResult[]): { unique: PlaceResult[]; duplicates: number } {
  const ids = new Set<string>();
  const domains = new Set<string>();
  const phones = new Set<string>();
  const nameAddrs = new Set<string>();
  const unique: PlaceResult[] = [];
  let duplicates = 0;
  for (const r of results) {
    const id = r.googlePlaceId || "";
    const dom = domainOfUrl(r.website);
    const ph = normPhoneDigits(r.phone);
    const na = `${normText(r.businessName)}|${normText(r.address)}`;
    const isDup =
      (id && ids.has(id)) ||
      (dom && domains.has(dom)) ||
      (ph && phones.has(ph)) ||
      (normText(r.businessName) && normText(r.address) && nameAddrs.has(na));
    if (isDup) {
      duplicates += 1;
      continue;
    }
    if (id) ids.add(id);
    if (dom) domains.add(dom);
    if (ph) phones.add(ph);
    if (normText(r.businessName) && normText(r.address)) nameAddrs.add(na);
    unique.push(r);
  }
  return { unique, duplicates };
}

// ── Query-result cache (per instance; TTL-bounded) — avoids re-billing identical queries. ──
const PLACES_CACHE = ((): Map<string, { at: number; val: PagedSearchResult }> => {
  const g = globalThis as any;
  if (!g.__places_query_cache__) g.__places_query_cache__ = new Map();
  return g.__places_query_cache__;
})();
function cacheTtlMs(): number {
  return Number(process.env.PLACES_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
}
export function clearPlacesCache(): void {
  PLACES_CACHE.clear();
}

function isTokenNotReady(page: GooglePage): boolean {
  return page.httpStatus === 400 || page.error?.googleStatus === "INVALID_ARGUMENT";
}
function isTransient(page: GooglePage): boolean {
  return page.httpStatus === 429 || (page.httpStatus != null && page.httpStatus >= 500);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function searchPlacesPaged(input: DiscoverInput, opts: PagedSearchOptions = {}): Promise<PagedSearchResult> {
  const mode = placesMode();
  const timestamp = new Date().toISOString();
  const filtersApplied = hasFilters(input);
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? Number(process.env.PLACES_MAX_PAGES ?? 3)));
  const targetResults = opts.targetResults ?? Infinity;
  const pageDelayMs = Math.max(0, opts.pageDelayMs ?? Number(process.env.PLACES_PAGE_DELAY_MS ?? 2000));
  const tokenRetries = Math.max(0, opts.tokenRetries ?? 1);
  const transientRetries = Math.max(0, opts.transientRetries ?? 1);
  const sleep = opts.sleep ?? defaultSleep;

  const meta = base(mode, timestamp, filtersApplied);

  // disabled / mock behave as a single non-paginated page (mock never paginates).
  if (mode === "disabled") {
    const single = await searchPlaces(input);
    return { ...single, pagesFetched: 0, requestsMade: 0, duplicatesAcrossPages: 0, cached: false, stopReason: "single-page" };
  }
  if (mode === "mock") {
    const single = await searchPlaces(input);
    return { ...single, pagesFetched: 1, requestsMade: 0, duplicatesAcrossPages: 0, cached: false, stopReason: "single-page" };
  }

  // ── google, paginated ────────────────────────────────────────────────────────
  const query = buildTextQuery(input);
  const cacheKey = `${query}::mp=${maxPages}::tr=${targetResults}::f=${filtersApplied ? "1" : "0"}`;
  if (!opts.noCache) {
    const hit = PLACES_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at <= cacheTtlMs()) {
      return { ...hit.val, cached: true };
    }
    if (hit) PLACES_CACHE.delete(cacheKey);
  }

  // No budget at all → mirror searchPlaces' RESOURCE_EXHAUSTED error (never a mock substitution).
  if (!withinBudget()) {
    return {
      provider: "google",
      success: false,
      results: [],
      count: 0,
      ...meta,
      error: { provider: "google", success: false, httpStatus: null, googleStatus: "RESOURCE_EXHAUSTED", message: "Daily Google Places request cap reached. No mock results were substituted.", timestamp },
      pagesFetched: 0,
      requestsMade: 0,
      duplicatesAcrossPages: 0,
      cached: false,
      stopReason: "budget",
    };
  }

  const acc: PlaceResult[] = [];
  let token: string | null = null;
  let pagesFetched = 0;
  let requestsMade = 0;
  let stopReason: PagedStopReason = "no-token";
  let partialError: PlacesError | undefined;

  while (pagesFetched < maxPages) {
    if (!withinBudget()) {
      stopReason = "budget";
      break;
    }
    // Continuation pages: wait for provider token readiness before requesting.
    if (token) await sleep(pageDelayMs);

    let page = await googleTextSearch(query, input, token);
    requestsMade += 1;

    // Token-not-ready race (INVALID_ARGUMENT/400) — bounded retry after the readiness delay.
    let tries = tokenRetries;
    while (page.error && token && isTokenNotReady(page) && tries-- > 0 && withinBudget()) {
      await sleep(pageDelayMs);
      page = await googleTextSearch(query, input, token);
      requestsMade += 1;
    }
    // Transient errors (429/5xx) — bounded retry with the same delay as backoff.
    let ttries = transientRetries;
    while (page.error && isTransient(page) && ttries-- > 0 && withinBudget()) {
      await sleep(pageDelayMs);
      page = await googleTextSearch(query, input, token);
      requestsMade += 1;
    }

    pagesFetched += 1;

    if (page.error) {
      if (acc.length > 0) {
        partialError = page.error; // keep what we have; report the failure
        stopReason = "error";
        break;
      }
      // Total failure on the first page — surface as a normal failed search.
      return {
        provider: "google",
        success: false,
        results: [],
        count: 0,
        ...meta,
        error: page.error,
        pagesFetched,
        requestsMade,
        duplicatesAcrossPages: 0,
        cached: false,
        stopReason: "error",
      };
    }

    acc.push(...page.mapped);
    token = page.nextPageToken;

    const filteredSoFar = applyFilters(dedupeAcrossPages(acc).unique, input);
    if (filteredSoFar.length >= targetResults) {
      stopReason = "target-met";
      break;
    }
    if (!token) {
      stopReason = "no-token";
      break;
    }
    if (pagesFetched >= maxPages) {
      stopReason = "max-pages";
      break;
    }
  }

  const { unique, duplicates } = dedupeAcrossPages(acc);
  const results = applyFilters(unique, input);
  const out: PagedSearchResult = {
    provider: "google",
    success: true,
    results,
    count: results.length,
    ...meta,
    pagination: Boolean(token),
    pagesFetched,
    requestsMade,
    duplicatesAcrossPages: duplicates,
    cached: false,
    stopReason,
    partialError,
  };
  if (!opts.noCache && results.length > 0 && !partialError) {
    PLACES_CACHE.set(cacheKey, { at: Date.now(), val: out });
  }
  return out;
}

// Strip anything that could leak the key; bound length. (Google messages don't
// contain the key, but be defensive.)
function sanitize(msg: unknown): string {
  if (typeof msg !== "string") return "";
  let out = msg;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key) out = out.split(key).join("[redacted]");
  return out.slice(0, 300);
}
