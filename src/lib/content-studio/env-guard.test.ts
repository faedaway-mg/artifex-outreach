import { describe, it, expect } from "vitest";
import { csEnvironment, assertStagingAcceptanceSafe, assertProductionRuntimeSafe } from "./env-guard";

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
const stagingOk = { CS_ENV: "staging", CS_STORAGE_PROVIDER: "postgres", CS_DATABASE_URL: "postgres://host/artifex_outreach_staging", CS_STAGING_MARKER: "stg-1" };

describe("csEnvironment", () => {
  it("resolves CS_ENV then NODE_ENV", () => {
    expect(csEnvironment(env({ CS_ENV: "staging" }))).toBe("staging");
    expect(csEnvironment(env({ NODE_ENV: "production" }))).toBe("production");
    expect(csEnvironment(env({}))).toBe("development");
  });
});

describe("assertStagingAcceptanceSafe (fail closed)", () => {
  it("passes a proper staging config", () => {
    expect(() => assertStagingAcceptanceSafe(env(stagingOk))).not.toThrow();
  });
  it("refuses when environment is production", () => {
    expect(() => assertStagingAcceptanceSafe(env({ ...stagingOk, CS_ENV: "production" }))).toThrow(/production/);
  });
  it("refuses without a staging marker", () => {
    expect(() => assertStagingAcceptanceSafe(env({ ...stagingOk, CS_STAGING_MARKER: undefined }))).toThrow(/STAGING_MARKER/);
  });
  it("refuses a production-looking database URL", () => {
    expect(() => assertStagingAcceptanceSafe(env({ ...stagingOk, CS_DATABASE_URL: "postgres://host/artifex_outreach_production" }))).toThrow(/production application DB/);
  });
  it("refuses local storage", () => {
    expect(() => assertStagingAcceptanceSafe(env({ ...stagingOk, CS_STORAGE_PROVIDER: "local" }))).toThrow(/PostgreSQL/);
  });
  it("refuses when a delivery/autosend flag is ON", () => {
    expect(() => assertStagingAcceptanceSafe(env({ ...stagingOk, COMMS_PROSPECT_DELIVERY_ENABLED: "1" }))).toThrow(/delivery\/autosend/);
  });
});

describe("assertProductionRuntimeSafe (fail closed)", () => {
  const prodOk = { CS_ENV: "production", CS_STORAGE_PROVIDER: "postgres", DATABASE_URL: "postgres://prod" };
  it("passes a proper production config", () => {
    expect(() => assertProductionRuntimeSafe(env(prodOk))).not.toThrow();
  });
  it("refuses local render in production", () => {
    expect(() => assertProductionRuntimeSafe(env({ ...prodOk, CS_RENDER_MODE: "local" }))).toThrow(/must not render/);
  });
  it("refuses a staging marker in production", () => {
    expect(() => assertProductionRuntimeSafe(env({ ...prodOk, CS_STAGING_MARKER: "stg" }))).toThrow(/staging marker/);
  });
  it("refuses local storage in production (via the fail-closed resolver)", () => {
    expect(() => assertProductionRuntimeSafe(env({ CS_ENV: "production", CS_STORAGE_PROVIDER: "local" }))).toThrow(/PostgreSQL|prohibited/);
  });
  it("is a no-op outside production", () => {
    expect(() => assertProductionRuntimeSafe(env({ CS_ENV: "development" }))).not.toThrow();
  });
});
