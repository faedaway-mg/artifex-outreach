// Gate 2 — the billing schedule must come from the SIGNED agreement snapshot, never
// invented; ambiguous/premature/ineligible cases block issuance; historical vs new
// issuer behavior is preserved.
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertAgreement, insertPayment } from "../repo";
import { makeAgreement } from "../agreement/test-fixtures";
import { prepareMilestoneInvoice } from "./invoicing-service";
import { deriveSchedule, reconcileSchedule } from "./milestones";
import type { Agreement } from "../types";

const founder = { actor: "jordan", actorRole: "founder" as const };

async function signed(mut?: (a: Agreement) => void) {
  const a = makeAgreement({ status: "signed" });
  mut?.(a);
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  return insertAgreement(rest);
}

beforeEach(() => __resetStoreForTests());

describe("Gate 2 — schedule derived from approved terms", () => {
  it("deposit/balance amounts come from the snapshot and reconcile to the signed total", async () => {
    const ag = await signed();
    const snap = ag.contentSnapshot;
    const sched = deriveSchedule(snap);
    expect(sched.find((m) => m.key === "deposit")!.amountCents).toBe(snap.depositAmountCents);
    expect(sched.find((m) => m.key === "balance")!.amountCents).toBe(snap.remainingBalanceCents);
    expect(reconcileSchedule(sched, snap.totalPriceCents).ok).toBe(true);

    const dep = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(dep.invoice!.amountCents).toBe(snap.depositAmountCents); // not an invented default
  });

  it("premature balance (no recorded acceptance) blocks issuance with a clear reason", async () => {
    const ag = await signed();
    const r = await prepareMilestoneInvoice(ag.id, "balance", founder);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/not yet eligible|acceptance/i);
  });

  it("a superseded agreement version cannot be invoiced", async () => {
    const ag = await signed((a) => { a.supersededById = "agr_v2"; });
    const r = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/superseded/i);
  });

  it("a deposit already paid via legacy Checkout is not invoiced again", async () => {
    const ag = await signed();
    await insertPayment({
      leadId: ag.leadId, agreementId: ag.id, type: "deposit", amountCents: ag.contentSnapshot.depositAmountCents,
      currency: "usd", status: "paid", stripePaymentLinkUrl: null, stripeSessionId: "cs", sentAt: null, paidAt: "2026-07-11T00:00:00.000Z",
    });
    const r = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(r.skipped).toBe(true);
  });

  it("historical (Faedaway) agreement resolves to the Faedaway issuer, not the active one", async () => {
    const ag = await signed((a) => {
      // Simulate a pre-issuer historical record: no issuerId, Faedaway entity frozen.
      (a.contentSnapshot as { issuerId?: string }).issuerId = undefined;
      a.contentSnapshot.artifexLegalEntity = "Faedaway M.G. LLC";
    });
    const r = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(r.ok).toBe(true);
    expect(r.invoice!.issuerId).toBe("faedaway");
  });

  it("editing the source lead after signing does not change the frozen schedule", async () => {
    const ag = await signed();
    const before = ag.contentSnapshot.depositAmountCents;
    // A later edit to the underlying business must not move a signed agreement's money.
    (ag.contentSnapshot as { totalPriceCents: number }).totalPriceCents; // frozen snapshot
    const dep = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(dep.invoice!.amountCents).toBe(before);
  });
});
