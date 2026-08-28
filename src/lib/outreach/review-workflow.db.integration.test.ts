// ─────────────────────────────────────────────────────────────────────────────
// Gate 8 — END-TO-END acceptance through the REAL isolated Postgres adapter.
//
// Drives the four operator controls (preview / approve / regenerate / skip) and the delivery gate
// against a live Postgres backend (never production). Run with:
//   DATABASE_URL="postgres://localhost:5432/artifex_outreach_test" npx vitest run \
//     src/lib/outreach/review-workflow.db.integration.test.ts
// Skipped automatically under the default in-memory `npm test` (keeps the unit count stable).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db/client";
import { insertLead, upsertBusinessIntelligence } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import {
  effectiveReviewFor, deliveryReadiness, recordPreview, approveRevision, saveDraft,
  skipReview, revisitReview, sendGate, proposeRegeneration, getEditorialState,
} from "./review-revisions";
import type { Lead } from "../types";

const RUN = Boolean(process.env.DATABASE_URL) && hasDb();

function makeSendable<T extends { businessProfile: { opportunities: any[] } }>(bi: T): T {
  const ev = (category: string, observation: string, why: string) => ({
    id: category, category, observation, whyItMatters: why,
    estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"],
  });
  bi.businessProfile.opportunities = [
    ev("Scheduling", "The site has no online booking — reservations require a phone call during business hours.", "New customers who won't call during business hours quietly drop off before they ever reach the desk."),
    ev("Brand Experience", "The homepage has no clear primary call to action for a first-time visitor.", "A first-time visitor with no obvious next move is the one most likely to leave without acting."),
    ...bi.businessProfile.opportunities,
  ];
  return bi;
}

function leadFields(id: string, over: Partial<Lead> = {}): any {
  return {
    googlePlaceId: null, businessName: `E2E ${id}`, normalizedName: `e2e${id}`, industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://e.example", websiteDomain: "e.example",
    publicEmail: "owner@e.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  };
}

async function seedLead(businessName: string, sendable: boolean): Promise<Lead> {
  const lead = await insertLead(leadFields(businessName));
  const bi: any = await analyzeBusiness({ lead, findings: [], contacts: [] } as any);
  if (sendable) makeSendable(bi);
  else bi.businessProfile.opportunities = []; // force a genuinely thin (INSUFFICIENT_EVIDENCE) review
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
  return lead;
}

async function cleanup() {
  const db = getDb();
  await db.execute(sql`DELETE FROM audit_log WHERE actor IN ('jordan','operator') AND target_type = 'lead' AND target_id LIKE 'lead_%'`);
  await db.execute(sql`DELETE FROM business_intelligence WHERE lead_id LIKE 'lead_%'`);
  await db.execute(sql`DELETE FROM leads WHERE source = 'test'`);
}

describe.runIf(RUN)("Gate 8 — E2E operator workflow against real Postgres", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("A. CLEAN — preview → approve binds the exact revision; the send gate yields real PDF bytes + manifest", async () => {
    const lead = await seedLead("clean", true);
    const eff = await effectiveReviewFor(lead.id);
    expect(eff!.review.status).toBe("SENDABLE");
    const before = await deliveryReadiness(lead.id);
    expect(before!.checks.approvedCurrent).toBe(false);

    await recordPreview(lead.id, { actor: "jordan" });
    const approve = await approveRevision(lead.id, { authorized: true, actor: "jordan" });
    expect(approve.ok).toBe(true);

    const ready = await deliveryReadiness(lead.id);
    expect(ready!.ready).toBe(true);
    const gate = await sendGate(lead.id);
    expect(gate.allowed).toBe(true);
    expect(gate.pdf && gate.pdf.length > 0).toBeTruthy();
    expect(gate.manifest!.revisionId).toBe(ready!.revisionId);
    expect(gate.manifest!.pdfSha256).toHaveLength(64);
  }, 30000);

  it("B. BLOCKED — a thin-evidence review is not approvable; skip/hold blocks the send with a reason", async () => {
    const lead = await seedLead("blocked", false);
    const eff = await effectiveReviewFor(lead.id);
    expect(eff!.review.status).toBe("INSUFFICIENT_EVIDENCE");
    const approve = await approveRevision(lead.id, { authorized: true, actor: "jordan" });
    expect(approve.ok).toBe(false); // fail closed — nothing approvable

    const skip = await skipReview(lead.id, "thin evidence — revisit after enrichment", { actor: "jordan" });
    expect(skip.ok).toBe(true);
    const gate = await sendGate(lead.id);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("held");

    const revisit = await revisitReview(lead.id, { actor: "jordan" });
    expect(revisit.ok).toBe(true);
    expect((await getEditorialState(lead.id)).held).toBeNull();
  }, 30000);

  it("C. INVALIDATION — an edit AFTER approval nulls the approval; the stale review cannot pass the send gate", async () => {
    const lead = await seedLead("invalidate", true);
    await recordPreview(lead.id, { actor: "jordan" });
    expect((await approveRevision(lead.id, { authorized: true, actor: "jordan" })).ok).toBe(true);
    expect((await sendGate(lead.id)).allowed).toBe(true);

    // Operator edits the opening hook — content changes → prior approval + preview are invalidated.
    const base = (await deliveryReadiness(lead.id))!.revisionId;
    const edit = await saveDraft(lead.id, { openingHook: "A calmer, more specific opening line." }, { expectedBaseRevisionId: base, actor: "jordan" });
    expect(edit.ok).toBe(true);

    const after = await deliveryReadiness(lead.id);
    expect(after!.checks.approvedCurrent).toBe(false);
    expect(after!.ready).toBe(false);
    const gate = await sendGate(lead.id);
    expect(gate.allowed).toBe(false); // never ships a stale, unapproved revision
  }, 30000);

  it("D. CONCURRENCY — two racing edits on the same base revision: exactly one lands, the other is told to reload", async () => {
    const lead = await seedLead("race", true);
    const base = (await deliveryReadiness(lead.id))!.revisionId;
    const [a, b] = await Promise.all([
      saveDraft(lead.id, { openingHook: "Opening variant A." }, { expectedBaseRevisionId: base, actor: "op-a" }),
      saveDraft(lead.id, { openingHook: "Opening variant B." }, { expectedBaseRevisionId: base, actor: "op-b" }),
    ]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1); // exactly one write lands (blocked by the content-fingerprint guard and/or the rev CAS)
    expect([a, b].some((r) => !r.ok && /older version|reload/.test(r.reason ?? ""))).toBe(true);
  }, 30000);

  it("D2. REGENERATE — proposes a NEW draft via the adapter (provider recorded), never auto-approving or applying it", async () => {
    const lead = await seedLead("regen", true);
    const eff = await effectiveReviewFor(lead.id);
    const fid = eff!.review.findings[0].id;
    const prop = await proposeRegeneration(lead.id, { findingId: fid, part: "whatWedDo" }, "make the next step concrete", { actor: "jordan" });
    expect(prop.ok).toBe(true);
    expect(prop.proposal!.proposed).toBeTruthy();
    // Propose-not-replace: no approval was created and the stored draft was NOT mutated by proposing.
    const state = await getEditorialState(lead.id);
    expect(state.approval).toBeNull();
    expect(state.draft.findings?.[fid]?.whatWedDo).toBeUndefined();
  }, 30000);
});
