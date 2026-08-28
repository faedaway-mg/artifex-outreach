import { describe, it, expect } from "vitest";
import { shouldSpawnLocally } from "./runner";

// The web endpoint must NEVER fork a renderer in production (fail closed) — a separate worker renders.
describe("shouldSpawnLocally (production enqueue-only guard)", () => {
  it("spawns in local dev", () => {
    expect(shouldSpawnLocally({ NODE_ENV: "development" } as any)).toBe(true);
    expect(shouldSpawnLocally({} as any)).toBe(true);
  });
  it("does NOT spawn in production (enqueue-only)", () => {
    expect(shouldSpawnLocally({ NODE_ENV: "production" } as any)).toBe(false);
  });
  it("CS_RENDER_MODE=worker forces enqueue-only anywhere", () => {
    expect(shouldSpawnLocally({ NODE_ENV: "development", CS_RENDER_MODE: "worker" } as any)).toBe(false);
  });
  it("CS_RENDER_MODE=local is an explicit opt-in only", () => {
    expect(shouldSpawnLocally({ NODE_ENV: "production", CS_RENDER_MODE: "local" } as any)).toBe(true);
  });
});
