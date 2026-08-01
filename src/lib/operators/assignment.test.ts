// ─────────────────────────────────────────────────────────────────────────────
// The distribution engine is where the four promises either hold or don't, so it
// is tested as behaviour ("a live conversation never moves") rather than as
// implementation ("rank() sorts by headroom"). Every test states the promise it
// is defending.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { normalizeOperator } from "./model";
import type { Lead, Operator, Task, AcquisitionPlan, Meeting } from "../types";
import {
  planDistribution,
  chooseOwnerForNewLead,
  computeWorkloads,
  businessDaysBetween,
  isActiveConversation,
  DEFAULT_POLICY,
} from "./assignment";

const NOW = new Date("2026-08-05T17:00:00.000Z"); // a Wednesday

function op(id: string, over: Partial<Operator> = {}): Operator {
  return normalizeOperator({ id, name: id[0].toUpperCase() + id.slice(1), email: `${id}@example.com`, ...over });
}

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return makeLead({
    id,
    businessName: `Business ${id}`,
    pipelineStage: "Qualified",
    assignedTo: null,
    assignedAt: null,
    assignmentReason: null,
    lastOperatorActivityAt: null,
    lastContactAt: null,
    ...over,
  });
}

function task(leadId: string, over: Partial<Task> = {}): Task {
  return {
    id: `task_${leadId}_${Math.abs(leadId.length)}${over.type ?? ""}`,
    leadId,
    type: "review",
    title: "Review",
    dueAt: NOW.toISOString(),
    status: "open",
    priority: 30,
    snoozedUntil: null,
    sourcePlanId: null,
    sourceStepId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  } as Task;
}

const emptyCtx = { plans: [] as AcquisitionPlan[], meetings: [] as Meeting[] };

describe("businessDaysBetween", () => {
  it("skips weekends so a Friday hand-off isn't stale by Monday", () => {
    // Fri 2026-07-31 → Mon 2026-08-03 is one business day, not three.
    expect(businessDaysBetween(new Date("2026-07-31T10:00:00Z"), new Date("2026-08-03T10:00:00Z"))).toBe(1);
  });
  it("never goes negative", () => {
    expect(businessDaysBetween(NOW, new Date("2026-07-01T00:00:00Z"))).toBe(0);
  });
});

describe("promise 1 — every business gets exactly one accountable operator", () => {
  it("assigns unassigned businesses", () => {
    const operators = [op("alex"), op("jordan")];
    const leads = [lead("l1"), lead("l2")];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(2);
    expect(plan.reassignments.every((r) => r.code === "unassigned")).toBe(true);
  });

  it("splits a batch across operators instead of dumping it on one", () => {
    const operators = [op("alex", { dailyCapacity: 2 }), op("jordan", { dailyCapacity: 2 })];
    const leads = [lead("l1"), lead("l2"), lead("l3"), lead("l4")];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    const perOperator = plan.reassignments.reduce<Record<string, number>>((acc, r) => {
      acc[r.to] = (acc[r.to] ?? 0) + 1;
      return acc;
    }, {});
    expect(perOperator).toEqual({ alex: 2, jordan: 2 });
  });

  it("never orphans a business when nobody can take work", () => {
    const operators = [op("alex", { availabilityMode: "away" })];
    const leads = [lead("l1", { assignedTo: "alex", assignedAt: NOW.toISOString() })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.held[0].code).toBe("no-available-operator");
  });

  it("leaves finished businesses alone", () => {
    const operators = [op("alex"), op("jordan")];
    const leads = [lead("l1", { pipelineStage: "Won" }), lead("l2", { pipelineStage: "Lost" })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.consideredLeads).toBe(0);
    expect(plan.reassignments).toHaveLength(0);
  });
});

describe("promise 2 — continuity is sacred", () => {
  const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();

  it("does not move a live conversation off a stale owner", () => {
    const operators = [op("alex"), op("jordan")];
    const leads = [
      lead("l1", {
        assignedTo: "jordan",
        assignedAt: "2026-06-01T00:00:00Z",
        lastOperatorActivityAt: "2026-06-01T00:00:00Z", // long silent
        lastContactAt: recent, // but the business heard from us recently
      }),
    ];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(0);
  });

  it("recognises a live conversation from a booked future meeting", () => {
    const meetings = [{ leadId: "l1", scheduledAt: new Date(NOW.getTime() + 86_400_000).toISOString() } as Meeting];
    expect(isActiveConversation(lead("l1"), { plans: [], meetings }, NOW)).toBe(true);
  });

  it("engineering focus keeps live conversations and releases only quiet work", () => {
    const operators = [op("jordan", { availabilityMode: "engineering" }), op("alex")];
    const leads = [
      lead("live", { assignedTo: "jordan", assignedAt: recent, lastContactAt: recent }),
      lead("quiet", { assignedTo: "jordan", assignedAt: recent, lastOperatorActivityAt: recent }),
    ];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments.map((r) => r.leadId)).toEqual(["quiet"]);
    expect(plan.reassignments[0].to).toBe("alex");
    expect(plan.reassignments[0].code).toBe("owner-engineering");
  });

  it("away DOES cover live conversations — that is what away means", () => {
    const operators = [op("jordan", { availabilityMode: "away" }), op("alex")];
    const leads = [lead("live", { assignedTo: "jordan", assignedAt: recent, lastContactAt: recent })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(1);
    expect(plan.reassignments[0].code).toBe("owner-away");
  });
});

describe("promise 3 — no stale pipelines", () => {
  it("expires ownership after the configured silence and hands the work on", () => {
    const operators = [op("jordan"), op("alex")];
    const silent = new Date("2026-07-20T00:00:00Z").toISOString();
    const leads = [lead("l1", { assignedTo: "jordan", assignedAt: silent, lastOperatorActivityAt: silent })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments[0].code).toBe("ownership-stale");
    expect(plan.reassignments[0].to).toBe("alex");
  });

  it("holds ownership that is merely quiet, not expired", () => {
    const operators = [op("jordan"), op("alex")];
    const yesterday = new Date("2026-08-04T17:00:00Z").toISOString();
    const leads = [lead("l1", { assignedTo: "jordan", assignedAt: yesterday, lastOperatorActivityAt: yesterday })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(0);
  });

  it("moves work off an operator who is no longer active", () => {
    const operators = [op("jordan", { active: false }), op("alex")];
    const leads = [lead("l1", { assignedTo: "jordan", assignedAt: NOW.toISOString(), lastOperatorActivityAt: NOW.toISOString() })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments[0].code).toBe("owner-inactive");
  });

  it("rescues work owned by someone who is not an operator here at all", () => {
    const operators = [op("alex")];
    const leads = [lead("l1", { assignedTo: "ghost", assignedAt: NOW.toISOString() })];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments[0].code).toBe("owner-unknown");
    expect(plan.reassignments[0].to).toBe("alex");
  });
});

describe("promise 4 — capacity decides, nobody divides a spreadsheet", () => {
  it("maintain mode leaves a lopsided but healthy pipeline alone", () => {
    const operators = [op("jordan"), op("alex")];
    const today = NOW.toISOString();
    const leads = Array.from({ length: 6 }, (_, i) =>
      lead(`l${i}`, { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today }),
    );
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(plan.reassignments).toHaveLength(0);
  });

  it("level mode evens the split without touching live conversations", () => {
    const operators = [op("jordan"), op("alex")];
    const today = NOW.toISOString();
    const leads = [
      ...Array.from({ length: 5 }, (_, i) =>
        lead(`quiet${i}`, { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today }),
      ),
      lead("live", { assignedTo: "jordan", assignedAt: today, lastContactAt: today }),
    ];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW, mode: "level" });
    expect(plan.reassignments.length).toBeGreaterThan(0);
    expect(plan.reassignments.every((r) => r.to === "alex")).toBe(true);
    expect(plan.reassignments.some((r) => r.leadId === "live")).toBe(false);

    const owners = new Map(leads.map((l) => [l.id, l.assignedTo]));
    for (const r of plan.reassignments) owners.set(r.leadId, r.to);
    const counts = [...owners.values()].reduce<Record<string, number>>((a, o) => ({ ...a, [o!]: (a[o!] ?? 0) + 1 }), {});
    expect(Math.abs(counts.jordan - counts.alex)).toBeLessThanOrEqual(1);
  });

  it("respects capacity when choosing an owner for a new business", () => {
    const operators = [op("jordan", { dailyCapacity: 8 }), op("alex", { dailyCapacity: 8 })];
    const today = NOW.toISOString();
    const leads = [lead("l1", { assignedTo: "jordan", assignedAt: today })];
    const tasks = [task("l1")];
    const choice = chooseOwnerForNewLead({ operators, leads, tasks, now: NOW });
    expect(choice?.operatorId).toBe("alex");
    expect(choice?.reason).toMatch(/capacity/);
  });

  it("gives no owner when nobody can receive work", () => {
    const operators = [op("jordan", { availabilityMode: "engineering" })];
    expect(chooseOwnerForNewLead({ operators, leads: [], tasks: [], now: NOW })).toBeNull();
  });
});

describe("workloads", () => {
  it("counts due work per operator and reports honest headroom", () => {
    const operators = [op("jordan", { dailyCapacity: 2 })];
    const today = NOW.toISOString();
    const leads = [
      lead("l1", { assignedTo: "jordan", assignedAt: today }),
      lead("l2", { assignedTo: "jordan", assignedAt: today }),
      lead("l3", { assignedTo: "jordan", assignedAt: today, pipelineStage: "Won" }),
    ];
    const tasks = [task("l1"), task("l2", { type: "call" })];
    const w = computeWorkloads(operators, leads, tasks, NOW).get("jordan")!;
    expect(w.leadsOwned).toBe(2); // the won business is not a workload
    expect(w.dueToday).toBe(2);
    expect(w.headroom).toBe(0);
  });

  it("ignores snoozed work — it is not today's load", () => {
    const operators = [op("jordan", { dailyCapacity: 5 })];
    const leads = [lead("l1", { assignedTo: "jordan", assignedAt: NOW.toISOString() })];
    const tasks = [task("l1", { snoozedUntil: new Date(NOW.getTime() + 86_400_000).toISOString() })];
    expect(computeWorkloads(operators, leads, tasks, NOW).get("jordan")!.dueToday).toBe(0);
  });
});

describe("the plan is trustworthy", () => {
  it("is deterministic — same inputs, same plan, every time", () => {
    const operators = [op("jordan"), op("alex"), op("sam")];
    const leads = Array.from({ length: 12 }, (_, i) => lead(`l${i}`));
    const run = () => planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("explains every move — a code, a sentence, and the ranking behind it", () => {
    const operators = [op("jordan"), op("alex")];
    const leads = [lead("l1")];
    const plan = planDistribution({ operators, leads, tasks: [], ctx: emptyCtx, now: NOW });
    const r = plan.reassignments[0];
    expect(r.code).toBeTruthy();
    expect(r.reason.length).toBeGreaterThan(10);
    expect(r.because.length).toBeGreaterThan(0);
  });

  it("uses the documented default policy", () => {
    expect(DEFAULT_POLICY.staleAfterBusinessDays).toBe(4);
    expect(DEFAULT_POLICY.activeConversationDays).toBe(14);
  });
});
