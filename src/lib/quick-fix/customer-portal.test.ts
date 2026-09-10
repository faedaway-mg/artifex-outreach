import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { seedDemoScenarios } from "./demo-fulfillment";
import { buildCustomerPortalView } from "./customer-portal";

// Customer Portal proofs (mandate CP2/CP3 · §15 security · §33 tests). Uses the isolated demo fixtures
// (reserved non-deliverable domain — no real customer, no charge, no external email) to prove: the three
// fulfillment scenarios each render a correct customer-facing portal; portals are project-scoped (no
// cross-customer access); an invalid token opens nothing; and no internal field / secret ever leaks.

beforeEach(() => { __resetStoreForTests(); });

async function seededByKey() {
  const results = await seedDemoScenarios();
  return Object.fromEntries(results.map((r) => [r.key, r]));
}

describe("Customer Portal — the three fulfillment fixtures each project a correct portal", () => {
  it("Fixture A (wordpress-happy, work underway) → WORKING stage, calm 5-step journey", async () => {
    const by = await seededByKey();
    const v = await buildCustomerPortalView(by["wordpress-happy"].offerId);
    expect(v).not.toBeNull();
    expect(v!.stage).toBe("WORKING");
    expect(v!.stages).toHaveLength(5);
    expect(v!.stages.filter((s) => s.done).length).toBeGreaterThanOrEqual(1);
    // exactly one dominant current action, customer-safe
    expect(v!.currentAction).not.toBeNull();
  });

  it("Fixture B (unknown-platform, waiting for access) → ACCESS_NEEDED with a clear 'grant access' step", async () => {
    const by = await seededByKey();
    const v = await buildCustomerPortalView(by["unknown-platform"].offerId);
    expect(v!.stage).toBe("ACCESS_NEEDED");
    expect(v!.currentAction?.headline.toLowerCase()).toMatch(/access|confirm|details/);
    // the customer is told what they owe; we NEVER ask for a password
    expect(v!.accessNeverAskFor.join(" ").toLowerCase()).toMatch(/password|one-time|credential/);
  });

  it("Fixture (ready-for-qa) → TESTING stage before the delivery gate opens", async () => {
    const by = await seededByKey();
    const v = await buildCustomerPortalView(by["ready-for-qa"].offerId);
    expect(v!.stage).toBe("TESTING");
    // completion report is NOT exposed before DELIVERED
    expect(v!.completionReport).toBeNull();
  });
});

describe("Customer Portal — security (CP3 / §15): scoping, isolation, no leakage", () => {
  it("cross-customer isolation: customer A's portal never exposes customer B's project", async () => {
    const by = await seededByKey();
    const a = await buildCustomerPortalView(by["wordpress-happy"].offerId);
    const b = await buildCustomerPortalView(by["unknown-platform"].offerId);
    expect(a!.offerId).not.toBe(b!.offerId);
    expect(a!.company).not.toBe(b!.company);
    // Resolving B's accessor returns B's project, never A's — and A's company/offerId never appear in B.
    const bJson = JSON.stringify(b);
    expect(bJson).not.toContain(a!.company);
    expect(bJson).not.toContain(a!.offerId);
  });

  it("an invalid / modified token opens nothing (no fallback to another project)", async () => {
    await seededByKey();
    expect(await buildCustomerPortalView("qfo_not_a_real_offer")).toBeNull();
    expect(await buildCustomerPortalView("")).toBeNull();
    expect(await buildCustomerPortalView("../admin")).toBeNull();
  });

  it("no internal fields / secrets ever appear in the customer payload", async () => {
    const by = await seededByKey();
    const v = await buildCustomerPortalView(by["wordpress-happy"].offerId);
    const json = JSON.stringify(v).toLowerCase();
    // Internal-only operational fields must never surface. (Note: customer-SAFE copy legitimately says
    // "we never ask for your password" etc., so we scan for INTERNAL FIELD NAMES, not safety words.)
    for (const forbidden of ["operatornote", "technicianrunbook", "runbookstep", "leadscore", "acquisitionscore", "scorebreakdown", "economics", "grossmargin", "breakbot", "apikey", "api_key", "bearer ", "secretkey"]) {
      expect(json, `leaked: ${forbidden}`).not.toContain(forbidden);
    }
    // the portal view shape carries no credential field on access items
    for (const a of v!.access) {
      expect(Object.keys(a)).not.toContain("password");
      expect(Object.keys(a)).not.toContain("secret");
      expect(Object.keys(a)).not.toContain("credential");
    }
  });

  it("access instructions never ask the customer to send a stored password back", async () => {
    const by = await seededByKey();
    const v = await buildCustomerPortalView(by["unknown-platform"].offerId);
    expect(v!.screenshotCredentialWarning.toLowerCase()).toMatch(/password|credential|one-time/);
  });
});
