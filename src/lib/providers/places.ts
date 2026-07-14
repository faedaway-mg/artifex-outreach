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
    hours: null,
  };
}

function base(mode: PlacesMode, timestamp: string, filtersApplied: boolean) {
  return { mode, attribution: ATTRIBUTION, timestamp, filtersApplied, pagination: false };
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

  const query = [input.keyword, input.category, input.city, input.state, input.postalCode].filter(Boolean).join(" ");
  try {
    CALL_STATE.count += 1;
    CALL_STATE.last = Date.now();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY as string,
        "X-Goog-FieldMask": [
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
          "nextPageToken",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
    });

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Structured error — no mock, no key/headers exposed.
      return {
        provider: "google",
        success: false,
        results: [],
        count: 0,
        ...base(mode, timestamp, filtersApplied),
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
    const results = applyFilters(mapped, input);
    return {
      provider: "google",
      success: true,
      results,
      count: results.length,
      ...base(mode, timestamp, filtersApplied),
      pagination: Boolean(data.nextPageToken),
    };
  } catch (err) {
    // Network/transport failure — still a structured error, never mock.
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
        googleStatus: null,
        message: "Network error contacting Google Places. No mock results were substituted.",
        timestamp,
      },
    };
  }
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
