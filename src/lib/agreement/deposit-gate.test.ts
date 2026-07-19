import { describe, it, expect } from "vitest";
import { checkDepositAllowed } from "./deposit-gate";
import { makeAgreement, makePayment } from "./test-fixtures";

describe("checkDepositAllowed (deposit hard gate)", () => {
  it("allows a deposit for a signed, current agreement", () => {
    const agreement = makeAgreement({ status: "signed" });
    const payment = makePayment();
    expect(checkDepositAllowed(agreement, payment, "lead_1")).toEqual({ allowed: true, reason: null });
  });

  it("blocks when the agreement is unsigned", () => {
    const r = checkDepositAllowed(makeAgreement({ status: "approved" }), makePayment(), "lead_1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("not signed");
  });

  it("blocks when the agreement is declined or voided", () => {
    expect(checkDepositAllowed(makeAgreement({ status: "declined" }), makePayment(), "lead_1").allowed).toBe(false);
    expect(checkDepositAllowed(makeAgreement({ status: "voided" }), makePayment(), "lead_1").allowed).toBe(false);
  });

  it("blocks when the agreement has been superseded", () => {
    const r = checkDepositAllowed(makeAgreement({ status: "signed", supersededById: "agr_2" }), makePayment(), "lead_1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("superseded");
  });

  it("blocks a cross-lead payment", () => {
    const agreement = makeAgreement({ status: "signed", leadId: "lead_1" });
    const payment = makePayment({ leadId: "lead_2" });
    expect(checkDepositAllowed(agreement, payment, "lead_1").allowed).toBe(false);
  });

  it("blocks a payment pointing at a different agreement", () => {
    const agreement = makeAgreement({ id: "agr_1", status: "signed" });
    const payment = makePayment({ agreementId: "agr_OTHER" });
    expect(checkDepositAllowed(agreement, payment, "lead_1").allowed).toBe(false);
  });

  it("blocks when there is no agreement or no payment", () => {
    expect(checkDepositAllowed(null, makePayment(), "lead_1").allowed).toBe(false);
    expect(checkDepositAllowed(makeAgreement({ status: "signed" }), null, "lead_1").allowed).toBe(false);
  });

  it("blocks a deposit that is already paid", () => {
    const r = checkDepositAllowed(makeAgreement({ status: "signed" }), makePayment({ status: "paid" }), "lead_1");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("already been paid");
  });
});
