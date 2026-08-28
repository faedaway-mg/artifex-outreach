import { describe, it, expect } from "vitest";
import { deriveSchedule, reconcileSchedule, isMilestoneEligible, scheduleForSnapshot, type MilestoneTerm } from "./milestones";

const snap = (over: Partial<{ depositAmountCents: number; remainingBalanceCents: number; totalPriceCents: number; milestones: MilestoneTerm[] | null }> = {}) => ({
  totalPriceCents: 1_000_000,
  depositAmountCents: 500_000,
  remainingBalanceCents: 500_000,
  milestones: null,
  ...over,
});

describe("milestone schedule", () => {
  it("default schedule = deposit (on_signature) + balance (on_acceptance), reconciling to total", () => {
    const s = deriveSchedule(snap());
    expect(s.map((m) => m.key)).toEqual(["deposit", "balance"]);
    expect(s[0].trigger).toBe("on_signature");
    expect(s[1].trigger).toBe("on_acceptance");
    expect(reconcileSchedule(s, 1_000_000).ok).toBe(true);
  });

  it("drops a zero-amount balance (deposit == total)", () => {
    const s = deriveSchedule(snap({ depositAmountCents: 1_000_000, remainingBalanceCents: 0 }));
    expect(s.map((m) => m.key)).toEqual(["deposit"]);
    expect(reconcileSchedule(s, 1_000_000).ok).toBe(true);
  });

  it("reconciliation FAILS when the schedule does not sum to the total", () => {
    const bad: MilestoneTerm[] = [
      { key: "deposit", label: "Deposit", amountCents: 400_000, trigger: "on_signature" },
      { key: "balance", label: "Balance", amountCents: 500_000, trigger: "on_acceptance" },
    ];
    const r = reconcileSchedule(bad, 1_000_000);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/does not reconcile/);
  });

  it("rejects duplicate keys and non-positive amounts", () => {
    expect(reconcileSchedule([
      { key: "m", label: "a", amountCents: 500_000, trigger: "manual" },
      { key: "m", label: "b", amountCents: 500_000, trigger: "manual" },
    ], 1_000_000).errors.join(" ")).toMatch(/unique/);
    expect(reconcileSchedule([{ key: "m", label: "a", amountCents: 0, trigger: "manual" }], 0).ok).toBe(false);
  });

  it("honours an explicit operator milestone schedule when present", () => {
    const milestones: MilestoneTerm[] = [
      { key: "deposit", label: "Deposit", amountCents: 300_000, trigger: "on_signature" },
      { key: "m1", label: "Design", amountCents: 300_000, trigger: "on_acceptance" },
      { key: "m2", label: "Launch", amountCents: 400_000, trigger: "on_acceptance" },
    ];
    const { schedule, reconciliation } = scheduleForSnapshot({ ...snap({ milestones }), scope: [], deliverables: [], exclusions: [] } as never);
    expect(schedule.map((m) => m.key)).toEqual(["deposit", "m1", "m2"]);
    expect(reconciliation.ok).toBe(true);
  });
});

describe("milestone eligibility (no all-billable-after-deposit)", () => {
  const s = deriveSchedule(snap());
  const deposit = s[0];
  const balance = s[1];

  it("nothing is eligible before signature", () => {
    expect(isMilestoneEligible(deposit, { agreementSigned: false, acceptedKeys: [] })).toBe(false);
    expect(isMilestoneEligible(balance, { agreementSigned: false, acceptedKeys: [] })).toBe(false);
  });

  it("after signature only the deposit is eligible; balance needs recorded acceptance", () => {
    expect(isMilestoneEligible(deposit, { agreementSigned: true, acceptedKeys: [] })).toBe(true);
    expect(isMilestoneEligible(balance, { agreementSigned: true, acceptedKeys: [] })).toBe(false);
    expect(isMilestoneEligible(balance, { agreementSigned: true, acceptedKeys: ["balance"] })).toBe(true);
  });
});
