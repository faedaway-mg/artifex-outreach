import { describe, it, expect, vi } from "vitest";

// Seed the eight scenarios the reconciliation mandate requires. The canonical
// predicate must treat ONLY a genuine current action (a non-terminal plan or a
// committed offer) as active work — never stored BI, an old route, a stopped
// sequence, a skipped review, a legacy READY_TO_SELL, inventory, a disqualified
// lead, or a fixture.
const PLANS: any[] = [
  { leadId: "lead_active_plan", approvalStatus: "approved", status: "active" }, // (8) genuinely active
  { leadId: "lead_stopped_seq", approvalStatus: "approved", status: "retired" }, // (2) stopped sequence
  { leadId: "lead_disqualified", approvalStatus: "rejected", status: "rejected" }, // (6) disqualified
  { leadId: "lead_draft", approvalStatus: "draft", status: "draft" }, // pre-commitment draft
];
const OFFERS: any[] = [
  { leadId: "lead_committed_offer", outreachState: "SENT", purchasedAt: null }, // (8) committed action
  { leadId: "lead_purchased", outreachState: "PURCHASED", purchasedAt: "2026-09-01T00:00:00Z" }, // customer
  { leadId: "lead_ready_to_sell", outreachState: "READY", purchasedAt: null }, // (4) legacy READY, no action
  { leadId: "lead_needs_review", outreachState: "NEEDS_REVIEW", purchasedAt: null }, // (3) skipped/pending review
  { leadId: "lead_none", outreachState: "NONE", purchasedAt: null }, // BI-derived, uncommitted
  // lead_history_bi_only, lead_inventory_only, lead_fixture: NO plan and NO offer at all.
];

vi.mock("../repo", () => ({ allPlans: async () => PLANS }));
vi.mock("./store", () => ({ listOffers: async () => OFFERS }));

import { loadActiveWorkContext, isActiveOperatorWork } from "./active-work";

describe("canonical active-work predicate", () => {
  it("marks ONLY genuine current actions as active", async () => {
    const ctx = await loadActiveWorkContext();
    const active = [...ctx.leadIds].sort();
    expect(active).toEqual(["lead_active_plan", "lead_committed_offer", "lead_purchased"].sort());
  });

  it("excludes history/inventory/disqualified/fixture/legacy-ready/stopped/needs-review", async () => {
    const ctx = await loadActiveWorkContext();
    for (const id of [
      "lead_history_bi_only", "lead_inventory_only", "lead_fixture", // no plan/offer at all
      "lead_ready_to_sell", "lead_needs_review", "lead_none",         // uncommitted offer states
      "lead_stopped_seq", "lead_disqualified", "lead_draft",          // terminal / pre-commit plans
    ]) {
      expect(isActiveOperatorWork(id, ctx)).toBe(false);
    }
  });

  it("keeps a genuinely active lead detectable", async () => {
    const ctx = await loadActiveWorkContext();
    expect(isActiveOperatorWork("lead_active_plan", ctx)).toBe(true);
    expect(isActiveOperatorWork("lead_committed_offer", ctx)).toBe(true);
    expect(ctx.reasons.get("lead_active_plan")).toContain("plan");
    expect(ctx.reasons.get("lead_committed_offer")).toContain("offer");
  });
});
