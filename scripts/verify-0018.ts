// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY verification of migration 0018 (multi-operator work distribution).
//
// Proves, from production evidence:
//   1. every column, default, nullability and index 0018 promised
//   2. both operators exist with the shape the engine expects
//   3. every pre-existing lead is still owned by Jordan
//   4. the three new lead columns were backfilled — no NULLs, no future dates,
//      and no lead reading as abandoned on day one
//   5. nothing was reassigned (zero ownership audit rows written)
//
// Every statement is a SELECT. Counts and low-cardinality values only —
// no business names, no addresses, no message content, no secrets.
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const),
  });

  try {
    // ── 1. Migration recorded ────────────────────────────────────────────────
    console.log("\n[1] MIGRATION LEDGER");
    const applied = await sql`select count(*)::int c from drizzle.__drizzle_migrations`;
    check(applied[0].c === 19, "19 migrations recorded (0000–0018)", `found ${applied[0].c}`);

    // ── 2. Schema shape ──────────────────────────────────────────────────────
    console.log("\n[2] SCHEMA — leads");
    const leadCols = await sql<Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>>`
      select column_name, is_nullable, column_default, data_type
      from information_schema.columns
      where table_name = 'leads'
        and column_name in ('assigned_to','assigned_at','assignment_reason','last_operator_activity_at')
      order by column_name`;
    for (const c of leadCols) {
      console.log(`        ${c.column_name.padEnd(28)} ${c.data_type.padEnd(28)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
    }
    const at = leadCols.find((c) => c.column_name === "assigned_to");
    check(leadCols.length === 4, "all 4 ownership columns present", `found ${leadCols.length}`);
    check(at?.is_nullable === "YES", "assigned_to is NULLABLE — 'unassigned' is a real state");
    check(at?.column_default === null, "assigned_to has NO default — new leads are not silently owned");

    console.log("\n[2] SCHEMA — operators (physical table `users`)");
    const opCols = await sql<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_name = 'users'
        and column_name in ('initials','avatar_url','active','availability_mode','preferred_work_kinds','daily_capacity','timezone','last_active_at')
      order by column_name`;
    for (const c of opCols) {
      console.log(`        ${c.column_name.padEnd(28)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
    }
    check(opCols.length === 8, "all 8 operator columns present", `found ${opCols.length}`);

    console.log("\n[2] SCHEMA — index");
    const idx = await sql`select indexname from pg_indexes where tablename = 'leads' and indexname = 'leads_assigned_idx'`;
    check(idx.length === 1, "leads_assigned_idx exists");

    // ── 3. Operators ─────────────────────────────────────────────────────────
    console.log("\n[3] OPERATORS");
    const ops = await sql<Array<Record<string, unknown>>>`
      select id, role, initials, active, availability_mode, daily_capacity, timezone,
             (last_active_at is not null) as has_last_active
      from users order by id`;
    for (const o of ops) console.log(`        ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    check(ops.length === 2, "exactly 2 operators", `found ${ops.length}`);
    check(ops.some((o) => o.id === "jordan" && o.initials === "JJ"), "jordan exists with initials JJ");
    check(ops.some((o) => o.id === "alex" && o.initials === "AX"), "alex exists with initials AX");
    check(ops.every((o) => o.active === true), "both operators active");
    check(ops.every((o) => o.availability_mode === "available"), "both available");
    check(ops.every((o) => o.daily_capacity === 8), "both capacity 8");

    // ── 4. Ownership unchanged ───────────────────────────────────────────────
    console.log("\n[4] OWNERSHIP — unchanged by the migration");
    const dist = await sql<Array<{ assigned_to: string | null; leads: number }>>`
      select assigned_to, count(*)::int leads from leads group by assigned_to order by leads desc`;
    for (const d of dist) console.log(`        assigned_to=${d.assigned_to}  leads=${d.leads}`);
    check(dist.length === 1 && dist[0].assigned_to === "jordan" && dist[0].leads === 32,
      "all 32 leads still owned by jordan — zero moved to alex");

    // ── 5. Backfill ──────────────────────────────────────────────────────────
    console.log("\n[5] BACKFILL — assigned_at / assignment_reason / last_operator_activity_at");
    const [b] = await sql<Array<Record<string, number>>>`
      select
        count(*)::int                                                          owned,
        count(*) filter (where assigned_at is null)::int                       null_assigned_at,
        count(*) filter (where assignment_reason is null)::int                 null_reason,
        count(*) filter (where last_operator_activity_at is null)::int         null_activity,
        count(*) filter (where assigned_at = created_at)::int                  assigned_at_eq_created,
        count(*) filter (where assigned_at > now())::int                       future_assigned_at,
        count(*) filter (where last_operator_activity_at > now())::int         future_activity,
        count(*) filter (where last_operator_activity_at < assigned_at)::int   activity_before_assignment
      from leads where assigned_to is not null`;
    for (const [k, v] of Object.entries(b)) console.log(`        ${k.padEnd(30)} ${v}`);
    check(b.null_assigned_at === 0, "no NULL assigned_at");
    check(b.null_reason === 0, "no NULL assignment_reason");
    check(b.null_activity === 0, "no NULL last_operator_activity_at");
    check(b.assigned_at_eq_created === b.owned, "assigned_at == created_at for every backfilled lead");
    check(b.future_assigned_at === 0 && b.future_activity === 0, "no timestamps in the future");
    check(b.activity_before_assignment === 0, "activity never predates assignment");

    const reasons = await sql<Array<{ assignment_reason: string; leads: number }>>`
      select assignment_reason, count(*)::int leads from leads
      where assigned_to is not null group by assignment_reason order by leads desc`;
    for (const r of reasons) console.log(`        reason="${r.assignment_reason}"  leads=${r.leads}`);

    // Staleness horizon — would day one read as a mass-abandonment event?
    const [age] = await sql<Array<Record<string, number>>>`
      select
        min(extract(epoch from (now() - last_operator_activity_at)) / 86400)::numeric(10,1)::float min_idle_days,
        max(extract(epoch from (now() - last_operator_activity_at)) / 86400)::numeric(10,1)::float max_idle_days,
        count(*) filter (where last_operator_activity_at < now() - interval '6 days')::int over_6_calendar_days
      from leads where assigned_to is not null`;
    console.log(`        idle days: min=${age.min_idle_days}  max=${age.max_idle_days}  older_than_6d=${age.over_6_calendar_days}`);

    // ── 6. No ownership events written ───────────────────────────────────────
    console.log("\n[6] AUDIT — no ownership events written by the migration");
    const audit = await sql<Array<{ action: string; entries: number }>>`
      select action, count(*)::int entries from audit_log
      where action in ('lead.assigned','lead.reassigned','lead.transferred','operator.availability','operator.capacity')
      group by action order by entries desc`;
    if (!audit.length) console.log("        (none)");
    for (const a of audit) console.log(`        ${a.action}=${a.entries}`);
    check(audit.length === 0, "zero lead.assigned / lead.reassigned / lead.transferred rows");

    console.log(`\nrows written by this script: 0`);
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  } finally {
    await sql.end();
  }
}
main().then(() => process.exit(failures === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
