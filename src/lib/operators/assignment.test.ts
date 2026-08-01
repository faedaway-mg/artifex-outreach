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
  isInternalLead,
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

  it("level mode relieves an overloaded day without touching live conversations", () => {
    // Jordan's DAY is over capacity — six businesses need work and he has three
    // slots. That is the only thing levelling is allowed to care about.
    const operators = [op("jordan", { dailyCapacity: 3 }), op("alex", { dailyCapacity: 3 })];
    const today = NOW.toISOString();
    const leads = [
      ...Array.from({ length: 5 }, (_, i) =>
        lead(`quiet${i}`, { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today }),
      ),
      lead("live", { assignedTo: "jordan", assignedAt: today, lastContactAt: today }),
    ];
    const tasks = leads.map((l) => task(l.id));
    const plan = planDistribution({ operators, leads, tasks, ctx: emptyCtx, now: NOW, mode: "level" });

    expect(plan.reassignments.length).toBeGreaterThan(0);
    expect(plan.reassignments.every((r) => r.to === "alex")).toBe(true);
    expect(plan.reassignments.some((r) => r.leadId === "live")).toBe(false);

    // The success condition is a workable day for both, not an even lead count.
    for (const w of plan.projected) expect(w.dueToday).toBeLessThanOrEqual(w.capacity);
  });

  it("level mode leaves a heavy but workable day alone — an even split is not the goal", () => {
    // Jordan owns everything, but only two businesses need work today and he has
    // eight slots. Nothing is wrong, so nothing moves.
    const operators = [op("jordan"), op("alex")];
    const today = NOW.toISOString();
    const leads = Array.from({ length: 12 }, (_, i) =>
      lead(`l${i}`, { assignedTo: "jordan", assignedAt: today, lastOperatorActivityAt: today }),
    );
    const tasks = [task("l0"), task("l1")];
    const plan = planDistribution({ operators, leads, tasks, ctx: emptyCtx, now: NOW, mode: "level" });
    expect(plan.reassignments).toHaveLength(0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Expiry is ELIGIBILITY, not a verdict.
//
// The first version of this engine removed the current owner from the ranking
// before choosing, so "you are still the right owner" was an outcome it could
// never reach. On real data that turned every quiet week into a mass migration:
// one pass proposed moving 81% of the book. These tests hold the line — the
// scheduler optimises work, it does not maximise ownership transfers.
// ─────────────────────────────────────────────────────────────────────────────
describe("stale ownership is eligibility, not a forced move", () => {
  const SILENT = "2026-07-20T00:00:00Z"; // well past the 4-business-day horizon

  /** Give an operator a believable day: n quiet businesses, each needing work. */
  function busy(operatorId: string, n: number) {
    const today = NOW.toISOString();
    const leads = Array.from({ length: n }, (_, i) =>
      lead(`${operatorId}_busy${i}`, { assignedTo: operatorId, assignedAt: today, lastOperatorActivityAt: today }),
    );
    return { leads, tasks: leads.map((l) => task(l.id)) };
  }

  it("does NOT move a stale business when its owner is still the best owner", () => {
    // Jordan's day is empty; Alex is carrying five. Expiry alone must not hand
    // Jordan's quiet business to the busier person.
    const operators = [op("jordan"), op("alex")];
    const alexDay = busy("alex", 5);
    const stale = lead("stale", { assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT });
    const plan = planDistribution({
      operators, leads: [stale, ...alexDay.leads], tasks: alexDay.tasks, ctx: emptyCtx, now: NOW,
    });
    expect(plan.reassignments).toHaveLength(0);
  });

  it("records WHY it held — the current owner won the ranking on the merits", () => {
    const operators = [op("jordan"), op("alex")];
    const alexDay = busy("alex", 5);
    const stale = lead("stale", { assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT });
    const plan = planDistribution({
      operators, leads: [stale, ...alexDay.leads], tasks: alexDay.tasks, ctx: emptyCtx, now: NOW,
    });
    const holdRow = plan.held.find((h) => h.leadId === "stale")!;
    expect(holdRow.code).toBe("already-best");
    expect(holdRow.reason).toMatch(/still the best owner/i);
  });

  it("DOES move a stale business when someone else is genuinely better", () => {
    // Same rule, opposite facts: now Jordan is the loaded one, so the business
    // moves — and the reason says exactly what made Alex the better owner.
    const operators = [op("jordan"), op("alex")];
    const jordanDay = busy("jordan", 8);
    const stale = lead("stale", { assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT });
    const plan = planDistribution({
      operators, leads: [stale, ...jordanDay.leads], tasks: jordanDay.tasks, ctx: emptyCtx, now: NOW,
    });
    const move = plan.reassignments.find((r) => r.leadId === "stale")!;
    expect(move.to).toBe("alex");
    expect(move.code).toBe("ownership-stale");
    expect(move.because[0]).toMatch(/slots used today/);
  });

  it("balances gradually — one pass never hands over more than a day's work", () => {
    // Twenty stale businesses, all needing work, all on Jordan. The old engine
    // moved all twenty. The correct pass moves at most one working day's worth
    // and holds the rest for tomorrow.
    const operators = [op("jordan"), op("alex")];
    const leads = Array.from({ length: 20 }, (_, i) =>
      lead(`s${String(i).padStart(2, "0")}`, { assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT }),
    );
    const tasks = leads.map((l) => task(l.id));
    const plan = planDistribution({ operators, leads, tasks, ctx: emptyCtx, now: NOW });

    expect(plan.reassignments.length).toBeLessThanOrEqual(8); // Alex's daily capacity
    expect(plan.reassignments.length).toBeLessThan(leads.length / 2);
    expect(plan.held.filter((h) => h.code === "already-best").length).toBeGreaterThan(0);

    // The receiver is never handed a day he cannot work. Jordan is still over
    // capacity afterwards — twenty businesses need work and the team has sixteen
    // slots — and that is the honest answer, not a reason to overload Alex.
    const alexAfter = plan.projected.find((w) => w.operatorId === "alex")!;
    const jordanAfter = plan.projected.find((w) => w.operatorId === "jordan")!;
    expect(alexAfter.dueToday).toBeLessThanOrEqual(alexAfter.capacity);
    expect(jordanAfter.dueToday).toBeLessThan(20); // his day genuinely improved
  });

  it("engineering focus still transfers quiet work, even from an idle owner", () => {
    // Jordan has the emptiest day of anyone, so on merit he would keep this. He
    // cannot: engineering focus means he is not working the pipeline at all.
    const operators = [op("jordan", { availabilityMode: "engineering" }), op("alex")];
    const alexDay = busy("alex", 6);
    const quiet = lead("quiet", { assignedTo: "jordan", assignedAt: NOW.toISOString(), lastOperatorActivityAt: NOW.toISOString() });
    const plan = planDistribution({
      operators, leads: [quiet, ...alexDay.leads], tasks: alexDay.tasks, ctx: emptyCtx, now: NOW,
    });
    const move = plan.reassignments.find((r) => r.leadId === "quiet")!;
    expect(move.code).toBe("owner-engineering");
    expect(move.to).toBe("alex");
  });

  it("away and inactive still force movement — ownership there is impossible, not expired", () => {
    for (const [over, code] of [
      [{ availabilityMode: "away" as const }, "owner-away"],
      [{ active: false }, "owner-inactive"],
    ] as const) {
      const operators = [op("jordan", over), op("alex")];
      const alexDay = busy("alex", 6);
      // Freshly touched: nothing has expired. The owner simply cannot work it.
      const l = lead("covered", { assignedTo: "jordan", assignedAt: NOW.toISOString(), lastOperatorActivityAt: NOW.toISOString() });
      const plan = planDistribution({
        operators, leads: [l, ...alexDay.leads], tasks: alexDay.tasks, ctx: emptyCtx, now: NOW,
      });
      const move = plan.reassignments.find((r) => r.leadId === "covered")!;
      expect(move.code).toBe(code);
      expect(move.to).toBe("alex");
    }
  });

  it("an unassigned business is assigned immediately, even when everyone is full", () => {
    // Nobody is accountable — that is promise 1, and it outranks capacity.
    const operators = [op("jordan", { dailyCapacity: 1 }), op("alex", { dailyCapacity: 1 })];
    const day = [...busy("jordan", 2).leads, ...busy("alex", 2).leads];
    const tasks = day.map((l) => task(l.id));
    const orphan = lead("orphan", { assignedTo: null });
    const plan = planDistribution({ operators, leads: [orphan, ...day], tasks, ctx: emptyCtx, now: NOW });
    const move = plan.reassignments.find((r) => r.leadId === "orphan")!;
    expect(move.code).toBe("unassigned");
    expect(move.to).toBeTruthy();
  });

  it("an active conversation is protected and the plan says so", () => {
    const operators = [op("jordan"), op("alex")];
    const jordanDay = busy("jordan", 8); // Jordan is overloaded — pressure to move it
    const live = lead("live", {
      assignedTo: "jordan",
      assignedAt: SILENT,
      lastOperatorActivityAt: SILENT, // ownership expired…
      lastContactAt: new Date(NOW.getTime() - 86_400_000).toISOString(), // …but they heard from us yesterday
    });
    const plan = planDistribution({
      operators, leads: [live, ...jordanDay.leads], tasks: [...jordanDay.tasks, task("live")],
      ctx: emptyCtx, now: NOW, mode: "level",
    });
    expect(plan.reassignments.some((r) => r.leadId === "live")).toBe(false);
    expect(plan.held.find((h) => h.leadId === "live")?.code).toBe("active-conversation");
  });

  it("never reports the same business as both moving and held", () => {
    // The levelling pass runs after the daily one and can move something the
    // daily pass decided to hold. A preview that lists a business twice, saying
    // opposite things, is not one an operator can approve.
    const operators = [op("jordan", { dailyCapacity: 4 }), op("alex", { dailyCapacity: 4 })];
    const leads = Array.from({ length: 10 }, (_, i) =>
      lead(`s${i}`, { assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT }),
    );
    const tasks = leads.map((l) => task(l.id));
    const plan = planDistribution({ operators, leads, tasks, ctx: emptyCtx, now: NOW, mode: "level" });
    const movingIds = new Set(plan.reassignments.map((r) => r.leadId));
    expect(plan.held.some((h) => movingIds.has(h.leadId))).toBe(false);
    expect(plan.excluded.some((e) => movingIds.has(e.leadId))).toBe(false);
  });

  it("internal test records never influence a real person's workload", () => {
    const operators = [op("jordan"), op("alex")];
    const internals = [
      lead("t1", { businessName: "Internal Test Send", source: "internal-delivery-test", assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT }),
      lead("t2", { businessName: "Branded Test Send", source: "Internal test", industry: "Internal", assignedTo: "jordan", assignedAt: SILENT, lastOperatorActivityAt: SILENT }),
    ];
    const tasks = internals.map((l) => task(l.id));

    expect(internals.every(isInternalLead)).toBe(true);

    const w = computeWorkloads(operators, internals, tasks, NOW).get("jordan")!;
    expect(w.leadsOwned).toBe(0);
    expect(w.dueToday).toBe(0);

    const plan = planDistribution({ operators, leads: internals, tasks, ctx: emptyCtx, now: NOW, mode: "level" });
    expect(plan.consideredLeads).toBe(0);
    expect(plan.reassignments).toHaveLength(0);
    expect(plan.excluded.map((e) => e.leadId).sort()).toEqual(["t1", "t2"]);
    expect(plan.excluded[0].reason).toMatch(/Internal test record/);
  });
});
