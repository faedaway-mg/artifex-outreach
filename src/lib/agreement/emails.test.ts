import { describe, it, expect } from "vitest";
import { agreementReadyEmail, agreementSignedEmail, depositRequestEmail, depositReceivedEmail, kickoffSchedulingEmail } from "./emails";
import { makeAgreement, makeSettings } from "./test-fixtures";

const agreement = makeAgreement();
const settings = makeSettings();

const all = [
  agreementReadyEmail(agreement, settings),
  agreementSignedEmail(agreement, settings),
  depositRequestEmail(agreement, "https://buy.stripe.com/test", settings),
  depositReceivedEmail(agreement, settings),
  kickoffSchedulingEmail(agreement, settings),
];

describe("agreement lifecycle emails", () => {
  it("never leak AshMap identity, domains, or branding", () => {
    for (const m of all) {
      const text = `${m.subject}\n${m.body}`.toLowerCase();
      expect(text).not.toContain("ashmap");
      expect(text).not.toContain("ash-map");
      expect(text).not.toContain("cigar");
    }
  });

  it("use the Artifex identity and artifexlabs.tech", () => {
    const signed = agreementSignedEmail(agreement, settings);
    expect(signed.body).toContain("Artifex");
    // The signature block carries the artifexlabs.tech identity.
    expect(all.some((m) => m.body.includes("artifexlabs.tech"))).toBe(true);
  });

  it("stay calm — no hype punctuation in subjects", () => {
    for (const m of all) expect(m.subject).not.toContain("!");
  });

  it("the deposit email carries the payment link and the correct amount", () => {
    const m = depositRequestEmail(agreement, "https://buy.stripe.com/test", settings);
    expect(m.body).toContain("https://buy.stripe.com/test");
    expect(m.body).toContain("$7,250"); // 50% of $14,500
  });
});
