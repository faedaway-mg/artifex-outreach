import { describe, it, expect } from "vitest";
import { renderAgreementPdf } from "./render-agreement";
import { buildAgreementSections } from "../agreement/template";
import { makeAgreement } from "../agreement/test-fixtures";

describe("agreement PDF", () => {
  it("renders a valid multi-page PDF buffer", async () => {
    const buf = await renderAgreementPdf(makeAgreement(), true);
    expect(buf.byteLength).toBeGreaterThan(1000);
    // PDF magic header.
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("handles long scope and deliverables without throwing", async () => {
    const agreement = makeAgreement();
    agreement.contentSnapshot = {
      ...agreement.contentSnapshot,
      scope: Array.from({ length: 30 }, (_, i) => `Scope item ${i + 1}: ${"a detailed line of work ".repeat(6)}`),
      deliverables: Array.from({ length: 25 }, (_, i) => `Deliverable ${i + 1}`),
      exclusions: Array.from({ length: 10 }, (_, i) => `Exclusion ${i + 1}`),
    };
    const buf = await renderAgreementPdf(agreement, false);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("builds all 27 numbered sections including signature blocks with text-tag anchors", () => {
    const sections = buildAgreementSections(makeAgreement().contentSnapshot);
    expect(sections).toHaveLength(27);
    expect(sections[0].heading).toBe("Parties");
    const sig = sections[26];
    expect(sig.heading).toBe("Signature Blocks");
    // Valid SignWell text tags (signer 1 = provider, signer 2 = client).
    expect(sig.body.join("\n")).toContain("{{signature:2:y}}");
    expect(sig.body.join("\n")).toContain("{{signature:1:y}}");
  });
});
