// ─────────────────────────────────────────────────────────────────────────────
// A transfer preview has one job: make sure nobody signs something they cannot
// read. These tests defend that — every current owner explained, every workload
// consequence shown, every interruption named, and nothing silently skipped.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { normalizeOperator } from "./model";
import { previewTransfer } from "./transfer";
import type { Lead, Operator, Task, AuditEntry } from "../types";

const NOW = new Date("2026-08-05T17:00:00.000Z"); // a Wednesday

const op = (id: string, over: Partial<Operator> = {}): Operator =>
  normalizeOperator({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@example.com`, ...over });

const lead = (id: string, over: Partial<Lead> = {}): Lead =>
  makeLead({
    id, businessName: `Business ${id}`, pipelineStage: "Qualified",
    assignedTo: "jordan", assignedAt: "2026-07-01T00:00:00.000Z", ...over,
  });

const task = (leadId: string, over: Partial<Task> = {}): Task =>
  ({
    id: `task_${leadId}`, leadId, type: "call", status: "open", priority: 5,
    dueAt: NOW.toISOString(), snoozedUntil: null, createdAt: NOW.toISOString(),
    completedAt: null, title: "Call", notes: null, ...over,
  }) as Task;

const ctx = { plans: [], meetings: [] };
const base = (over: Partial<Parameters<typeof previewTransfer>[0]> = {}) =>
  previewTransfer({
    leadIds: [], to: "alex", operators: [op("jordan"), op("alex")],
    leads: [], tasks: [], ctx, now: NOW, ...over,
  });

describe("what the manager is shown before confirming", () => {
  const operators = [op("jordan"), op("alex")];

  it("names the current owner and why they hold it", () => {
    const l = lead("a", { assignmentReason: "Claimed by working it." });
    const p = base({ leadIds: ["a"], leads: [l], operators });
    expect(p.lines[0].fromName).toBe("Jordan");
    expect(p.lines[0].toName).toBe("Alex");
    expect(p.lines[0].whyOwned).toBe("Claimed by working it.");
    expect(p.lines[0].ownedSince).toBe("2026-07-01T00:00:00.000Z");
  });

  it("prefers what the last ownership event actually said over anything inferred", () => {
    const l = lead("a", { assignmentReason: "stale reason on the row" });
    const history = new Map<string, AuditEntry[]>([
      ["a", [{ id: "1", action: "lead.transferred", actor: "jordan", targetType: "lead", targetId: "a",
              meta: { reason: "Handed over after the discovery call." }, ip: null,
              createdAt: "2026-07-02T00:00:00.000Z" }]],
    ]);
    const p = base({ leadIds: ["a"], leads: [l], operators, history });
    expect(p.lines[0].whyOwned).toBe("Handed over after the discovery call.");
  });

  it("says so plainly when no reason was ever recorded", () => {
    const p = base({ leadIds: ["a"], leads: [lead("a", { assignmentReason: null })], operators });
    expect(p.lines[0].whyOwned).toMatch(/No reason was recorded/);
  });

  it("shows both operators' days before and after, using the scheduler's own arithmetic", () => {
    const leads = [lead("a"), lead("b"), lead("c")];
    const tasks = leads.map((l) => task(l.id));
    const p = base({ leadIds: ["a", "b"], leads, tasks, operators });

    const jordan = p.workloads.find((w) => w.operatorId === "jordan")!;
    const alex = p.workloads.find((w) => w.operatorId === "alex")!;
    expect(jordan.before.leadsOwned).toBe(3);
    expect(jordan.after.leadsOwned).toBe(1);
    expect(alex.before.leadsOwned).toBe(0);
    expect(alex.after.leadsOwned).toBe(2);
    expect(alex.after.dueToday).toBe(2);
    expect(alex.after.headroom).toBe(alex.after.capacity - 2);
  });

  it("only reports the operators a transfer actually touches", () => {
    const p = base({
      leadIds: ["a"], leads: [lead("a")], operators: [op("jordan"), op("alex"), op("sam")],
    });
    expect(p.workloads.map((w) => w.operatorId).sort()).toEqual(["alex", "jordan"]);
  });
});

describe("the warnings a manager must read", () => {
  const operators = [op("jordan"), op("alex")];

  it("flags a live conversation rather than moving it silently", () => {
    // A deliberate transfer MAY move a live conversation — that is the whole
    // point of the manual path — but the manager is told what they inherit.
    const live = lead("live", { pipelineStage: "Proposal Sent", lastOperatorActivityAt: "2026-08-04T17:00:00.000Z" });
    const p = base({ leadIds: ["live"], leads: [live], operators });
    expect(p.lines[0].live).toBe(true);
    expect(p.lines[0].blocked).toBeNull();
    expect(p.lines[0].warnings.join(" ")).toMatch(/live conversation/i);
    expect(p.summary).toMatch(/1 live conversation/);
  });

  it("warns that releasing leaves nobody accountable", () => {
    const p = base({ leadIds: ["a"], to: null, leads: [lead("a")], operators });
    expect(p.lines[0].toName).toBe("Unassigned");
    expect(p.lines[0].warnings.join(" ")).toMatch(/Nobody will be accountable/);
  });

  it("warns when the destination is not taking new work, without refusing", () => {
    const ops = [op("jordan"), op("alex", { availabilityMode: "engineering" })];
    const p = base({ leadIds: ["a"], leads: [lead("a")], operators: ops });
    expect(p.movable).toHaveLength(1);
    expect(p.lines[0].warnings.join(" ")).toMatch(/not taking new work/);
  });

  it("marks internal test records so they never look like real work", () => {
    const p = base({ leadIds: ["t"], leads: [lead("t", { source: "internal-test" })], operators });
    expect(p.lines[0].warnings.join(" ")).toMatch(/Internal test record/);
  });
});

describe("what is skipped, and why", () => {
  const operators = [op("jordan"), op("alex")];

  it("skips a business the destination already owns instead of writing a no-op", () => {
    const p = base({ leadIds: ["a"], leads: [lead("a", { assignedTo: "alex" })], operators });
    expect(p.movable).toHaveLength(0);
    expect(p.lines[0].blocked).toMatch(/already owns/);
  });

  it("skips an already-unassigned business on a release", () => {
    const p = base({ leadIds: ["a"], to: null, leads: [lead("a", { assignedTo: null })], operators });
    expect(p.lines[0].blocked).toMatch(/already unassigned/i);
  });

  it("refuses an inactive destination", () => {
    const ops = [op("jordan"), op("alex", { active: false })];
    const p = base({ leadIds: ["a"], leads: [lead("a")], operators: ops });
    expect(p.movable).toHaveLength(0);
    expect(p.lines[0].blocked).toMatch(/inactive/);
  });

  it("reports a vanished business rather than dropping it from the list", () => {
    const p = base({ leadIds: ["ghost"], leads: [], operators });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].blocked).toMatch(/no longer exists/);
    expect(p.summary).toBe("Nothing would move.");
  });

  it("counts the skips in the summary so a partial batch is never mistaken for a whole one", () => {
    const leads = [lead("a"), lead("b", { assignedTo: "alex" })];
    const p = base({ leadIds: ["a", "b"], leads, operators });
    expect(p.movable).toHaveLength(1);
    expect(p.summary).toMatch(/1 skipped/);
  });
});

describe("scale", () => {
  it("handles a fifty-business batch across five operators without pairwise logic", () => {
    const operators = ["jordan", "alex", "sam", "kim", "rio"].map((id) => op(id));
    const leads = Array.from({ length: 50 }, (_, i) =>
      lead(`l${i}`, { assignedTo: operators[i % 5].id }));
    const p = previewTransfer({
      leadIds: leads.map((l) => l.id), to: "rio", operators, leads,
      tasks: leads.map((l) => task(l.id)), ctx, now: NOW,
    });
    // Everything except what rio already owns.
    expect(p.movable).toHaveLength(40);
    expect(p.workloads.find((w) => w.operatorId === "rio")!.after.leadsOwned).toBe(50);
    for (const id of ["jordan", "alex", "sam", "kim"]) {
      expect(p.workloads.find((w) => w.operatorId === id)!.after.leadsOwned).toBe(0);
    }
  });
});
