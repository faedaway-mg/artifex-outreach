import { describe, it, expect } from "vitest";
import { STUDIO_ACTIONS, studioActionIds, type StudioActionSpec } from "./studio-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mandate 23: the Content Studio / media action manifest is the coverage-enforcement registry. CI fails if
// the manifest is incomplete, an action is under-specified, or a manifested DOM marker is not rendered by a
// Studio/media surface (dead-registration detection).
const REQUIRED: (keyof StudioActionSpec)[] = ["id", "surface", "precondition", "goal", "expectedUi", "expectedPersisted", "queueCount", "audit", "sideEffect", "deterministicTest", "syntheticJourney"];

const REQUIRED_IDS = [
  "studio.open", "studio.open-company", "studio.preview-video", "studio.close-preview", "studio.back-preview",
  "studio.escape-preview", "studio.download", "studio.upload-narration", "studio.observe-rendering",
  "studio.retry-failed-render", "studio.preview-completed", "studio.reject", "studio.return-today", "studio.missing-artifact",
  // mandate 25 — two tabs + expand-and-personalize
  "studio.tab-proposal", "studio.tab-content", "studio.tab-back-refresh", "studio.workspace-group", "studio.workspace-empty",
  "studio.select-card", "studio.inspect-quality", "studio.resolve-ambiguous", "studio.expand-open", "studio.expand-run",
  "studio.expand-compare", "studio.expand-edit", "studio.expand-regenerate", "studio.expand-accept", "studio.expand-cancel",
  "studio.upload-replacement-narration", "studio.rerender-after-revision",
];

describe("mandate 23 — Content Studio action manifest completeness", () => {
  it("every action is fully specified", () => {
    for (const a of STUDIO_ACTIONS) for (const f of REQUIRED) expect(a[f], `${a.id}.${String(f)}`).not.toBeUndefined();
  });
  it("action IDs are unique", () => { const ids = studioActionIds(); expect(new Set(ids).size).toBe(ids.length); });
  it("covers every canonical Studio/media task", () => {
    const ids = new Set(studioActionIds());
    const missing = REQUIRED_IDS.filter((t) => !ids.has(t));
    expect(missing, `unregistered: ${missing.join(", ")}`).toHaveLength(0);
  });
  it("side-effect allowances are honest (only upload/retry may trigger a render; none call a provider)", () => {
    for (const a of STUDIO_ACTIONS) {
      expect(a.sideEffect).not.toBe("provider"); // media/studio actions NEVER contact an email provider
      if (a.sideEffect === "render") expect(/upload|retry|rerender/.test(a.id)).toBe(true);
    }
  });
  it("every non-null DOM marker is rendered by a Studio/media surface (dead-registration detection)", () => {
    const root = process.cwd();
    const sources = [
      "src/components/content-studio/OperatorVideoPreview.tsx",
      "src/components/queue/ScheduledPackageCard.tsx",
      "src/app/(app)/company/[leadId]/page.tsx",
      "src/app/(app)/queue/[state]/page.tsx",
      "src/components/queue/RejectControl.tsx",
      "src/components/content-studio/ContentStudioClient.tsx",
    ].map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    for (const a of STUDIO_ACTIONS) {
      if (!a.domMarker) continue;
      const attr = a.domMarker.replace(/^\[/, "").replace(/\]$/, "").split("=")[0];
      expect(sources.includes(attr), `marker ${a.domMarker} (${a.id}) not rendered by any Studio surface`).toBe(true);
    }
  });
});
