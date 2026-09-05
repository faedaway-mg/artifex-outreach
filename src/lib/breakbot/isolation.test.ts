import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { assertIsolatedStore, isolatedStoreOk, assertFakeRecipient, isFakeRecipient, BREAKBOT_PROVENANCE, RESERVED_TEST_DOMAIN } from "./isolation";
import { FIXTURES, fixturesManifestHash, fixtureById } from "./fixtures";
import { seedBreakbotFixtures, resetBreakbotNamespace, breakbotStateSummary } from "./namespace";
import { verdict, VIEWPORTS } from "./scenario";
import { testProvenanceReason } from "../outreach/dispatch-integrity";
import { shouldUseFakeOutreachProvider } from "../comms/fake-outreach-provider";
import { breakbotEnv } from "./isolation";
import { listLeads } from "../repo";

const CLEAN: Record<string, string | undefined> = { BREAKBOT_TEST_TENANT: "1" };
const savedEnv = { ...process.env };
beforeAll(() => { process.env.BREAKBOT_TEST_TENANT = "1"; delete process.env.DATABASE_URL; delete process.env.RESEND_API_KEY; delete process.env.CS_DATABASE_URL; });
afterAll(() => { process.env = savedEnv; });
beforeEach(() => { resetBreakbotNamespace(); });

describe("breakbot isolation — fail-closed store guard (mandate 19)", () => {
  it("refuses to start without the test tenant flag", () => {
    expect(() => assertIsolatedStore({})).toThrow(/BREAKBOT_TEST_TENANT/);
    expect(isolatedStoreOk({})).toBe(false);
  });
  it("refuses when a real DATABASE_URL would resolve to production", () => {
    expect(() => assertIsolatedStore({ ...CLEAN, DATABASE_URL: "postgres://prod/db" })).toThrow(/DATABASE_URL/);
  });
  it("refuses when CS_DATABASE_URL or a real RESEND_API_KEY is present", () => {
    expect(() => assertIsolatedStore({ ...CLEAN, CS_DATABASE_URL: "postgres://x" })).toThrow(/CS_DATABASE_URL/);
    expect(() => assertIsolatedStore({ ...CLEAN, RESEND_API_KEY: "re_live_xxx" })).toThrow(/RESEND_API_KEY/);
  });
  it("accepts a genuinely isolated tenant", () => {
    expect(isolatedStoreOk(CLEAN)).toBe(true);
  });
});

describe("breakbot fake-recipient enforcement", () => {
  it("rejects real-world recipient domains, accepts example.invalid", () => {
    expect(() => assertFakeRecipient("owner@realbusiness.com")).toThrow(/reserved/);
    expect(isFakeRecipient("ops+x@example.invalid")).toBe(true);
    expect(isFakeRecipient("a@sub.example.invalid")).toBe(true);
    expect(isFakeRecipient("a@gmail.com")).toBe(false);
  });
});

describe("breakbot deterministic fixtures", () => {
  it("has 10 fixtures, all synthetic provenance + fake recipients + non-dispatchable", () => {
    expect(FIXTURES).toHaveLength(10);
    for (const f of FIXTURES) {
      expect(f.source).toBe(BREAKBOT_PROVENANCE);
      expect(isFakeRecipient(f.recipient)).toBe(true);
      expect(f.recipient.endsWith(RESERVED_TEST_DOMAIN)).toBe(true);
      expect(f.expects.dispatchable).toBe(false);
    }
  });
  it("manifest hash is deterministic (stable across calls)", () => {
    expect(fixturesManifestHash()).toBe(fixturesManifestHash());
    expect(fixtureById("bb_fx_email_video")?.expects.packageType).toBe("EMAIL_VIDEO");
  });
});

describe("breakbot seed / reset determinism + isolation", () => {
  it("seeds 10 fixture leads with a stable manifest hash; reset clears them; reseed is identical", async () => {
    const a = await seedBreakbotFixtures();
    expect(a.count).toBe(10);
    expect((await listLeads()).length).toBe(10);
    const h1 = a.manifestHash;
    resetBreakbotNamespace();
    expect((await listLeads()).length).toBe(0); // reset removes only the scenario namespace
    const b = await seedBreakbotFixtures();
    expect(b.manifestHash).toBe(h1); // deterministic
    const s = await breakbotStateSummary();
    expect(s.breakbotLeads).toBe(10);
    expect(s.realRecipients).toBe(0); // NEVER a real recipient
  });

  it("seed refuses if the store is not isolated (fail-closed, no production fallback)", async () => {
    process.env.DATABASE_URL = "postgres://prod/db";
    await expect(seedBreakbotFixtures()).rejects.toThrow(/DATABASE_URL/);
    delete process.env.DATABASE_URL;
  });
});

describe("production boundary rejects breakbot provenance (mandate 17 guard, still live)", () => {
  it("every seeded fixture would be rejected by the production integrity boundary", () => {
    for (const f of FIXTURES) expect(testProvenanceReason({ source: f.source, businessName: f.businessName, test_only: true })).not.toBeNull();
  });
});

describe("breakbot provider-off enforcement", () => {
  it("selects the fake in-process provider under the breakbot env and NEVER when a real key is present", () => {
    const env = { ...breakbotEnv(), NODE_ENV: "development" } as any;
    expect(shouldUseFakeOutreachProvider(env)).toBe(true);
    // a real key present → the fake is refused (production provider path), so breakbot would fail-closed earlier
    expect(shouldUseFakeOutreachProvider({ ...env, RESEND_API_KEY: "re_live_x" } as any)).toBe(false);
    // no flag → never the fake
    expect(shouldUseFakeOutreachProvider({ NODE_ENV: "development" } as any)).toBe(false);
  });
});

describe("scenario contract", () => {
  it("verdict fails when any assertion fails or contamination invariants break; 3 widths defined", () => {
    expect(VIEWPORTS.map((v) => v.label)).toEqual(["mobile", "tablet", "desktop"]);
    const ok = verdict({ name: "t", goal: "g", viewport: "mobile", startingFixtures: [], actions: [], assertions: [{ name: "a", ok: true }], fakeProviderCalls: 1, externalProviderCalls: 0, productionMutations: 0, screenshots: [], tracePath: null });
    expect(ok.pass).toBe(true);
    const bad = verdict({ ...ok, assertions: [{ name: "a", ok: false, detail: "x" }], externalProviderCalls: 1 });
    expect(bad.pass).toBe(false);
    expect(bad.failReasons.length).toBe(2);
  });
});
