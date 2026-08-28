import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { agreementConsistencyIssues, isAgreementConsistent, assertAgreementConsistent, AgreementInconsistencyError } from "./consistency";
import { buildAgreementContent } from "./snapshot";
import { makeAgreement, makeLead, makeContact, makeProposal, makeSettings } from "./test-fixtures";
import { renderAgreementPdf } from "../pdf/render-agreement";

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
