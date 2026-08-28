// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ARTIFACT — Client-Closing Audit M1 (READ-ONLY audit; NOT a fix).
// These tests DOCUMENT the current, observed behavior of the closing workflow so
// the findings are reproducible and regression-visible. They assert the state as
// it exists today (including defects), deliberately NOT the desired end state.
// Each `expect` that encodes a defect is annotated FINDING-Pn.
// Do not "fix" a defect by editing these assertions — fix the source, then update.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { resolveIssuerForSnapshot } from "../billing/issuer";
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

describe("M2 — agreement contracting entity (FINDING-P0 FIXED in M2/Gate 3)", () => {
  // M1 documented that NEW agreements rendered under "Faedaway M.G. LLC". M2/Gate 3
  // moved the issuer of record to "Artifex Labs Systems LLC" for NEW records via a
  // dedicated issuer registry (billing/issuer.ts), while historical records keep
  // their frozen entity. This test is now a REGRESSION GUARD for that fix.
  it("NEW agreements freeze issuer = Artifex Labs Systems LLC", () => {
    const { content } = buildAgreementContent(
      input({ overrides: { scope: ["Website modernization"] } }),
    );
    expect(content!.issuerId).toBe("artifex-systems");
    expect(content!.artifexLegalEntity).toBe("Artifex Labs Systems LLC");
    expect(content!.artifexLegalEntity).not.toBe("Faedaway M.G. LLC");
  });

  it("historical snapshots (no issuerId) still resolve to Faedaway — never silently rebound", () => {
    const legacy = { artifexLegalEntity: "Faedaway M.G. LLC" };
    expect(resolveIssuerForSnapshot(legacy).id).toBe("faedaway");
    // A snapshot with neither issuerId nor a known entity falls back to historical,
    // NEVER the active entity — so a pre-issuer record can't bind to the new account.
    expect(resolveIssuerForSnapshot({}).id).toBe("faedaway");
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
    const c = content as unknown as Record<string, unknown>;
    expect("acceptanceCriteria" in c).toBe(false);
    expect("dependencies" in c).toBe(false);
  });
});
