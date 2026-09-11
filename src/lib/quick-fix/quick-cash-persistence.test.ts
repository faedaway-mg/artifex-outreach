import { describe, it, expect, beforeEach } from "vitest";
import { reconcileQuickCashOffers, getState, offerIdFor, upsertOffer, setApproval, __resetQuickFixForTests } from "./store";
import { deriveQuickCashLifecycle } from "./quick-cash-lifecycle";
import type { QuickFixOffer } from "./types";

// ── Escaped defect (mandate E §21): "Operator lifecycle action appeared complete, then
//    reverted on refresh/navigation." This proves the state is CANONICAL (persisted),
//    not a client-only flag — it survives repeated reads (refresh), is idempotent, and
//    the derived card state never regresses to PREPARING once READY. ────────────────

function offer(over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "", leadId: "lead_persist", companyName: "Persist Co", findingIds: ["f1"], capabilityKeys: ["cta-repair"],
    band: "ENTRY", priceCents: 24900, currency: "usd",
    scope: { offerName: "Fix", problemBeingSolved: "p", proposedSolution: "s", includedItems: ["a"], excludedItems: [], customerInputsRequired: ["access"], deliveryWindow: "48h", revisionPolicy: "one" } as any,
    evidenceGrade: "OBSERVED", confidence: 0.9, rationale: "r", economics: {} as any, maintenance: null,
    quickFixEligible: true, notEligibleReason: null, automationLevel: "ASSISTED", offerVersion: "persist_v1", state: "DRAFT", generatedAt: "2026-09-01T00:00:00Z",
    ...over,
  } as unknown as QuickFixOffer;
}

describe("Quick Cash canonical persistence — no reset on refresh (mandate E §6/§21)", () => {
  beforeEach(async () => { await __resetQuickFixForTests(); });

  it("autonomous reconcile persists an approved offer that SURVIVES repeated reads (refresh)", async () => {
    const o = offer();
    const id = offerIdFor(o);
    const res = await reconcileQuickCashOffers([o], { now: "2026-09-10T00:00:00Z" });
    expect(res.added).toBe(1);

    // Read #1, #2, #3 — every read returns the SAME canonical approved state (no revert).
    for (let i = 0; i < 3; i++) {
      const s = await getState();
      expect(s.offers[id]).toBeTruthy();
      expect(s.offers[id].approvalStatus).toBe("approved");
      expect(s.offers[id].state).toBe("APPROVED");
    }
  });

  it("a second reconcile is a NO-OP (idempotent — never duplicates or re-approves)", async () => {
    const o = offer();
    await reconcileQuickCashOffers([o], { now: "2026-09-10T00:00:00Z" });
    const again = await reconcileQuickCashOffers([o], { now: "2026-09-10T00:01:00Z" });
    expect(again.added).toBe(0);
    expect(again.approved).toBe(0);
    const s = await getState();
    expect(Object.values(s.offers).filter((x) => x.leadId === "lead_persist")).toHaveLength(1); // no duplicate
  });

  it("the derived card state stays READY across reloads — never regresses to PREPARING", async () => {
    const o = offer();
    const id = offerIdFor(o);
    await reconcileQuickCashOffers([o], { now: "2026-09-10T00:00:00Z" });
    for (let i = 0; i < 2; i++) {
      const s = await getState();
      const stored = s.offers[id];
      const lc = deriveQuickCashLifecycle({
        eligible: true, hasOffer: !!stored, approved: stored.approvalStatus === "approved",
        packageComplete: stored.approvalStatus === "approved", outreachState: stored.outreachState ?? null,
        purchased: false, deliveryOn: false,
      });
      expect(lc.state).toBe("READY");
      expect(lc.state).not.toBe("PREPARING");
    }
  });

  it("preserves human approval history — reconcile never overwrites approvedBy", async () => {
    const o = offer();
    const id = offerIdFor(o);
    await upsertOffer(o, { now: "2026-09-09T00:00:00Z" });
    await setApproval(id, "approved", "jordan", "2026-09-09T00:00:00Z");
    await reconcileQuickCashOffers([o], { now: "2026-09-10T00:00:00Z" });
    const s = await getState();
    expect(s.offers[id].approvedBy).toBe("jordan"); // human sign-off preserved, not clobbered
  });
});
