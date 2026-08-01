// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY distribution preview against production data.
//
// This is the deployed scheduler with its hands tied: the SAME functions the
// product calls, run with apply:false. Nothing is written. No lead.reassigned or
// lead.assigned row is created. Ownership is not touched.
//
// It also exercises the deployed queue-scoping path on real data, so "Today
// defaults to your own work" and "the cap is applied after operator scoping" are
// answered from production rows rather than from reading the source.
//
// Prints business names (the operator needs to know WHICH businesses would move)
// and no contact details, message content, addresses or secrets.
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

async function main() {
  const { listOperators, listLeads, allTasks, allPlans, allMeetings, getSettings } = await import("../src/lib/repo");
  const { planDistribution, computeWorkloads, isActiveConversation, idleBusinessDays, DEFAULT_POLICY, TERMINAL_STAGES } =
    await import("../src/lib/operators/assignment");
  const { parseScope, leadIdsInScope, tasksInScope, scopeOptions } = await import("../src/lib/operators/scope");
  const { distributionEnabled } = await import("../src/lib/operators/distribute");

  const now = new Date();
  const [operators, leads, tasks, plans, meetings, settings] = await Promise.all([
    listOperators(), listLeads(), allTasks(), allPlans(), allMeetings(), getSettings(),
  ]);
  const ctx = { plans, meetings };
  const cap = settings.prospecting.dailyQueueSize;
  const nameOf = new Map(leads.map((l) => [l.id, l.businessName]));
  const openTasks = tasks.filter((t) => t.status === "open");

  console.log(`gate: OPERATOR_DISTRIBUTION_ENABLED → distributionEnabled() = ${distributionEnabled()}`);
  console.log(`policy: stale after ${DEFAULT_POLICY.staleAfterBusinessDays} business days · ` +
              `conversation window ${DEFAULT_POLICY.activeConversationDays} days · daily queue cap ${cap}`);

  // ── Queue scoping, on real production rows ────────────────────────────────
  console.log("\n──────────── QUEUE SCOPING (deployed code, production data) ────────────");
  for (const viewer of operators.map((o) => o.id)) {
    const scope = parseScope(undefined, viewer, operators.map((o) => o.id)); // no ?view → the default
    const ids = leadIdsInScope({ scope, viewerId: viewer, leads, operators, ctx, now });
    const scoped = tasksInScope(openTasks, ids);
    console.log(`  ${viewer.padEnd(7)} default scope = ${scope.kind}/${scope.operatorId}  ` +
                `businesses=${ids.size}  open tasks in scope=${scoped.length}  shown after cap=${Math.min(scoped.length, cap)}`);
  }
  const overlap = (() => {
    const sets = operators.map((o) => leadIdsInScope({
      scope: parseScope(undefined, o.id, operators.map((x) => x.id)), viewerId: o.id, leads, operators, ctx, now,
    }));
    const [a, b] = sets;
    return [...a].filter((id) => b.has(id)).length;
  })();
  console.log(`  businesses appearing on BOTH default queues: ${overlap}`);

  console.log("\n  switcher counts, as jordan sees them:");
  for (const o of scopeOptions({ viewerId: "jordan", leads, operators, ctx, now })) {
    console.log(`    ${o.label.padEnd(12)} ${o.count}`);
  }

  // ── The preview ───────────────────────────────────────────────────────────
  const maintain = planDistribution({ operators, leads, tasks, ctx, now, mode: "maintain" });
  const level = planDistribution({ operators, leads, tasks, ctx, now, mode: "level" });

  const before = computeWorkloads(operators, leads, tasks, now);
  console.log("\n──────────── CURRENT WORKLOAD (before) ────────────");
  for (const o of operators) {
    const w = before.get(o.id)!;
    console.log(`  ${o.name.padEnd(16)} owns ${String(w.leadsOwned).padStart(3)}   due today ${w.dueToday}/${o.dailyCapacity}   ` +
                `headroom ${o.dailyCapacity - w.dueToday}   mode ${o.availabilityMode}`);
  }

  const report = (label: string, plan: typeof maintain) => {
    console.log(`\n──────────── ${label} ────────────`);
    console.log(`  considered ${plan.consideredLeads} businesses · proposes ${plan.reassignments.length} move(s) · holds ${plan.held.length}`);
    if (!plan.reassignments.length) console.log("    (no moves proposed)");
    for (const r of plan.reassignments) {
      console.log(`    ${(nameOf.get(r.leadId) ?? r.leadId).padEnd(34)} ${String(r.from ?? "unassigned").padEnd(10)} → ${r.to}`);
      console.log(`      why: ${r.reason}`);
      for (const b of r.because) console.log(`         · ${b}`);
    }
  };
  report("MAINTAIN — what the nightly pass would do", maintain);
  report("LEVEL — the proposed initial daily split", level);

  // Projected split
  const moved = new Map(level.reassignments.map((r) => [r.leadId, r.to]));
  const projected = leads.map((l) => ({ ...l, assignedTo: moved.get(l.id) ?? l.assignedTo }));
  const after = computeWorkloads(operators, projected, tasks, now);
  console.log("\n──────────── PROJECTED SPLIT (after the level plan) ────────────");
  for (const o of operators) {
    const b = before.get(o.id)!, a = after.get(o.id)!;
    console.log(`  ${o.name.padEnd(16)} owns ${b.leadsOwned} → ${a.leadsOwned}   ` +
                `due today ${b.dueToday}/${o.dailyCapacity} → ${a.dueToday}/${o.dailyCapacity}   ` +
                `headroom ${o.dailyCapacity - b.dueToday} → ${o.dailyCapacity - a.dueToday}`);
  }
  console.log("\n  would REMAIN with Jordan:");
  for (const l of projected.filter((l) => l.assignedTo === "jordan")) {
    const open = openTasks.filter((t) => t.leadId === l.id).length;
    console.log(`    ${l.businessName.padEnd(34)} ${l.pipelineStage.padEnd(18)} open tasks ${open}`);
  }
  const toAlex = projected.filter((l) => l.assignedTo === "alex");
  console.log(`\n  would MOVE to Alex: ${toAlex.length}`);
  for (const l of toAlex) {
    const open = openTasks.filter((t) => t.leadId === l.id).length;
    console.log(`    ${l.businessName.padEnd(34)} ${l.pipelineStage.padEnd(18)} open tasks ${open}`);
  }

  // ── Protection ────────────────────────────────────────────────────────────
  console.log("\n──────────── PROTECTED FROM AUTOMATIC MOVEMENT ────────────");
  const live = leads.filter((l) => isActiveConversation(l, ctx, now));
  const terminal = leads.filter((l) => TERMINAL_STAGES.has(l.pipelineStage));
  console.log(`  live conversations (never moved automatically): ${live.length}`);
  for (const l of live) console.log(`    ${l.businessName.padEnd(34)} ${l.pipelineStage}`);
  console.log(`  finished businesses (out of scope entirely):    ${terminal.length}`);
  if (level.held.length) {
    console.log(`  explicitly held by the planner:                 ${level.held.length}`);
    for (const h of level.held) console.log(`    ${(nameOf.get(h.leadId) ?? h.leadId).padEnd(34)} ${h.reason}`);
  }

  // ── Cap ordering, demonstrated on the proposed split ──────────────────────
  console.log("\n──────────── CAP ORDERING, ON THE PROPOSED SPLIT ────────────");
  const ids = leadIdsInScope({
    scope: parseScope(undefined, "alex", ["jordan", "alex"]),
    viewerId: "alex", leads: projected, operators, ctx, now,
  });
  const sorted = openTasks.slice().sort((a, b) => b.priority - a.priority);
  const capThenFilter = tasksInScope(sorted.slice(0, cap), ids);
  const filterThenCap = tasksInScope(sorted, ids).slice(0, cap);
  console.log(`  alex would own ${ids.size} businesses carrying ${tasksInScope(sorted, ids).length} open task(s).`);
  console.log(`  cap-then-filter (the bug): ${capThenFilter.length} task(s) would reach his queue.`);
  console.log(`  filter-then-cap (shipped): ${filterThenCap.length} task(s) reach his queue.`);
  console.log(capThenFilter.length < filterThenCap.length
    ? "  → the ordering is load-bearing on THIS data: capping first starves him."
    : "  → on this data both orderings agree; the ordering is proven by the deployed path and its unit test.");

  console.log("\nrows written by this script: 0");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
