import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// Control the discovery source so tests are deterministic (mockSearch returns
// synthetic businesses that wouldn't match a specific lead).
vi.mock("@/lib/providers/places", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/providers/places")>();
  return { ...actual, searchPlaces: vi.fn() };
});

import { searchPlaces } from "@/lib/providers/places";
import type { PlaceResult, PlacesSearchResult } from "@/lib/providers/places";
import { __resetStoreForTests } from "../store";
import { insertLead, getLead } from "../repo";
import { findContactRouteAction, saveManualContactAction } from "./find-contact";
import { determineContactStrategy } from "./contact-strategy";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

const mockedSearch = vi.mocked(searchPlaces);

// A lead with NO actionable channel — the Glendale Plaza case.
async function seedNoChannelLead(over: Partial<Lead> = {}) {
  const base = makeLead({
    businessName: "Glendale Plaza",
    // Owner-accessible (not a gatekeeper-heavy dental/legal practice) so a resolved phone
    // routes call-first, as these contact-resolution tests assert.
    industry: "Boutique retail",
    normalizedCategory: "boutique",
    googlePlaceId: "PLACE_GP",
    phone: null, website: null, websiteDomain: null, publicEmail: null,
    contactFormUrl: null, socialLinks: [], note: null,
    city: "Glendale", state: "CA", postalCode: "91205",
    ...over,
  });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}

function placeResult(over: Partial<PlaceResult>): PlaceResult {
  return {
    googlePlaceId: "PLACE_GP", businessName: "Glendale Plaza", category: "Shopping mall",
    address: "100 N Brand Blvd", city: "Glendale", state: "CA", postalCode: "91205",
    latitude: null, longitude: null, phone: null, website: null, rating: 4.2,
    reviewCount: 900, businessStatus: "OPERATIONAL", googleMapsUrl: "https://maps.google.com/?cid=1", hours: null,
    ...over,
  };
}
function searchResult(results: PlaceResult[], over: Partial<PlacesSearchResult> = {}): PlacesSearchResult {
  return { provider: "google", mode: "google", success: true, results, count: results.length,
    attribution: "x", timestamp: "t", filtersApplied: false, pagination: false, ...over };
}

describe("findContactRouteAction — the system finds a real route, never fabricates one", () => {
  beforeEach(() => { __resetStoreForTests(); mockedSearch.mockReset(); });

  it("finds a phone from the matching listing, saves it, and the lead becomes call-first", async () => {
    const lead = await seedNoChannelLead();
    // Before: no channel.
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("no-channel");

    mockedSearch.mockResolvedValue(searchResult([placeResult({ phone: "(213) 329-7576", website: "https://glendaleplaza.com" })]));
    const res = await findContactRouteAction(lead.id);

    expect(res.ok).toBe(true);
    expect(res.found).toBe(true);
    expect(res.channels.phone).toBe("(213) 329-7576");
    expect(res.source).toMatch(/Google/i);

    const after = await getLead(lead.id);
    expect(after?.phone).toBe("(213) 329-7576");
    expect(after?.website).toBe("https://glendaleplaza.com");
    // The next action recalculates automatically from the saved channel.
    expect(determineContactStrategy(after!).kind).toBe("call-first");
  });

  it("matches only the right listing — does not save an unrelated business's number", async () => {
    const lead = await seedNoChannelLead({ googlePlaceId: "PLACE_GP" });
    // Different place id AND different name → no trustworthy match.
    mockedSearch.mockResolvedValue(searchResult([placeResult({ googlePlaceId: "PLACE_OTHER", businessName: "Someone Else Inc", phone: "(999) 999-9999" })]));
    const res = await findContactRouteAction(lead.id);
    expect(res.found).toBe(false);
    expect((await getLead(lead.id))?.phone).toBeNull();
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("no-channel");
  });

  it("nothing found → stays no-channel, reports the sources checked honestly", async () => {
    const lead = await seedNoChannelLead();
    mockedSearch.mockResolvedValue(searchResult([]));
    const res = await findContactRouteAction(lead.id);
    expect(res.found).toBe(false);
    expect(res.sourcesChecked.length).toBeGreaterThan(0);
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("no-channel");
  });

  it("discovery unavailable (disabled/quota) → honest failure, nothing saved", async () => {
    const lead = await seedNoChannelLead();
    mockedSearch.mockResolvedValue(searchResult([], { success: false, mode: "disabled", error: { provider: "none", success: false, httpStatus: null, googleStatus: null, message: "Live discovery is disabled.", timestamp: "t" } }));
    const res = await findContactRouteAction(lead.id);
    expect(res.found).toBe(false);
    expect(res.message).toMatch(/disabled/i);
    expect((await getLead(lead.id))?.phone).toBeNull();
  });

  it("only fills gaps — a malformed phone in the listing is not saved", async () => {
    const lead = await seedNoChannelLead();
    mockedSearch.mockResolvedValue(searchResult([placeResult({ phone: "555" })])); // not dialable
    const res = await findContactRouteAction(lead.id);
    expect(res.found).toBe(false);
    expect((await getLead(lead.id))?.phone).toBeNull();
  });
});

describe("saveManualContactAction — validated manual fallback", () => {
  beforeEach(() => __resetStoreForTests());

  it("a valid phone saved manually makes the lead call-first", async () => {
    const lead = await seedNoChannelLead();
    const res = await saveManualContactAction(lead.id, { phone: "(213) 329-7576", source: "Storefront signage", verified: true });
    expect(res.ok).toBe(true);
    expect(res.saved).toContain("phone");
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("call-first");
  });

  it("a valid email saved manually makes the lead email-first", async () => {
    const lead = await seedNoChannelLead();
    const res = await saveManualContactAction(lead.id, { publicEmail: "hello@glendaleplaza.com" });
    expect(res.ok).toBe(true);
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("email-first");
  });

  it("a contact form saved manually makes the lead contact-form-first", async () => {
    const lead = await seedNoChannelLead();
    const res = await saveManualContactAction(lead.id, { contactFormUrl: "https://glendaleplaza.com/contact" });
    expect(res.ok).toBe(true);
    expect(determineContactStrategy((await getLead(lead.id))!).kind).toBe("contact-form-first");
  });

  it("rejects a malformed phone and changes nothing", async () => {
    const lead = await seedNoChannelLead();
    const res = await saveManualContactAction(lead.id, { phone: "555" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/dialable/i);
    expect((await getLead(lead.id))?.phone).toBeNull();
  });

  it("rejects an empty submission", async () => {
    const lead = await seedNoChannelLead();
    const res = await saveManualContactAction(lead.id, {});
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/at least one/i);
  });
});
