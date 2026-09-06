import { describe, it, expect } from "vitest";
import { ATTENTION_ACTIONS, attentionActionIds, type AttentionActionSpec } from "./attention-manifest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED: (keyof AttentionActionSpec)[] = ["id", "surface", "precondition", "goal", "expectedUi", "expectedPersisted", "queueCount", "audit", "sideEffect", "deterministicTest", "syntheticJourney"];
const REQUIRED_IDS = ["attention.open-queue", "attention.inspect-reason", "attention.prepare-follow-up", "attention.hold", "attention.cancel", "attention.confirm", "attention.reject", "attention.preview-video", "attention.back", "attention.refresh", "attention.empty-state"];

describe("mandate 24 — Needs Attention action manifest completeness", () => {
  it("every action fully specified", () => { for (const a of ATTENTION_ACTIONS) for (const f of REQUIRED) expect(a[f], `${a.id}.${String(f)}`).not.toBeUndefined(); });
  it("action IDs unique", () => { const ids = attentionActionIds(); expect(new Set(ids).size).toBe(ids.length); });
  it("covers every canonical Needs Attention task", () => { const ids = new Set(attentionActionIds()); expect(REQUIRED_IDS.filter((t) => !ids.has(t))).toHaveLength(0); });
  it("no attention action contacts a provider", () => { for (const a of ATTENTION_ACTIONS) expect(a.sideEffect).not.toBe("provider"); });
  it("every DOM marker is rendered by a Needs Attention surface (dead-registration detection)", () => {
    const root = process.cwd();
    const src = ["src/components/queue/AttentionCard.tsx", "src/app/(app)/queue/[state]/page.tsx", "src/components/queue/RejectControl.tsx", "src/components/content-studio/OperatorVideoPreview.tsx"]
      .map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    for (const a of ATTENTION_ACTIONS) { if (!a.domMarker) continue; const attr = a.domMarker.replace(/^\[/, "").replace(/\]$/, "").split("=")[0]; expect(src.includes(attr), `marker ${a.domMarker} (${a.id}) not rendered`).toBe(true); }
  });
});
