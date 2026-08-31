import { describe, it, expect, afterEach } from "vitest";
import { resolveStorageMode, getArtifactStore, __setArtifactStoreForTests, type ArtifactStore } from "./storage-factory";

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
afterEach(() => __setArtifactStoreForTests(null));

describe("storage-factory config (fail-closed)", () => {
  it("development, no provider → local", () => {
    expect(resolveStorageMode(env({ NODE_ENV: "development" }))).toBe("local");
  });
  it("explicit local in dev → local", () => {
    expect(resolveStorageMode(env({ NODE_ENV: "development", CS_STORAGE_PROVIDER: "local" }))).toBe("local");
  });
  it("staging PostgreSQL (provider + CS_DATABASE_URL) → postgres", () => {
    expect(resolveStorageMode(env({ NODE_ENV: "production", CS_STORAGE_PROVIDER: "postgres", CS_DATABASE_URL: "postgres://x" }))).toBe("postgres");
  });
  it("production PostgreSQL (provider + DATABASE_URL) → postgres", () => {
    expect(resolveStorageMode(env({ NODE_ENV: "production", CS_STORAGE_PROVIDER: "postgres", DATABASE_URL: "postgres://x" }))).toBe("postgres");
  });
  it("missing provider in PRODUCTION → FAIL CLOSED (no silent local fallback)", () => {
    expect(() => resolveStorageMode(env({ NODE_ENV: "production" }))).toThrow(/FAIL-CLOSED.*production requires/);
  });
  it("postgres provider but NO database url → FAIL CLOSED", () => {
    expect(() => resolveStorageMode(env({ NODE_ENV: "production", CS_STORAGE_PROVIDER: "postgres" }))).toThrow(/FAIL-CLOSED.*DATABASE_URL/);
  });
  it("unknown provider → FAIL CLOSED", () => {
    expect(() => resolveStorageMode(env({ NODE_ENV: "development", CS_STORAGE_PROVIDER: "magic-cloud" }))).toThrow(/unknown CS_STORAGE_PROVIDER/);
  });
  it("local provider in PRODUCTION is PROHIBITED → FAIL CLOSED", () => {
    expect(() => resolveStorageMode(env({ NODE_ENV: "production", CS_STORAGE_PROVIDER: "local" }))).toThrow(/prohibited in production/);
  });
  it("test-injected adapter is returned regardless of config", () => {
    const fake = { mode: "postgres" } as ArtifactStore;
    __setArtifactStoreForTests(fake);
    expect(getArtifactStore(env({ NODE_ENV: "production" }))).toBe(fake); // no throw, returns injected
  });
});

describe("local ArtifactStore round-trip (unified interface)", () => {
  it("put → getMeta → readRange → readFull → exists → del", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const os = await import("node:path");
    const dir = mkdtempSync(os.join(tmpdir(), "cs-sf-"));
    process.env.CONTENT_STUDIO_DATA_DIR = dir; // localRoot() reads this dynamically
    const store = getArtifactStore(env({ NODE_ENV: "test", CS_STORAGE_PROVIDER: "local" }));
    const body = Buffer.from("hello-artifact-bytes-0123456789");
    await store.put("content-studio/output/x.mp4", body, { artifactClass: "render-output", contentType: "video/mp4", jobId: "j1" });
    const meta = await store.getMeta("content-studio/output/x.mp4");
    expect(meta?.size).toBe(body.length);
    expect(meta?.contentType).toBe("video/mp4");
    const range = await store.readRange("content-studio/output/x.mp4", 0, 4);
    expect(range?.toString()).toBe("hello");
    const full = await store.readFull("content-studio/output/x.mp4");
    expect(full?.equals(body)).toBe(true);
    expect(await store.exists("content-studio/output/x.mp4")).toBe(true);
    await store.del("content-studio/output/x.mp4");
    expect(await store.exists("content-studio/output/x.mp4")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CONTENT_STUDIO_DATA_DIR;
  });
});
