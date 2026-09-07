import { describe, it, expect } from "vitest";
import { TARGETING_ACTIONS, targetingActionIds } from "./targeting-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["targeting.board", "targeting.backlog-counts", "targeting.next-market", "targeting.qualified-list", "targeting.target-card", "targeting.why-business", "targeting.score-breakdown", "targeting.recommended-asset", "targeting.recipient", "targeting.back"];

describe("mandate 27 — targeting action manifest completeness", () => {
  it("every action is fully specified + read-only", () => {
    for (const a of TARGETING_ACTIONS) {
      for (const f of ["id", "surface", "goal", "expectedUi", "countInvariant", "deterministicTest"] as const) expect(a[f], `${a.id}.${f}`).toBeTruthy();
      expect(a.sideEffect).toBe("none"); // the Targeting view NEVER mutates/schedules/sends
    }
  });
  it("action IDs are unique + cover every canonical targeting control", () => {
    const ids = targetingActionIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(REQUIRED.filter((r) => !ids.includes(r))).toHaveLength(0);
  });
  it("every DOM marker is rendered by a targeting surface (dead-registration detection)", () => {
    const root = process.cwd();
    const src = [
      "src/app/(app)/targeting/page.tsx",
      "src/app/(app)/targeting/[leadId]/page.tsx",
    ].map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    for (const a of TARGETING_ACTIONS) {
      if (!a.domMarker) continue;
      const attr = a.domMarker.replace(/^\[/, "").replace(/\]$/, "").split("=")[0];
      expect(src.includes(attr), `marker ${a.domMarker} (${a.id}) not rendered`).toBe(true);
    }
  });
});
