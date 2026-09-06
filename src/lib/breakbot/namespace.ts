// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT ISOLATED NAMESPACE — deterministic seed / reset over the IN-MEMORY store ONLY (mandate 19). Every
// operation fail-closes via assertIsolatedStore() first, so it can never touch a real database or provider.
// Records carry breakbot provenance + example.invalid recipients (rejected by the live production boundary).
// ─────────────────────────────────────────────────────────────────────────────
import { assertIsolatedStore, assertFakeRecipient } from "./isolation";
import { FIXTURES, fixturesManifestHash, type Fixture } from "./fixtures";
import { insertLead, listLeads, appendAudit } from "../repo";
import { __resetStoreForTests } from "../store";
import { recordedOutreach, resetRecordedOutreach } from "../comms/fake-outreach-provider";
import { PROSPECT_PACKAGE_ACTION } from "../outreach/prospect-package-store";
import { REVIEW_APPROVED_ACTION } from "../outreach/review-approval";
import { computePackageDigest } from "../outreach/prospect-package";
import { createHash } from "node:crypto";
import type { Lead } from "../types";

/** Seed a deterministic READY_TO_APPROVE video package (+ review-approved audit) so the fixture appears in
 *  the REAL Ready-to-Approve UI. Deterministic artifact hashes derived from the fixture content hash. */
async function seedReadyVideoPackage(leadId: string, f: Fixture): Promise<{ packageDigest: string }> {
  const h = (tag: string) => createHash("sha256").update(`bb-artifact/${f.id}/${tag}`).digest("hex");
  const subject = `A short review for ${f.businessName}`;
  const bodyText = `Hi — I put together a short, focused review for ${f.businessName}. If it's useful, just reply.`;
  const record: any = {
    leadId, packageVersion: 1, recordVersion: 1, recipientEmail: f.recipient, subject,
    bodyHtml: `<p>${bodyText}</p>`, bodyText, videoRequired: true,
    review: { reviewVersion: 1, blobKey: `quick-review-pdf:${leadId}:v1`, sha256: h("pdf"), byteSize: 2048, filename: "review.pdf" },
    video: { jobId: `bb_job_${f.id}`, inputVersion: `bb_iv_${f.id}`, videoKey: `bb_vid_${leadId}`, sha256: h("video") },
    evidence: { findingIds: ["bb_f1", "bb_f2"], digests: [h("pdf"), "bb_f1", "bb_f2"] },
    share: { publicId: `bb_pub_${f.id}`, shareVersion: 1, keyVersion: 1 },
    state: "READY_TO_APPROVE", frozenAt: "", approvedBy: "breakbot",
  };
  record.packageDigest = computePackageDigest(record);
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor: "breakbot", targetType: "lead", targetId: leadId, meta: { pkg: record } as unknown as Record<string, unknown>, ip: null });
  // A review-approved binding → the snapshot's frozenPdf proxy is satisfied (appears in Ready).
  await appendAudit({ action: REVIEW_APPROVED_ACTION, actor: "breakbot", targetType: "lead", targetId: leadId, meta: { binding: { leadId, reviewVersion: 1 } } as unknown as Record<string, unknown>, ip: null });
  return { packageDigest: record.packageDigest };
}

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
    // A complete READY_EMAIL_VIDEO fixture is seeded as a REAL READY_TO_APPROVE package so it appears in
    // the real Ready-to-Approve + Full Package UI (loaded by the same repository readers the UI uses).
    if (f.kind === "READY_EMAIL_VIDEO") await seedReadyVideoPackage(lead.id, f);
    seeded.push({ fixtureId: f.id, leadId: lead.id });
  }
  return { seeded, manifestHash: fixturesManifestHash(), count: seeded.length };
}

/** Read-only state summary for scenario assertions (all breakbot-provenance). */
export async function breakbotStateSummary(): Promise<{ leads: number; breakbotLeads: number; realRecipients: number; fakeProviderCalls: number; ready: number; scheduled: number; readyBusinesses: string[] }> {
  assertIsolatedStore();
  const { buildCompanySnapshot } = await import("../outreach/company-snapshot");
  const leads = await listLeads();
  const breakbotLeads = leads.filter((l) => l.source === "breakbot").length;
  const realRecipients = leads.filter((l) => l.publicEmail && !/@([a-z0-9-]+\.)?example\.invalid$/i.test(l.publicEmail)).length;
  const snap = await buildCompanySnapshot();
  return { leads: leads.length, breakbotLeads, realRecipients, fakeProviderCalls: recordedOutreach().length, ready: snap.counts.readyToSchedule, scheduled: snap.counts.scheduled, readyBusinesses: snap.ready.map((r) => r.business) };
}
