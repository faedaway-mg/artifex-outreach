// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ARTIFACT — Client-Closing Audit M1 (READ-ONLY audit; NOT a fix).
// These tests DOCUMENT the current, observed behavior of the closing workflow so
// the findings are reproducible and regression-visible. They assert the state as
// it exists today (including defects), deliberately NOT the desired end state.
// Each `expect` that encodes a defect is annotated FINDING-Pn.
// Do not "fix" a defect by editing these assertions — fix the source, then update.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { ARTIFEX_IDENTITY } from "../identity";
import { buildAgreementContent, type BuildAgreementInput } from "./snapshot";
import {
  makeLead,
  makeContact,
  makeProposal,
  makeSettings,
} from "./test-fixtures";

function input(overrides: Partial<BuildAgreementInput> = {}): BuildAgreementInput {
  return {
    agreementNumber: "AL-A-2026-001",
    version: 1,
    lead: makeLead(),
    contact: makeContact(),
    proposal: makeProposal({ amount: 14500 }),
    deliverable: null,
    settings: makeSettings(),
    nowIso: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("AUDIT M1 — agreement contracting entity", () => {
  it("FINDING-P0: generated agreements use 'Faedaway M.G. LLC', NOT 'Artifex Labs Systems LLC'", () => {
    // Mission brief for Acquisition OS closing states the legal entity is
    // "Artifex Labs Systems LLC" (EIN obtained). The code hardcodes the parent
    // holding company instead. This is a legal-entity DECISION for the operator,
    // surfaced here — deliberately not auto-changed.
    expect(ARTIFEX_IDENTITY.legalEntity).toBe("Faedaway M.G. LLC");
    expect(ARTIFEX_IDENTITY.legalEntity).not.toBe("Artifex Labs Systems LLC");
  });
});

describe("AUDIT M1 — commercial math + snapshot binding (synthetic data)", () => {
  it("prices are integer minor units and deposit + balance reconcile to total", () => {
    const { content, errors } = buildAgreementContent(
      input({ overrides: { depositPercent: 50, scope: ["Website modernization"] } }),
    );
    expect(errors ?? []).toHaveLength(0);
    const c = content!;
    expect(Number.isInteger(c.totalPriceCents)).toBe(true);
    expect(c.totalPriceCents).toBe(1_450_000);
    expect(c.depositAmountCents + c.remainingBalanceCents).toBe(c.totalPriceCents);
    expect(c.currency).toBe("usd");
  });

  it("snapshot is immutable to later edits of the source lead (edited-after-generation)", () => {
    const lead = makeLead();
    const { content } = buildAgreementContent(
      input({ lead, overrides: { scope: ["Website modernization"] } }),
    );
    const before = content!.clientBusinessName;
    lead.businessName = "Renamed Co After Snapshot";
    expect(content!.clientBusinessName).toBe(before);
  });

  it("FINDING-P1: template has no acceptance-criteria / dependencies fields on the snapshot", () => {
    const { content } = buildAgreementContent(
      input({ overrides: { scope: ["Website modernization"] } }),
    );
    const c = content as Record<string, unknown>;
    expect("acceptanceCriteria" in c).toBe(false);
    expect("dependencies" in c).toBe(false);
  });
});
