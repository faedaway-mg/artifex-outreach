import { describe, it, expect } from "vitest";
import { buildAgreementContent } from "./snapshot";
import { makeLead, makeContact, makeProposal, makeSettings } from "./test-fixtures";

const base = {
  agreementNumber: "AL-A-2026-001",
  version: 1,
  settings: makeSettings(),
  nowIso: "2026-07-10T00:00:00.000Z",
};

describe("buildAgreementContent", () => {
  it("resolves a complete snapshot from lead + contact + proposal", () => {
    const { content, errors } = buildAgreementContent({ ...base, lead: makeLead(), contact: makeContact(), proposal: makeProposal(), deliverable: null });
    expect(errors).toEqual([]);
    expect(content).not.toBeNull();
    expect(content!.clientBusinessName).toBe("Copper & Oak");
    expect(content!.clientContactName).toBe("Dana Reyes");
    expect(content!.clientEmail).toBe("dana@copperoak.example");
    expect(content!.proposalNumber).toBe("AL-P-2026-001");
    expect(content!.proposalVersion).toBe(1);
    expect(content!.governingLaw).toBe("California");
    expect(content!.templateVersion).toBe("draft-v1");
  });

  it("computes deposit and remaining balance in cents", () => {
    const { content } = buildAgreementContent({ ...base, lead: makeLead(), contact: makeContact(), proposal: makeProposal({ amount: 14500 }), deliverable: null });
    expect(content!.totalPriceCents).toBe(1_450_000);
    expect(content!.depositPercent).toBe(50);
    expect(content!.depositAmountCents).toBe(725_000);
    expect(content!.remainingBalanceCents).toBe(725_000);
  });

  it("honors a deposit-percent override and keeps deposit + balance = total", () => {
    const { content } = buildAgreementContent({ ...base, lead: makeLead(), contact: makeContact(), proposal: makeProposal({ amount: 10000 }), deliverable: null, overrides: { depositPercent: 30 } });
    expect(content!.depositAmountCents).toBe(300_000);
    expect(content!.remainingBalanceCents).toBe(700_000);
    expect(content!.depositAmountCents + content!.remainingBalanceCents).toBe(content!.totalPriceCents);
  });

  it("refuses to generate when critical fields are missing", () => {
    const lead = makeLead({ opportunitySummary: null, recommendedService: null, publicEmail: null });
    const { content, errors } = buildAgreementContent({ ...base, lead, contact: null, proposal: makeProposal({ amount: null }), deliverable: null });
    expect(content).toBeNull();
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("Signer name"),
      expect.stringContaining("Signer email"),
      expect.stringContaining("Project summary"),
      expect.stringContaining("Scope"),
      expect.stringContaining("total project price"),
    ]));
  });

  it("requires the proposal to be accepted", () => {
    const { content, errors } = buildAgreementContent({ ...base, lead: makeLead(), contact: makeContact(), proposal: makeProposal({ status: "sent" }), deliverable: null });
    expect(content).toBeNull();
    expect(errors.some((e) => e.includes("accepted"))).toBe(true);
  });

  it("is pure — a later edit to the input lead cannot mutate a produced snapshot", () => {
    const lead = makeLead();
    const { content } = buildAgreementContent({ ...base, lead, contact: makeContact(), proposal: makeProposal(), deliverable: null });
    const before = content!.clientBusinessName;
    lead.businessName = "Renamed Co"; // mutate the source after the fact
    expect(content!.clientBusinessName).toBe(before);
    expect(content!.clientBusinessName).toBe("Copper & Oak");
  });

  it("uses overrides for scope, timeline, and monthly partnership", () => {
    const { content } = buildAgreementContent({
      ...base, lead: makeLead(), contact: makeContact(), proposal: makeProposal(), deliverable: null,
      overrides: { scope: ["Design", "Build", "Launch"], timeline: "10 weeks", monthlyPartnershipCents: 150000 },
    });
    expect(content!.scope).toEqual(["Design", "Build", "Launch"]);
    expect(content!.timeline).toBe("10 weeks");
    expect(content!.monthlyPartnershipCents).toBe(150000);
  });
});
