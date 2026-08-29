import { describe, it, expect } from "vitest";
import { buildObjectKey, isValidObjectKey } from "./cs-object-key";

describe("buildObjectKey — canonical, safe, version-bound", () => {
  it("builds class-specific keys with env + owner + version", () => {
    expect(buildObjectKey({ artifactClass: "upload", env: "staging", operatorId: "jordan", version: "up123", ext: "mp3" }))
      .toBe("content-studio/staging/upload/jordan/up123.mp3");
    expect(buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "csjob_abc", version: "v05c15379", ext: "mp4" }))
      .toBe("content-studio/production/render-output/csjob_abc/v05c15379.mp4");
    expect(buildObjectKey({ artifactClass: "poster", env: "production", jobId: "csjob_abc", version: "v05c15379", ext: "jpg" }))
      .toBe("content-studio/production/poster/csjob_abc/v05c15379.jpg");
    expect(buildObjectKey({ artifactClass: "share-media", env: "production", shareToken: "7cf56fc6", version: "v1", ext: "mp4" }))
      .toBe("content-studio/production/share-media/7cf56fc6/v1.mp4");
  });

  it("is version-bound: regeneration (new version) yields a NEW key; approved output key is stable", () => {
    const v1 = buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "j", version: "v1", ext: "mp4" });
    const v2 = buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "j", version: "v2", ext: "mp4" });
    expect(v1).not.toBe(v2); // regenerate → new key, old approved artifact untouched
    expect(buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "j", version: "v1", ext: "mp4" })).toBe(v1); // stable
  });

  it("rejects path traversal / raw filenames / arbitrary segments (fail closed)", () => {
    expect(() => buildObjectKey({ artifactClass: "upload", env: "production", operatorId: "../../etc", version: "x", ext: "mp3" })).toThrow(/unsafe/);
    expect(() => buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "a/b", version: "v", ext: "mp4" })).toThrow(/unsafe/);
    expect(() => buildObjectKey({ artifactClass: "poster", env: "production", jobId: "j", version: "my file.png", ext: "png" })).toThrow(/unsafe/);
    expect(() => buildObjectKey({ artifactClass: "poster", env: "production", jobId: "j", version: "v", ext: "../sh" })).toThrow(/unsafe ext/);
    expect(() => buildObjectKey({ artifactClass: "render-output", env: "prod", jobId: "j", version: "v", ext: "mp4" })).toThrow(/unknown env/);
    expect(() => buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "", version: "v", ext: "mp4" })).toThrow(/unsafe jobId/);
  });

  it("no collision across classes/jobs/envs for the same version", () => {
    const keys = new Set([
      buildObjectKey({ artifactClass: "render-output", env: "staging", jobId: "j1", version: "v", ext: "mp4" }),
      buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "j1", version: "v", ext: "mp4" }),
      buildObjectKey({ artifactClass: "render-output", env: "production", jobId: "j2", version: "v", ext: "mp4" }),
      buildObjectKey({ artifactClass: "poster", env: "production", jobId: "j1", version: "v", ext: "jpg" }),
    ]);
    expect(keys.size).toBe(4); // all distinct
  });
});

describe("isValidObjectKey — reject arbitrary/hostile keys at the boundary", () => {
  it("accepts well-formed keys", () => {
    expect(isValidObjectKey("content-studio/production/render-output/j/v1.mp4")).toBe(true);
    expect(isValidObjectKey("content-studio/staging/upload/op/up1.mp3")).toBe(true);
  });
  it("rejects traversal, absolute, wrong prefix, bad class/env, and missing ext", () => {
    expect(isValidObjectKey("content-studio/production/render-output/../secret.mp4")).toBe(false);
    expect(isValidObjectKey("/etc/passwd")).toBe(false);
    expect(isValidObjectKey("other/production/render-output/j/v.mp4")).toBe(false);
    expect(isValidObjectKey("content-studio/prod/render-output/j/v.mp4")).toBe(false);
    expect(isValidObjectKey("content-studio/production/evil/j/v.mp4")).toBe(false);
    expect(isValidObjectKey("content-studio/production/render-output/j/noext")).toBe(false);
    expect(isValidObjectKey("")).toBe(false);
  });
});
