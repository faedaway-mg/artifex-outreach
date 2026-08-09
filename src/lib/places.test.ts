import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchPlaces, placesMode } from "./providers/places";
import { discoverInputSchema, type DiscoverInput } from "./schemas";

const ORIG = { ...process.env };
function input(over: Partial<Record<string, unknown>> = {}): DiscoverInput {
  return discoverInputSchema.parse({ category: "Dental practice", city: "Los Angeles", state: "CA", ...over });
}
function res(ok: boolean, status: number, body: any) {
  return { ok, status, json: async () => body };
}
function googlePlace(over: Record<string, any> = {}) {
  return {
    id: "ChIJ_test_1",
    displayName: { text: "Bright Smile Dental" },
    formattedAddress: "123 Sunset Blvd, Los Angeles, CA",
    location: { latitude: 34.09, longitude: -118.33 },
    rating: 4.6,
    userRatingCount: 210,
    websiteUri: "https://brightsmile.example",
    nationalPhoneNumber: "(213) 555-0100",
    googleMapsUri: "https://maps.google.com/?cid=1",
    businessStatus: "OPERATIONAL",
    primaryType: "dentist",
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  (process.env as any).NODE_ENV = ORIG.NODE_ENV;
  process.env.GOOGLE_PLACES_API_KEY = ORIG.GOOGLE_PLACES_API_KEY;
  delete process.env.ALLOW_MOCK_PLACES;
  vi.unstubAllGlobals();
});

describe("placesMode (per-request, never memoized)", () => {
  it("1. key present → google", () => {
    process.env.GOOGLE_PLACES_API_KEY = "AIzaTESTKEY";
    expect(placesMode()).toBe("google");
  });
  it("2. no key in production → disabled (not mock)", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    (process.env as any).NODE_ENV = "production";
    expect(placesMode()).toBe("disabled");
  });
  it("3. no key in development → mock; production+ALLOW_MOCK_PLACES → mock", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    (process.env as any).NODE_ENV = "test";
    expect(placesMode()).toBe("mock");
    (process.env as any).NODE_ENV = "production";
    process.env.ALLOW_MOCK_PLACES = "true";
    expect(placesMode()).toBe("mock");
  });
});

describe("google path", () => {
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "AIzaTESTKEY";
  });

  it("4. HTTP error → structured error, no mock substitution", async () => {
    (fetch as any).mockResolvedValue(res(false, 403, { error: { status: "PERMISSION_DENIED", message: "denied" } }));
    const r = await searchPlaces(input());
    expect(r.provider).toBe("google");
    expect(r.success).toBe(false);
    expect(r.results).toHaveLength(0);
    expect(r.error?.httpStatus).toBe(403);
    expect(r.error?.googleStatus).toBe("PERMISSION_DENIED");
    // no mock businesses leaked in
    expect(r.results.every((x) => !x.businessName.startsWith("[MOCK]"))).toBe(true);
  });

  it("5. valid response → mapped from New API field names", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace()], nextPageToken: "abc" }));
    const r = await searchPlaces(input());
    expect(r.provider).toBe("google");
    expect(r.success).toBe(true);
    expect(r.pagination).toBe(true);
    const p = r.results[0];
    expect(p.businessName).toBe("Bright Smile Dental");
    expect(p.address).toBe("123 Sunset Blvd, Los Angeles, CA");
    expect(p.latitude).toBe(34.09);
    expect(p.rating).toBe(4.6);
    expect(p.reviewCount).toBe(210);
    expect(p.website).toBe("https://brightsmile.example");
    expect(p.phone).toBe("(213) 555-0100");
    expect(p.category).toBe("dentist");
  });

  it("5b. requests regular opening hours and normalizes weekdayDescriptions into leads.hours", async () => {
    const weekday = [
      "Monday: 8:00 AM – 5:00 PM", "Tuesday: 8:00 AM – 5:00 PM", "Wednesday: 8:00 AM – 5:00 PM",
      "Thursday: 8:00 AM – 5:00 PM", "Friday: 8:00 AM – 5:00 PM", "Saturday: Closed", "Sunday: Closed",
    ];
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace({ regularOpeningHours: { weekdayDescriptions: weekday } })] }));
    const r = await searchPlaces(input());
    // The field mask actually asks Google for the hours field.
    const mask = (fetch as any).mock.calls[0][1].headers["X-Goog-FieldMask"] as string;
    expect(mask).toContain("places.regularOpeningHours.weekdayDescriptions");
    // Stored in the exact newline-joined shape the businessHours parser reads.
    expect(r.results[0].hours).toBe(weekday.join("\n"));
  });

  it("5c. absent opening hours stays null — unknown remains unknown, never fabricated", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace()] }));
    const r = await searchPlaces(input());
    expect(r.results[0].hours).toBeNull();
  });

  it("6. does NOT read legacy field names", async () => {
    // Legacy shape only — new fields absent. Must NOT be interpreted.
    const legacy = { id: "ChIJ_legacy", name: "Legacy Name", formatted_address: "9 Old Rd", website: "https://legacy.example", user_ratings_total: 99, formatted_phone_number: "(111) 111-1111" };
    (fetch as any).mockResolvedValue(res(true, 200, { places: [legacy] }));
    const r = await searchPlaces(input());
    const p = r.results[0];
    expect(p.businessName).toBe("Unknown"); // did not use legacy `name`
    expect(p.website).toBeNull(); // did not use legacy `website`
    expect(p.reviewCount).toBeNull(); // did not use legacy `user_ratings_total`
    expect(p.phone).toBeNull(); // did not use legacy `formatted_phone_number`
  });

  it("7. minRating filter", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace({ id: "a", rating: 4.6 }), googlePlace({ id: "b", rating: 3.2 })] }));
    const r = await searchPlaces(input({ minRating: 4.0 }));
    expect(r.results).toHaveLength(1);
    expect(r.results[0].rating).toBe(4.6);
  });

  it("8. minReviews filter", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace({ id: "a", userRatingCount: 200 }), googlePlace({ id: "b", userRatingCount: 5 })] }));
    const r = await searchPlaces(input({ minReviews: 20 }));
    expect(r.results).toHaveLength(1);
    expect(r.results[0].reviewCount).toBe(200);
  });

  it("9. zero matches → empty google result, NOT mock", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace({ rating: 2.0 })] }));
    const r = await searchPlaces(input({ minRating: 4.5 }));
    expect(r.provider).toBe("google");
    expect(r.success).toBe(true);
    expect(r.results).toHaveLength(0);
  });

  it("10a. provider label reflects google", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [googlePlace()] }));
    const r = await searchPlaces(input());
    expect(r.provider).toBe("google");
    expect(r.mode).toBe("google");
  });
});

describe("mock + disabled paths", () => {
  it("10b. mock mode → provider mock, [MOCK]-labeled, fetch never called", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    (process.env as any).NODE_ENV = "test";
    const r = await searchPlaces(input());
    expect(r.provider).toBe("mock");
    expect(r.success).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.businessName.startsWith("[MOCK]"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disabled in production → error, no results, fetch never called", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    (process.env as any).NODE_ENV = "production";
    const r = await searchPlaces(input());
    expect(r.provider).toBe("none");
    expect(r.mode).toBe("disabled");
    expect(r.success).toBe(false);
    expect(r.results).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
