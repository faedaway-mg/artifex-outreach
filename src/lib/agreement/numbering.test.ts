import { describe, it, expect } from "vitest";
import { nextProposalNumber, nextAgreementNumber } from "./numbering";

describe("document numbering", () => {
  it("issues the first number of the year", () => {
    expect(nextProposalNumber([], "2026-03-01T00:00:00Z")).toBe("AL-P-2026-001");
    expect(nextAgreementNumber([], "2026-03-01T00:00:00Z")).toBe("AL-A-2026-001");
  });

  it("increments past the highest issued number", () => {
    expect(nextProposalNumber(["AL-P-2026-001", "AL-P-2026-004", null], "2026-06-01T00:00:00Z")).toBe("AL-P-2026-005");
    expect(nextAgreementNumber(["AL-A-2026-001", "AL-A-2026-002"], "2026-06-01T00:00:00Z")).toBe("AL-A-2026-003");
  });

  it("scopes the sequence per year and per kind", () => {
    const existing = ["AL-P-2025-009", "AL-A-2026-002"];
    expect(nextProposalNumber(existing, "2026-01-02T00:00:00Z")).toBe("AL-P-2026-001");
    expect(nextAgreementNumber(existing, "2026-01-02T00:00:00Z")).toBe("AL-A-2026-003");
  });

  it("ignores unrelated prefixes", () => {
    expect(nextAgreementNumber(["AL-P-2026-050"], "2026-01-02T00:00:00Z")).toBe("AL-A-2026-001");
  });
});
