// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT ISOLATED NAMESPACE — deterministic seed / reset over the IN-MEMORY store ONLY (mandate 19). Every
// operation fail-closes via assertIsolatedStore() first, so it can never touch a real database or provider.
// Records carry breakbot provenance + example.invalid recipients (rejected by the live production boundary).
// ─────────────────────────────────────────────────────────────────────────────
import { assertIsolatedStore, assertFakeRecipient } from "./isolation";
import { FIXTURES, fixturesManifestHash, type Fixture } from "./fixtures";
import { insertLead, listLeads } from "../repo";
import { __resetStoreForTests } from "../store";
import { recordedOutreach, resetRecordedOutreach } from "../comms/fake-outreach-provider";
import type { Lead } from "../types";

function fixtureLeadInsert(f: Fixture): any {
  assertFakeRecipient(f.recipient); // never seed a real recipient
  const stage = f.kind === "POOR_FIT" ? "Qualified" : f.kind === "NEEDS_EVIDENCE" ? "Discovered" : "Qualified";
  return {
    googlePlaceId: null, businessName: f.businessName, normalizedName: f.id, industry: "Test Fixtures",
    normalizedCategory: "test", categoryGroup: "Test", address: "1 Test St", city: "Testville", state: "CA", postalCode: "90000",
    latitude: null, longitude: null, phone: "(000) 000-0000", website: `https://${f.id}.${"example.invalid"}`, websiteDomain: `${f.id}.example.invalid`,
    publicEmail: f.recipient, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.2, reviewCount: 10,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: f.source, retrievedAt: null, tier: "B", leadScore: 50,
    scoreBreakdown: {}, pipelineStage: stage, estimatedValueLow: 1000, estimatedValueHigh: 2000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 50, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "breakbot", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
    test_only: true,
  };
}

/** Deterministic reset of the ENTIRE isolated namespace (fail-closed). Clears in-memory store + fake ledger. */
export function resetBreakbotNamespace(): void {
  assertIsolatedStore();
  __resetStoreForTests();
  resetRecordedOutreach();
}

/** Seed the fixture leads into the isolated namespace (fail-closed). Returns seeded lead ids + the stable
 *  fixtures manifest hash (identical across reseeds — the determinism proof). */
export async function seedBreakbotFixtures(ids?: string[]): Promise<{ seeded: Array<{ fixtureId: string; leadId: string }>; manifestHash: string; count: number }> {
  assertIsolatedStore();
  const set = ids && ids.length ? new Set(ids) : null;
  const seeded: Array<{ fixtureId: string; leadId: string }> = [];
  for (const f of FIXTURES) {
    if (set && !set.has(f.id)) continue;
    const lead: Lead = await insertLead(fixtureLeadInsert(f));
    seeded.push({ fixtureId: f.id, leadId: lead.id });
  }
  return { seeded, manifestHash: fixturesManifestHash(), count: seeded.length };
}

/** Read-only state summary for scenario assertions (all breakbot-provenance). */
export async function breakbotStateSummary(): Promise<{ leads: number; breakbotLeads: number; realRecipients: number; fakeProviderCalls: number }> {
  assertIsolatedStore();
  const leads = await listLeads();
  const breakbotLeads = leads.filter((l) => l.source === "breakbot").length;
  const realRecipients = leads.filter((l) => l.publicEmail && !/@([a-z0-9-]+\.)?example\.invalid$/i.test(l.publicEmail)).length;
  return { leads: leads.length, breakbotLeads, realRecipients, fakeProviderCalls: recordedOutreach().length };
}
