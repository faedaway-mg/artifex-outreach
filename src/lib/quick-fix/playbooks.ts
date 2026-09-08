// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT PLAYBOOKS — "how we deliver" for every SKU. The catalog no longer
// stops at what we sell: each SKU has a deterministic, QA-gated playbook so a paid
// job becomes a known checklist, not ad-hoc planning. A job cannot be marked
// complete until every QA item and the completion criteria are satisfied.
// ─────────────────────────────────────────────────────────────────────────────
import { capabilityByKey } from "./capabilities";
import { skuFor } from "./catalog";

export interface FulfillmentPlaybook {
  fulfillmentPlaybookId: string;
  skuKey: string;
  prerequisites: string[];
  steps: string[];
  qaChecklist: string[];
  completionCriteria: string[];
  deliveryArtifacts: string[];
  rollbackRequired: boolean;
  escalationConditions: string[];
  estimatedLaborMinutes: number;
}

const STANDARD_QA = [
  "Reported issue reproduced before changes",
  "Backup / rollback path captured where applicable",
  "Verified on desktop",
  "Verified on mobile",
  "Destination/behavior verified (delivery confirmed)",
  "After-state proof captured",
];

const STANDARD_COMPLETION = [
  "All QA items pass",
  "Before + after evidence captured",
  "Completion report generated",
];

const STANDARD_ESCALATION = [
  "Required access cannot be obtained",
  "Platform limitation prevents the agreed fix",
  "Discovered complexity exceeds the purchased scope",
  "The fix cannot be safely completed",
];

/** Build the deterministic playbook for a SKU from its capability + catalog data. */
export function playbookFor(skuKey: string): FulfillmentPlaybook | null {
  const cap = capabilityByKey(skuKey);
  const sku = skuFor(skuKey);
  if (!cap || !sku) return null;
  const steps = [
    "Confirm required access is present",
    "Capture current (before) state",
    "Verify the reported issue",
    ...(cap.risk !== "low" ? ["Create a backup / rollback point"] : []),
    ...cap.includedItems.map((i) => `Implement: ${i}`),
    "Capture after-state proof",
    "Run QA checklist",
    "Generate completion report",
    "Deliver to customer",
  ];
  return {
    fulfillmentPlaybookId: `pb-${skuKey}-v1`,
    skuKey,
    prerequisites: cap.accessRequirements.map((a) => a.label),
    steps,
    qaChecklist: STANDARD_QA,
    completionCriteria: STANDARD_COMPLETION,
    deliveryArtifacts: ["completion-report", "before-screenshot", "after-screenshot", "qa-result"],
    rollbackRequired: cap.risk !== "low",
    escalationConditions: STANDARD_ESCALATION,
    estimatedLaborMinutes: Math.round(((cap.minHours + cap.maxHours) / 2) * 60),
  };
}

/** QA gate — a job may only complete when every QA item passed. */
export function canCompleteJob(playbook: FulfillmentPlaybook, qaPassed: Record<string, boolean>): { ok: boolean; missing: string[] } {
  const missing = playbook.qaChecklist.filter((item) => qaPassed[item] !== true);
  return { ok: missing.length === 0, missing };
}
