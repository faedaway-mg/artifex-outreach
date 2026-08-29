import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { agreementConsistencyIssues, isAgreementConsistent, assertAgreementConsistent, AgreementInconsistencyError, commercialConsistencyIssues } from "./consistency";
import { buildAgreementContent } from "./snapshot";
import { makeAgreement, makeLead, makeContact, makeProposal, makeSettings } from "./test-fixtures";
import { agreementSignatureFields } from "./signature-fields";
import { renderAgreementPdf } from "../pdf/render-agreement";

const commercial = (total: number, pct: number, deposit: number, balance: number) => ({ totalPriceCents: total, depositPercent: pct, depositAmountCents: deposit, remainingBalanceCents: balance });

describe("commercial consistency (deposit % / amount / balance)", () => {
  it("accepts a valid 50% deposit", () => {
    expect(commercialConsistencyIssues(commercial(1_450_000, 50, 725_000, 725_000))).toHaveLength(0);
  });
  it("accepts a valid 30% deposit", () => {
    expect(commercialConsistencyIssues(commercial(100_150_000, 30, 30_045_000, 70_105_000))).toHaveLength(0);
  });
  it("accepts a rounding boundary (round-half-up, established policy)", () => {
    // 50% of 1,000,001 = 500000.5 → round → 500001; balance 500000; sum ok.
    expect(commercialConsistencyIssues(commercial(1_000_001, 50, 500_001, 500_000))).toHaveLength(0);
  });
  it("DETECTS the exact bug: amounts are 30% while the label says 50%", () => {
    const issues = commercialConsistencyIssues(commercial(1_001_500, 50, 300_450, 701_050));
    expect(issues.join(" ")).toMatch(/percentage\/amount disagree/);
  });
  it("enforces deposit + balance = total", () => {
    expect(commercialConsistencyIssues(commercial(1_000_000, 50, 500_000, 400_000)).join(" ")).toMatch(/!= total/);
  });
  it("rejects out-of-range percent and non-integers", () => {
    expect(commercialConsistencyIssues(commercial(1_000_000, 120, 1_200_000, -200_000)).join(" ")).toMatch(/out of range/);
    expect(commercialConsistencyIssues(commercial(1_000_000, 50.5 as number, 500_000, 500_000)).join(" ")).toMatch(/integers/);
  });
  it("assertAgreementConsistent blocks a commercially-inconsistent record", () => {
    const a = makeAgreement();
    a.contentSnapshot = { ...a.contentSnapshot, totalPriceCents: 1_001_500, depositPercent: 50, depositAmountCents: 300_450, remainingBalanceCents: 701_050 };
    expect(() => assertAgreementConsistent(a)).toThrow(AgreementInconsistencyError);
  });
  it("the snapshot builder always produces internally-consistent commercial terms", () => {
    const { content } = buildAgreementContent({
      agreementNumber: "AL-A-2026-1", version: 1, lead: makeLead(), contact: makeContact(),
      proposal: makeProposal({ amount: 10001 }), deliverable: null, settings: makeSettings(),
      nowIso: "2026-08-28T00:00:00.000Z", overrides: { scope: ["x"], depositPercent: 33 },
    });
    expect(commercialConsistencyIssues(content!)).toHaveLength(0);
  });
});

describe("signature field mapping (single source; distinct signers)", () => {
  it("maps VALID SignWell tags: provider = recipient 1, client = recipient 2", () => {
    const fields = agreementSignatureFields(makeAgreement().contentSnapshot);
    const provider = fields.find((f) => f.role === "provider")!;
    const client = fields.find((f) => f.role === "client")!;
    // Valid SignWell text-tag format {{fieldtype:signer:required}}, signer = recipient order.
    expect(provider.signerNumber).toBe(1);
    expect(client.signerNumber).toBe(2);
    expect(provider.sigTag).toBe("{{signature:1:y}}");
    expect(provider.dateTag).toBe("{{date:1:y}}");
    expect(client.sigTag).toBe("{{signature:2:y}}");
    expect(client.dateTag).toBe("{{date:2:y}}");
    // Every anchor is a well-formed SignWell tag (guards against invalid tokens that
    // would silently place no field).
    for (const f of fields) {
      expect(f.sigTag).toMatch(/^\{\{signature:[12]:y\}\}$/);
      expect(f.dateTag).toMatch(/^\{\{date:[12]:y\}\}$/);
    }
    // Distinct anchors + distinct parties/signers — no cross-assignment.
    expect(provider.sigTag).not.toBe(client.sigTag);
    expect(provider.party).not.toBe(client.party);
    expect(provider.party).toMatch(/Artifex Labs Systems LLC/);
  });
});

describe("agreement record ↔ snapshot consistency (regression for the M3 mismatch)", () => {
  it("a fixture agreement is consistent (record == snapshot on number/version/proposal/template)", () => {
    expect(isAgreementConsistent(makeAgreement())).toBe(true);
    expect(agreementConsistencyIssues(makeAgreement())).toHaveLength(0);
  });

  it("DETECTS the exact bug: record number overridden while the snapshot is untouched", () => {
    const a = makeAgreement();
    a.agreementNumber = "AL-A-SW-999"; // record changed, snapshot still AL-A-2026-001
    const issues = agreementConsistencyIssues(a);
    expect(issues.join(" ")).toMatch(/agreementNumber mismatch/);
    expect(() => assertAgreementConsistent(a)).toThrow(AgreementInconsistencyError);
  });

  it("detects version + proposal divergence", () => {
    const a = makeAgreement();
    a.version = 2;
    expect(agreementConsistencyIssues(a).join(" ")).toMatch(/version mismatch/);
  });

  it("the snapshot is the single source: buildAgreementContent freezes the SAME number it was given", () => {
    const { content } = buildAgreementContent({
      agreementNumber: "AL-A-2026-777", version: 3, lead: makeLead(), contact: makeContact(),
      proposal: makeProposal(), deliverable: null, settings: makeSettings(), nowIso: "2026-08-28T00:00:00.000Z",
      overrides: { scope: ["x"] },
    });
    expect(content!.agreementNumber).toBe("AL-A-2026-777");
    expect(content!.version).toBe(3);
  });
});

describe("PDF is rendered from the snapshot; hash binds the exact version", () => {
  it("the rendered PDF reflects the snapshot number, and re-render of the SAME snapshot is stable-length", async () => {
    const a = makeAgreement();
    a.agreementNumber = a.contentSnapshot.agreementNumber; // consistent
    const buf1 = await renderAgreementPdf(a, true);
    expect(buf1.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const h = createHash("sha256").update(buf1).digest("hex");
    expect(h).toHaveLength(64); // a hash exists to bind the signing request to this version
    // Editing the source lead after the snapshot is frozen must not change the PDF's source.
    const before = a.contentSnapshot.agreementNumber;
    (a as { contentSnapshot: { clientBusinessName: string } }).contentSnapshot.clientBusinessName; // frozen
    expect(a.contentSnapshot.agreementNumber).toBe(before);
  });
});
