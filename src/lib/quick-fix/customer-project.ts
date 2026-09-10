// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER PROJECT MODEL (Customer Portal mandate CP1 / §20-21) — the SCALE-READY project model the
// customer portal projects from. Quick-Fix uses a LIGHTWEIGHT SUBSET (a few phases/milestones), but the
// SAME model can represent a multi-week/month commercial or government engagement (Discovery → Design →
// … → Completion) without being replaced. This is the foundation the mandate insists on: "Do not build a
// disposable Quick-Fix-only portal that must be replaced later."
//
// PURE + DETERMINISTIC — no I/O, no fabrication. It references the canonical order/customer by id (never
// duplicates identity). Progress is DERIVED from real milestone completion, never an invented percentage.
// This module defines the model + the pure derivations; persistence + the internal→customer projection
// (CP2) and secure access (CP3) build on top of it.
// ─────────────────────────────────────────────────────────────────────────────

export type MilestoneStatus = "pending" | "active" | "done" | "blocked";
export type TaskStatus = "pending" | "active" | "blocked" | "done";
export type DeliverableStatus = "pending" | "ready" | "delivered";
export type ApprovalStatus = "not-required" | "awaiting" | "approved" | "changes-requested";
export type CustomerActionKind =
  | "provide-access" | "upload-file" | "answer-question" | "confirm-info" | "review-completion" | "respond-scope-change";
export type CustomerActionStatus = "pending" | "submitted" | "resolved";
export type ChangeRequestStatus = "open" | "accepted" | "declined" | "resolved";

/** A concrete unit of work inside a milestone (internal detail; the customer sees milestone-level state). */
export interface ProjectTask {
  key: string;
  label: string;
  status: TaskStatus;
  /** Blocked on a customer action key (Access Center) or another milestone/task key. */
  blockedBy?: string[];
  /** References to fulfillment evidence records (never inline secrets). */
  evidenceRefs?: string[];
}

/** A customer-visible checkpoint. Depends on other milestone keys (dependency graph — scale-ready). */
export interface ProjectMilestone {
  key: string;
  label: string;
  status: MilestoneStatus;
  /** Milestone keys that must be `done` before this one can leave `pending`. */
  dependsOn: string[];
  tasks: ProjectTask[];
  targetDate?: string | null;
  completedDate?: string | null;
}

export interface ProjectDeliverable {
  key: string;
  label: string;
  status: DeliverableStatus;
  /** App-managed reference (served route / artifact key handle) — never a raw storage URL/secret. */
  ref?: string | null;
}

export interface ProjectApproval {
  key: string;
  label: string;
  status: ApprovalStatus;
}

export interface CustomerAction {
  key: string;
  kind: CustomerActionKind;
  prompt: string;
  status: CustomerActionStatus;
  /** Why this is needed, in customer-safe language (Access Center). */
  reason?: string;
}

export interface ChangeRequest {
  id: string;
  discovered: string;          // customer-safe description of what was found
  insideOriginalScope: string; // what the frozen scope still covers
  outsideOriginalScope: string;// what falls outside it (no silent expansion)
  options: string[];
  status: ChangeRequestStatus;
  decision?: string | null;
  decidedAt?: string | null;
}

/** An append-only status event. `customerSafe` controls whether it appears in the customer timeline. */
export interface ProjectStatusEvent {
  at: string;
  kind: string;                // machine kind (e.g. "milestone.done", "access.received", "qa.passed")
  customerLabel: string;       // human, customer-safe phrasing
  customerSafe: boolean;       // false → internal-only (never projected to the customer)
}

/** A phase groups milestones (Quick-Fix uses ONE implicit phase; large projects use many). */
export interface ProjectPhase {
  key: string;
  label: string;
  order: number;
  milestones: ProjectMilestone[];
}

export type ProjectKind = "quick-fix" | "engagement";

export interface CustomerProject {
  id: string;
  /** Canonical references — the project NEVER duplicates order/customer identity. */
  orderId: string;
  customerRef: string;
  kind: ProjectKind;
  packageName: string;
  phases: ProjectPhase[];
  deliverables: ProjectDeliverable[];
  approvals: ProjectApproval[];
  customerActions: CustomerAction[];
  changeRequests: ChangeRequest[];
  statusHistory: ProjectStatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export const CUSTOMER_PROJECT_VERSION = "cproj.v1";

// ── Pure derivations ─────────────────────────────────────────────────────────
/** Flatten every milestone across phases in phase order. */
export function allMilestones(project: CustomerProject): ProjectMilestone[] {
  return [...project.phases].sort((a, b) => a.order - b.order).flatMap((p) => p.milestones);
}

export interface MilestoneProgress {
  completed: number;
  total: number;
  /** Milestone-completion fraction 0..1 — DERIVED, never fabricated. Null when there are no milestones. */
  fraction: number | null;
  currentKey: string | null;   // first non-done milestone (the "you are here")
  blocked: boolean;            // any milestone is blocked
}

/** Progress from ACTUAL milestone completion (§4 "Do not invent precision"). */
export function milestoneProgress(project: CustomerProject): MilestoneProgress {
  const ms = allMilestones(project);
  const total = ms.length;
  const completed = ms.filter((m) => m.status === "done").length;
  const current = ms.find((m) => m.status !== "done") ?? null;
  return {
    completed,
    total,
    fraction: total > 0 ? Math.round((completed / total) * 1000) / 1000 : null,
    currentKey: current?.key ?? null,
    blocked: ms.some((m) => m.status === "blocked"),
  };
}

/** A milestone may only leave `pending` when all its dependencies are `done` (dependency gate). */
export function milestoneUnblocked(project: CustomerProject, key: string): boolean {
  const byKey = new Map(allMilestones(project).map((m) => [m.key, m]));
  const m = byKey.get(key);
  if (!m) return false;
  return m.dependsOn.every((dep) => byKey.get(dep)?.status === "done");
}

/** Outstanding customer actions (what the customer still owes) — drives the "Next step from you". */
export function outstandingCustomerActions(project: CustomerProject): CustomerAction[] {
  return project.customerActions.filter((a) => a.status === "pending");
}

/** The customer-safe activity timeline (§9) — internal-only events are never projected. */
export function customerTimeline(project: CustomerProject): Array<{ at: string; label: string }> {
  return project.statusHistory
    .filter((e) => e.customerSafe)
    .map((e) => ({ at: e.at, label: e.customerLabel }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Any open change request means the project needs a customer decision (§22 — no silent scope expansion). */
export function openChangeRequest(project: CustomerProject): ChangeRequest | null {
  return project.changeRequests.find((c) => c.status === "open") ?? null;
}

// ── Templates ────────────────────────────────────────────────────────────────
/**
 * The lightweight Quick-Fix project: one phase, the customer-visible milestone chain
 * Order Confirmed → Access Received → Fix In Progress → Testing → Complete, each gated on the prior.
 */
export function quickFixProjectTemplate(args: {
  id: string; orderId: string; customerRef: string; packageName: string; now: string; needsAccess: boolean;
}): CustomerProject {
  const chain: Array<{ key: string; label: string }> = [
    { key: "order-confirmed", label: "Order confirmed" },
    { key: "access-received", label: "Access received" },
    { key: "fix-in-progress", label: "Fix in progress" },
    { key: "testing", label: "Testing" },
    { key: "complete", label: "Complete" },
  ];
  const milestones: ProjectMilestone[] = chain.map((c, i) => ({
    key: c.key,
    label: c.label,
    status: i === 0 ? "done" : "pending",
    dependsOn: i === 0 ? [] : [chain[i - 1].key],
    tasks: [],
    completedDate: i === 0 ? args.now : null,
  }));
  const customerActions: CustomerAction[] = args.needsAccess
    ? [{ key: "site-access", kind: "provide-access", prompt: "Grant Artifex access so we can implement and test your fix.", status: "pending", reason: "We need access to implement and verify the purchased repair." }]
    : [];
  return {
    id: args.id,
    orderId: args.orderId,
    customerRef: args.customerRef,
    kind: "quick-fix",
    packageName: args.packageName,
    phases: [{ key: "quick-fix", label: "Quick Fix", order: 0, milestones }],
    deliverables: [{ key: "completion-package", label: "Completion package", status: "pending", ref: null }],
    approvals: [{ key: "completion-review", label: "Completion review", status: "not-required" }],
    customerActions,
    changeRequests: [],
    statusHistory: [{ at: args.now, kind: "order.confirmed", customerLabel: "Order confirmed", customerSafe: true }],
    createdAt: args.now,
    updatedAt: args.now,
  };
}

/**
 * A multi-month engagement template — PROVES the model scales (§21). Not wired into any UI; its existence
 * (and the CP1 test over it) demonstrates the same model represents Discovery→…→Completion with phases,
 * milestones, dependencies and approvals — without replacing the foundation.
 */
export function engagementProjectTemplate(args: {
  id: string; orderId: string; customerRef: string; packageName: string; now: string;
}): CustomerProject {
  const phaseDefs: Array<{ key: string; label: string }> = [
    { key: "discovery", label: "Discovery" },
    { key: "design", label: "Design" },
    { key: "prototype", label: "Prototype" },
    { key: "development", label: "Development" },
    { key: "integration", label: "Integration" },
    { key: "accessibility-qa", label: "Accessibility QA" },
    { key: "customer-uat", label: "Customer UAT" },
    { key: "deployment", label: "Deployment" },
    { key: "completion", label: "Completion" },
  ];
  const phases: ProjectPhase[] = phaseDefs.map((p, i) => ({
    key: p.key,
    label: p.label,
    order: i,
    milestones: [{
      key: `${p.key}-complete`,
      label: `${p.label} complete`,
      status: i === 0 ? "active" : "pending",
      dependsOn: i === 0 ? [] : [`${phaseDefs[i - 1].key}-complete`],
      tasks: [],
    }],
  }));
  return {
    id: args.id,
    orderId: args.orderId,
    customerRef: args.customerRef,
    kind: "engagement",
    packageName: args.packageName,
    phases,
    deliverables: [],
    approvals: [{ key: "uat-signoff", label: "Customer UAT sign-off", status: "awaiting" }],
    customerActions: [],
    changeRequests: [],
    statusHistory: [{ at: args.now, kind: "project.started", customerLabel: "Project kicked off", customerSafe: true }],
    createdAt: args.now,
    updatedAt: args.now,
  };
}
