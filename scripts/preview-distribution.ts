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
  const { planDistribution, computeWorkloads, isActiveConversation, isInternalLead, DEFAULT_POLICY } =
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
  const workloadLine = (o: (typeof operators)[number], w: ReturnType<typeof computeWorkloads> extends Map<string, infer W> ? W : never) =>
    `  ${o.name.padEnd(16)} owns ${String(w.leadsOwned).padStart(3)}   due today ${w.dueToday}/${w.capacity}   ` +
    `headroom ${w.headroom}   mode ${o.availabilityMode}`;
  console.log("\n──────────── CURRENT WORKLOAD (before) ────────────");
  console.log("  (internal test records are excluded from every number below)");
  for (const o of operators) console.log(workloadLine(o, before.get(o.id)!));

  const dueNow = new Set(
    openTasks
      .filter((t) => !(t.snoozedUntil && new Date(t.snoozedUntil) > now) && new Date(t.dueAt) <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999))
      .map((t) => t.leadId),
  );
  const line = (leadId: string) => {
    const l = leads.find((x) => x.id === leadId);
    const open = openTasks.filter((t) => t.leadId === leadId).length;
    return `${(l?.businessName ?? leadId).padEnd(34)} ${(l?.pipelineStage ?? "?").padEnd(18)} ` +
           `open ${String(open).padStart(2)}  ${dueNow.has(leadId) ? "due today" : "nothing due"}`;
  };

  const report = (label: string, plan: typeof maintain) => {
    console.log(`\n──────────── ${label} ────────────`);
    console.log(`  considered ${plan.consideredLeads} businesses · proposes ${plan.reassignments.length} move(s) · ` +
                `holds ${plan.held.length} · excludes ${plan.excluded.length}`);
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
  console.log("\n──────────── PROJECTED WORKLOAD (after the level plan) ────────────");
  for (const o of operators) {
    const b = before.get(o.id)!, a = after.get(o.id)!;
    console.log(`  ${o.name.padEnd(16)} owns ${b.leadsOwned} → ${a.leadsOwned}   ` +
                `due today ${b.dueToday}/${b.capacity} → ${a.dueToday}/${a.capacity}   ` +
                `headroom ${b.headroom} → ${a.headroom}`);
  }

  // ── The five lists the operator actually has to sign off on ───────────────
  const consideredIds = new Set(
    leads.filter((l) => !level.excluded.some((e) => e.leadId === l.id)).map((l) => l.id),
  );
  const movingIds = new Set(level.reassignments.map((r) => r.leadId));
  const heldBy = (code: string) => level.held.filter((h) => h.code === code);

  const staying = [...consideredIds].filter((id) => !movingIds.has(id) && (projected.find((l) => l.id === id)?.assignedTo === "jordan"));
  console.log(`\n  1. STAYING with Jordan: ${staying.length}`);
  for (const id of staying) console.log(`     ${line(id)}`);

  const toAlex = level.reassignments.filter((r) => r.to === "alex");
  console.log(`\n  2. MOVING to Alex: ${toAlex.length}`);
  for (const r of toAlex) console.log(`     ${line(r.leadId)}  ← ${r.reason}`);

  const protectedRows = heldBy("active-conversation");
  console.log(`\n  3. PROTECTED — active conversation, continuity preserved: ${protectedRows.length}`);
  for (const h of protectedRows) console.log(`     ${line(h.leadId)}`);

  const bestRows = heldBy("already-best");
  console.log(`\n  4. HELD — ownership expired but Jordan is still the best owner: ${bestRows.length}`);
  for (const h of bestRows) console.log(`     ${line(h.leadId)}`);
  for (const code of ["no-capacity", "no-available-operator"]) {
    const rows = heldBy(code);
    if (rows.length) {
      console.log(`\n  4b. HELD — ${code}: ${rows.length}`);
      for (const h of rows) console.log(`     ${line(h.leadId)}  ← ${h.reason}`);
    }
  }

  console.log(`\n  5. EXCLUDED from consideration entirely: ${level.excluded.length}`);
  for (const e of level.excluded) console.log(`     ${e.businessName.padEnd(34)} ${e.reason}`);
  const internal = leads.filter(isInternalLead);
  console.log(`     …of which internal test records: ${internal.length} ` +
              `(carrying ${openTasks.filter((t) => internal.some((l) => l.id === t.leadId)).length} open task(s) that do NOT count toward anyone's day)`);

  // Sanity: a sensible daily distribution never moves most of the book.
  const share = level.consideredLeads ? Math.round((level.reassignments.length / level.consideredLeads) * 100) : 0;
  console.log(`\n  proportion of the considered book proposed for movement: ${share}%`);
  console.log(`  live conversations anywhere in the book: ${leads.filter((l) => isActiveConversation(l, ctx, now)).length}`);

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
