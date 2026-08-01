// The queue scope carries one load-bearing rule: narrow BEFORE the cap. These
// tests defend that rule and the meaning of each view.
import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { normalizeOperator } from "./model";
import type { Lead, Operator, Task, AcquisitionPlan, Meeting } from "../types";
import { parseScope, leadIdsInScope, tasksInScope, scopeOptions, needsAttention } from "./scope";

const NOW = new Date("2026-08-05T17:00:00.000Z");
const ctx = { plans: [] as AcquisitionPlan[], meetings: [] as Meeting[] };

const op = (id: string, over: Partial<Operator> = {}): Operator =>
  normalizeOperator({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@x.com`, ...over });

const lead = (id: string, over: Partial<Lead> = {}): Lead =>
  makeLead({ id, businessName: id, pipelineStage: "Qualified", assignedTo: null, assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, lastContactAt: null, ...over });

const task = (leadId: string, priority = 10): Task =>
  ({ id: `t_${leadId}`, leadId, type: "review", title: "t", dueAt: NOW.toISOString(), status: "open", priority, snoozedUntil: null, sourcePlanId: null, sourceStepId: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }) as Task;

describe("parseScope", () => {
  const ids = ["jordan", "alex"];
  it("defaults to the viewer's own work", () => {
    expect(parseScope(undefined, "alex", ids)).toEqual({ kind: "mine", operatorId: "alex" });
  });
  it("treats the viewer's own id as 'mine', not as spectating themselves", () => {
    expect(parseScope("alex", "alex", ids).kind).toBe("mine");
  });
  it("reads another operator", () => {
    expect(parseScope("jordan", "alex", ids)).toEqual({ kind: "operator", operatorId: "jordan" });
  });
  it("falls back to 'mine' for an unknown operator rather than showing an empty queue", () => {
    expect(parseScope("nobody", "alex", ids).kind).toBe("mine");
  });
  it("reads the shared views", () => {
    expect(parseScope("unassigned", "alex", ids).kind).toBe("unassigned");
    expect(parseScope("team", "alex", ids).kind).toBe("team");
    expect(parseScope("all", "alex", ids).kind).toBe("all");
  });
});

describe("leadIdsInScope", () => {
  const operators = [op("jordan"), op("alex")];
  const today = NOW.toISOString();
  const leads = [
    lead("mine", { assignedTo: "alex", assignedAt: today, lastOperatorActivityAt: today }),
    lead("theirs", { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today }),
    lead("orphan"),
  ];
  const call = (view: string | undefined) =>
    leadIdsInScope({ scope: parseScope(view, "alex", ["jordan", "alex"]), viewerId: "alex", leads, operators, ctx, now: NOW });

  it("mine shows only the viewer's businesses", () => {
    expect([...call(undefined)]).toEqual(["mine"]);
  });
  it("another operator's view shows theirs", () => {
    expect([...call("jordan")]).toEqual(["theirs"]);
  });
  it("unassigned shows work with nobody accountable", () => {
    expect([...call("unassigned")]).toEqual(["orphan"]);
  });
  it("team shows work at risk of stalling", () => {
    expect([...call("team")]).toEqual(["orphan"]);
  });
  it("all shows everything", () => {
    expect(call("all").size).toBe(3);
  });
});

describe("narrowing happens before the cap", () => {
  it("does not starve an operator whose work sorts below someone else's", () => {
    const operators = [op("jordan"), op("alex")];
    const today = NOW.toISOString();
    const leads = [
      ...Array.from({ length: 10 }, (_, i) => lead(`j${i}`, { assignedTo: "jordan", assignedAt: today })),
      lead("a1", { assignedTo: "alex", assignedAt: today }),
    ];
    // Jordan's work outranks Alex's on every priority.
    const tasks = [...leads.filter((l) => l.assignedTo === "jordan").map((l) => task(l.id, 90)), task("a1", 5)];
    const cap = 5;

    const wrong = tasks.slice().sort((a, b) => b.priority - a.priority).slice(0, cap);
    expect(wrong.some((t) => t.leadId === "a1")).toBe(false); // cap-then-filter loses Alex entirely

    const ids = leadIdsInScope({ scope: parseScope(undefined, "alex", ["jordan", "alex"]), viewerId: "alex", leads, operators, ctx, now: NOW });
    const right = tasksInScope(tasks.slice().sort((a, b) => b.priority - a.priority), ids).slice(0, cap);
    expect(right.map((t) => t.leadId)).toEqual(["a1"]); // filter-then-cap keeps his work
  });
});

describe("needsAttention", () => {
  const today = NOW.toISOString();
  it("flags a business with no owner", () => {
    expect(needsAttention({ lead: lead("x"), operators: [op("alex")], ctx, now: NOW })).toBe(true);
  });
  it("does not flag a finished business", () => {
    expect(needsAttention({ lead: lead("x", { pipelineStage: "Won" }), operators: [op("alex")], ctx, now: NOW })).toBe(false);
  });
  it("flags quiet work behind an engineering focus but not the live conversation", () => {
    const operators = [op("jordan", { availabilityMode: "engineering" })];
    const quiet = lead("q", { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today });
    const live = lead("l", { assignedTo: "jordan", assignedAt: today, lastContactAt: today });
    expect(needsAttention({ lead: quiet, operators, ctx, now: NOW })).toBe(true);
    expect(needsAttention({ lead: live, operators, ctx, now: NOW })).toBe(false);
  });
  it("flags expired ownership", () => {
    const operators = [op("jordan")];
    const silent = "2026-07-20T00:00:00Z";
    expect(needsAttention({ lead: lead("s", { assignedTo: "jordan", assignedAt: silent, lastOperatorActivityAt: silent }), operators, ctx, now: NOW })).toBe(true);
  });
});

describe("scopeOptions", () => {
  it("offers every view with an honest count and never hides a colleague", () => {
    const operators = [op("alex"), op("jordan")];
    const today = NOW.toISOString();
    const leads = [lead("a", { assignedTo: "alex", assignedAt: today, lastOperatorActivityAt: today }), lead("o")];
    const options = scopeOptions({ viewerId: "alex", leads, operators, ctx, now: NOW });
    expect(options.map((o) => o.param)).toEqual(["mine", "jordan", "unassigned", "team", "all"]);
    expect(options.find((o) => o.param === "mine")!.count).toBe(1);
    expect(options.find((o) => o.param === "all")!.count).toBe(2);
  });
});
