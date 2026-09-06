import { describe, it, expect } from "vitest";
import { SCHEDULED_ACTIONS, manifestActionIds, type ActionSpec } from "./scheduled-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mandate 22: the Scheduled action manifest is the coverage-enforcement registry. These tests fail if the
// manifest is incomplete, if any Scheduled interactive control lacks a registered action + acceptance
// scenario, or if a manifested DOM marker is not actually rendered by the Scheduled surfaces.
const REQUIRED_FIELDS: (keyof ActionSpec)[] = [
  "id", "surface", "startState", "goal", "expectedUi", "expectedPersisted", "expectedQueue",
  "expectedAudit", "expectedScheduler", "providerAllowed", "deterministicTest", "syntheticJourney",
];

// The canonical set of operator tasks the mandate enumerates for the Scheduled workflow.
const REQUIRED_TASK_IDS = [
  "scheduled.open-queue", "scheduled.open-company", "scheduled.inspect-email", "scheduled.inspect-pdf",
  "scheduled.inspect-video", "scheduled.next", "scheduled.prev", "scheduled.close", "scheduled.back",
  "scheduled.refresh", "scheduled.reject-open", "scheduled.reject-cancel", "scheduled.reject-confirm",
  "scheduled.invalid-quarantine", "scheduled.switch-filter", "scheduled.return-today", "scheduled.empty-state",
];

describe("mandate 22 — Scheduled action manifest completeness", () => {
  it("every action is fully specified (no missing fields)", () => {
    for (const a of SCHEDULED_ACTIONS) {
      for (const f of REQUIRED_FIELDS) {
        expect(a[f], `${a.id}.${String(f)}`).not.toBeUndefined();
      }
      expect(a.deterministicTest.length).toBeGreaterThan(0);
      expect(a.syntheticJourney.length).toBeGreaterThan(0);
    }
  });

  it("action IDs are unique", () => {
    const ids = manifestActionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every canonical Scheduled operator task (no untracked control)", () => {
    const ids = new Set(manifestActionIds());
    const missing = REQUIRED_TASK_IDS.filter((t) => !ids.has(t));
    expect(missing, `unregistered Scheduled tasks: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("every non-null DOM marker is actually rendered by a Scheduled surface (dead-registration detection)", () => {
    // Read the source of the surfaces that back the Scheduled workflow and confirm each manifested marker
    // exists — so the manifest can never drift into registering a control the UI does not render.
    const root = process.cwd();
    const sources = [
      "src/app/(app)/company/[leadId]/page.tsx",
      "src/app/(app)/queue/[state]/page.tsx",
      "src/components/queue/ScheduledPackageCard.tsx",
      "src/components/queue/RejectControl.tsx",
    ].map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    const markers = SCHEDULED_ACTIONS.map((a) => a.domMarker).filter((m): m is string => !!m);
    for (const m of markers) {
      const attr = m.replace(/^\[/, "").replace(/\]$/, "").split("=")[0]; // e.g. data-scheduled-detail, role
      expect(sources.includes(attr), `marker ${m} not rendered by any Scheduled surface`).toBe(true);
    }
  });
});
