// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY verification that the Phase 2 transfer preview computes real
// workload deltas against LIVE production rows, and that the timezone layer is
// present without touching queue ordering.
//
// Nothing is written. previewTransfer() is a pure function — it cannot write
// even if it wanted to. No ownership column is read-modify-written, no audit row
// is created, no email is sent. Business names are printed because the operator
// needs to recognise the work; contact details and message bodies are not.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/verify-phase2-preview.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const pad =(s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

async function main() {
  const { listOperators, listLeads, allTasks, allPlans, allMeetings } = await import("../src/lib/repo");
  const { previewTransfer } = await import("../src/lib/operators/transfer");
  const { roleOf, ROLE_LABEL, capabilitiesOf, canImpersonate } = await import("../src/lib/operators/roles");
  const { callWindow, inferZone } = await import("../src/lib/timezone");
  const { distributionEnabled } = await import("../src/lib/operators/distribute");

  const now = new Date();
  const [operators, leads, tasks, plans, meetings] = await Promise.all([
    listOperators(), listLeads(), allTasks(), allPlans(), allMeetings(),
  ]);
  const ctx = { plans, meetings };

  console.log(`\n[P1] LIVE STATE`);
  console.log(`        operators=${operators.length}  leads=${leads.length}  open tasks=${tasks.filter((t) => t.status === "open").length}`);
  console.log(`        OPERATOR_DISTRIBUTION_ENABLED -> distributionEnabled() = ${distributionEnabled()}`);

  console.log(`\n[P2] ROLES AS THE DEPLOYED CODE READS THEM`);
  for (const o of operators) {
    const r = roleOf(o);
    const c = capabilitiesOf(o);
    const yes = (Object.keys(c) as Array<keyof typeof c>).filter((k) => c[k]);
    console.log(`        ${pad(o.id, 8)} row="${pad(String(o.role), 22)}" -> ${pad(ROLE_LABEL[r], 18)} can: ${yes.join(", ") || "(nothing)"}`);
  }

  console.log(`\n[P3] IMPERSONATION AUTHORITY (computed, not performed)`);
  for (const a of operators) {
    for (const b of operators) {
      if (a.id === b.id) continue;
      const v = canImpersonate(a, b);
      console.log(`        ${pad(a.id, 8)} -> ${pad(b.id, 8)} ${v.ok ? "ALLOWED " : "REFUSED "} ${v.reason}`);
    }
  }

  // ── Transfer preview against live rows ─────────────────────────────────────
  const owner = operators.find((o) => leads.some((l) => l.assignedTo === o.id));
  const other = operators.find((o) => o.id !== owner?.id);
  if (!owner || !other) { console.log("\n[P4] not enough operators to preview a transfer"); return; }

  const sample = leads.filter((l) => l.assignedTo === owner.id).slice(0, 3).map((l) => l.id);
  const p = previewTransfer({ leadIds: sample, to: other.id, operators, leads, tasks, ctx, now });

  console.log(`\n[P4] TRANSFER PREVIEW — ${sample.length} businesses, ${owner.id} -> ${other.id}  (NOT APPLIED)`);
  console.log(`        summary: ${p.summary}`);
  for (const line of p.lines) {
    console.log(`        · ${pad(line.businessName, 46)} ${pad(line.fromName, 8)} -> ${pad(line.toName, 10)} ${line.blocked ? `BLOCKED: ${line.blocked}` : "movable"}`);
    console.log(`            why owned now: ${line.whyOwned}`);
    if (line.warnings.length) console.log(`            warnings: ${line.warnings.join(" | ")}`);
  }
  console.log(`        WORKLOAD DELTAS (the scheduler's own arithmetic):`);
  for (const w of p.workloads) {
    console.log(`          ${pad(w.name, 10)} owns ${w.before.leadsOwned} -> ${w.after.leadsOwned}   today ${w.before.dueToday}/${w.before.capacity} -> ${w.after.dueToday}/${w.after.capacity}   headroom ${w.before.headroom} -> ${w.after.headroom}`);
  }

  // ── Timezone: present, derived, and NOT ordering anything ─────────────────
  console.log(`\n[P5] TIMEZONE — derived at read time, influencing nothing yet`);
  const byZone = new Map<string, number>();
  for (const l of leads) {
    const z = inferZone(l);
    byZone.set(`${z.zone} (${z.confidence})`, (byZone.get(`${z.zone} (${z.confidence})`) ?? 0) + 1);
  }
  for (const [z, n] of [...byZone].sort((a, b) => b[1] - a[1])) console.log(`        ${pad(z, 44)} ${n} businesses`);

  console.log(`        sample call windows right now (${now.toISOString()}):`);
  for (const l of leads.slice(0, 5)) {
    const w = callWindow(l, now);
    console.log(`          ${pad(l.businessName, 46)} ${pad(w.zone, 22)} ${pad(w.localClock, 6)} ${pad(w.state, 20)} ${w.label}`);
  }

  const src = (await import("node:fs")).readFileSync("src/lib/operators/assignment.ts", "utf8");
  const leaks = ["callWindow", "inferZone", "zonedParts", "timezone"].filter((s) => src.includes(s));
  console.log(`        assignment.ts references to the timezone layer: ${leaks.length ? leaks.join(", ") : "NONE — ownership cannot see time-of-day"}`);

  console.log(`\nrows written by this script: 0`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
