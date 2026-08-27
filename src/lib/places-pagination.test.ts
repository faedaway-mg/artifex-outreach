import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchPlacesPaged, dedupeAcrossPages, clearPlacesCache } from "./providers/places";
import { discoverInputSchema, type DiscoverInput } from "./schemas";

const ORIG = { ...process.env };
function input(over: Partial<Record<string, unknown>> = {}): DiscoverInput {
  return discoverInputSchema.parse({ category: "Dental practice", city: "Los Angeles", state: "CA", ...over });
}
function res(ok: boolean, status: number, body: any) {
  return { ok, status, json: async () => body };
}
let seq = 0;
function place(over: Record<string, any> = {}) {
  seq += 1;
  return {
    id: `ChIJ_${seq}`,
    displayName: { text: `Biz ${seq}` },
    formattedAddress: `${seq} Sunset Blvd, Los Angeles, CA`,
    location: { latitude: 34.0 + seq / 100, longitude: -118.3 },
    rating: 4.5,
    userRatingCount: 200,
    websiteUri: `https://biz${seq}.example`,
    nationalPhoneNumber: `(213) 555-01${String(seq).padStart(2, "0")}`,
    googleMapsUri: `https://maps.google.com/?cid=${seq}`,
    businessStatus: "OPERATIONAL",
    primaryType: "dentist",
    ...over,
  };
}
const noSleep = vi.fn(async () => {});

function resetBudget(cap = "500") {
  // Mutate the SAME object the module captured at load (replacing it would leave the
  // module's internal reference pointing at a stale, un-reset counter).
  const g = globalThis as any;
  if (!g.__places_calls__) g.__places_calls__ = { count: 0, windowStart: Date.now(), last: 0 };
  g.__places_calls__.count = 0;
  g.__places_calls__.windowStart = Date.now();
  g.__places_calls__.last = 0;
  process.env.GOOGLE_PLACES_DAILY_CAP = cap;
}

beforeEach(() => {
  seq = 0;
  process.env.GOOGLE_PLACES_API_KEY = "AIzaTESTKEY";
  resetBudget();
  clearPlacesCache();
  noSleep.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = ORIG.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_DAILY_CAP = ORIG.GOOGLE_PLACES_DAILY_CAP;
  delete process.env.PLACES_MAX_PAGES;
  clearPlacesCache();
  vi.unstubAllGlobals();
});

describe("searchPlacesPaged — walking nextPageToken", () => {
  it("1. aggregates all pages up to the token chain (3 pages → 3 results)", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t2" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] })); // no token → stop
    const r = await searchPlacesPaged(input(), { maxPages: 5, sleep: noSleep });
    expect(r.pagesFetched).toBe(3);
    expect(r.requestsMade).toBe(3);
    expect(r.results).toHaveLength(3);
    expect(r.stopReason).toBe("no-token");
    expect(r.pagination).toBe(false);
  });

  it("2. token-readiness delay: waits before EACH continuation page, not before page 1", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] }));
    await searchPlacesPaged(input(), { maxPages: 3, pageDelayMs: 2000, sleep: noSleep });
    expect(noSleep).toHaveBeenCalledTimes(1); // once, before page 2
    expect(noSleep).toHaveBeenCalledWith(2000);
  });

  it("3. token-not-ready (INVALID_ARGUMENT/400) is retried after the delay, then succeeds", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(false, 400, { error: { status: "INVALID_ARGUMENT", message: "page token not ready" } }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] }));
    const r = await searchPlacesPaged(input(), { maxPages: 3, tokenRetries: 1, sleep: noSleep });
    expect(r.results).toHaveLength(2);
    expect(r.requestsMade).toBe(3); // page1 + failed page2 + retried page2
    expect(r.stopReason).toBe("no-token");
    expect(r.partialError).toBeUndefined();
  });

  it("4. duplicate results across pages are deduped (by id/domain/phone/name+addr)", async () => {
    const a = place();
    const b = place();
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [a, b], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [b, place()] })); // b repeats
    const r = await searchPlacesPaged(input(), { maxPages: 3, sleep: noSleep });
    expect(r.results).toHaveLength(3);
    expect(r.duplicatesAcrossPages).toBe(1);
  });

  it("5. stop conditions: target-met halts pagination early (no wasted pages)", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place(), place(), place()], nextPageToken: "t1" }));
    const r = await searchPlacesPaged(input(), { maxPages: 5, targetResults: 2, sleep: noSleep });
    expect(r.pagesFetched).toBe(1);
    expect(r.requestsMade).toBe(1);
    expect(r.stopReason).toBe("target-met");
    expect(r.results.length).toBeGreaterThanOrEqual(2);
  });

  it("5b. maxPages=1 (PLACES_MAX_PAGES=1) fetches exactly one page even when a token exists", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [place()], nextPageToken: "tok" }));
    const r = await searchPlacesPaged(input(), { maxPages: 1, sleep: noSleep });
    expect(r.pagesFetched).toBe(1);
    expect(r.requestsMade).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(r.stopReason).toBe("max-pages"); // single-page behavior preserved; no continuation
  });

  it("6. stop conditions: max-pages caps a never-ending token chain", async () => {
    (fetch as any).mockResolvedValue(res(true, 200, { places: [place()], nextPageToken: "tok" }));
    const r = await searchPlacesPaged(input(), { maxPages: 2, sleep: noSleep });
    expect(r.pagesFetched).toBe(2);
    expect(r.stopReason).toBe("max-pages");
    expect(r.pagination).toBe(true); // more pages existed; we chose to stop
  });

  it("7. quota exhaustion BEFORE any page → RESOURCE_EXHAUSTED error, no fetch", async () => {
    resetBudget("0");
    const r = await searchPlacesPaged(input(), { maxPages: 3, sleep: noSleep });
    expect(r.success).toBe(false);
    expect(r.error?.googleStatus).toBe("RESOURCE_EXHAUSTED");
    expect(r.requestsMade).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("8. quota exhaustion MID-pagination → returns page-1 results, stopReason budget", async () => {
    resetBudget("1"); // one request allowed
    (fetch as any).mockResolvedValue(res(true, 200, { places: [place()], nextPageToken: "tok" }));
    const r = await searchPlacesPaged(input(), { maxPages: 5, sleep: noSleep });
    expect(r.pagesFetched).toBe(1);
    expect(r.requestsMade).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(r.stopReason).toBe("budget");
  });

  it("9. partial failure: a later page errors → earlier results kept + partialError set", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place(), place()], nextPageToken: "t1" }))
      .mockResolvedValue(res(false, 500, { error: { status: "INTERNAL", message: "boom" } }));
    const r = await searchPlacesPaged(input(), { maxPages: 3, transientRetries: 1, sleep: noSleep });
    expect(r.success).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.stopReason).toBe("error");
    expect(r.partialError?.httpStatus).toBe(500);
    expect(r.requestsMade).toBe(3); // page1 + page2 + one transient retry
  });

  it("10. total failure on page 1 → structured error, no partial", async () => {
    (fetch as any).mockResolvedValue(res(false, 403, { error: { status: "PERMISSION_DENIED", message: "denied" } }));
    const r = await searchPlacesPaged(input(), { maxPages: 3, transientRetries: 0, sleep: noSleep });
    expect(r.success).toBe(false);
    expect(r.results).toHaveLength(0);
    expect(r.error?.googleStatus).toBe("PERMISSION_DENIED");
  });

  it("11. caching: an identical query is served from cache (no second fetch)", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] }));
    const first = await searchPlacesPaged(input(), { maxPages: 3, sleep: noSleep });
    const callsAfterFirst = (fetch as any).mock.calls.length;
    const second = await searchPlacesPaged(input(), { maxPages: 3, sleep: noSleep });
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
    expect((fetch as any).mock.calls.length).toBe(callsAfterFirst); // no new requests
    expect(second.results).toHaveLength(first.results.length);
  });

  it("12. zero communication: every network call targets ONLY the Places endpoint", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] }));
    await searchPlacesPaged(input(), { maxPages: 3, sleep: noSleep });
    for (const call of (fetch as any).mock.calls) {
      expect(String(call[0])).toContain("places.googleapis.com");
      expect(String(call[0])).not.toMatch(/resend|twilio|mail|sendgrid|instagram|graph\.facebook/i);
    }
  });

  it("13. eligibility filters are preserved across the aggregated pages", async () => {
    (fetch as any)
      .mockResolvedValueOnce(res(true, 200, { places: [place({ websiteUri: null }), place()], nextPageToken: "t1" }))
      .mockResolvedValueOnce(res(true, 200, { places: [place()] }));
    const r = await searchPlacesPaged(input({ requireWebsite: true }), { maxPages: 3, sleep: noSleep });
    // the website-less place from page 1 is filtered out; the others survive
    expect(r.results.every((x) => !!x.website)).toBe(true);
    expect(r.results).toHaveLength(2);
  });
});

describe("dedupeAcrossPages (pure)", () => {
  const p = (over: any) => ({ googlePlaceId: "", businessName: "", category: "", address: "", city: "", state: "", postalCode: "", latitude: null, longitude: null, phone: null, website: null, rating: null, reviewCount: null, businessStatus: "OPERATIONAL", googleMapsUrl: "", hours: null, ...over });
  it("14. same place id is a duplicate", () => {
    const { unique, duplicates } = dedupeAcrossPages([p({ googlePlaceId: "X" }), p({ googlePlaceId: "X" })]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
  it("15. same domain OR phone is a duplicate even with different ids", () => {
    const byDomain = dedupeAcrossPages([p({ googlePlaceId: "A", website: "https://acme.com" }), p({ googlePlaceId: "B", website: "https://www.acme.com/x" })]);
    expect(byDomain.unique).toHaveLength(1);
    const byPhone = dedupeAcrossPages([p({ googlePlaceId: "A", phone: "(213) 555-0100" }), p({ googlePlaceId: "B", phone: "213-555-0100" })]);
    expect(byPhone.unique).toHaveLength(1);
  });
  it("16. same name at a DIFFERENT address is kept (a real second location)", () => {
    const { unique } = dedupeAcrossPages([p({ googlePlaceId: "A", businessName: "Smile Dental", address: "1 A St" }), p({ googlePlaceId: "B", businessName: "Smile Dental", address: "99 B Ave" })]);
    expect(unique).toHaveLength(2);
  });
});
