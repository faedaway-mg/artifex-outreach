import { describe, it, expect } from "vitest";
import { SPRINT_ACTIONS, sprintActionIds } from "./sprint-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["sprint.start", "sprint.batch", "sprint.screen", "sprint.why", "sprint.recipient", "sprint.copy", "sprint.upload", "sprint.transcript", "sprint.stay", "sprint.next", "sprint.skip", "sprint.attention", "sprint.reject", "sprint.progress", "sprint.exit", "sprint.summary"];

describe("mandate 28 — sprint action manifest completeness", () => {
  it("every action is fully specified + provider-zero", () => {
    for (const a of SPRINT_ACTIONS) {
      for (const f of ["id", "surface", "goal", "persisted", "audit", "queueCount", "deterministicTest"] as const) expect(a[f], `${a.id}.${f}`).toBeTruthy();
      expect(a.provider).toBe("none"); // the Sprint NEVER contacts an email provider
    }
  });
  it("action IDs unique + cover every canonical sprint control", () => {
    const ids = sprintActionIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(REQUIRED.filter((r) => !ids.includes(r))).toHaveLength(0);
  });
  it("every DOM marker is rendered by a sprint surface (dead-registration detection)", () => {
    const root = process.cwd();
    const src = [
      "src/components/outreach-review/SprintClient.tsx",
      "src/app/(app)/content-studio/outreach-reviews/sprint/page.tsx",
    ].map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    for (const a of SPRINT_ACTIONS) {
      if (!a.domMarker) continue;
      const attr = a.domMarker.replace(/^\[/, "").replace(/\]$/, "").split("=")[0];
      expect(src.includes(attr), `marker ${a.domMarker} (${a.id}) not rendered`).toBe(true);
    }
  });
});
