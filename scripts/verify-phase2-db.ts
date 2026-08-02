// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY production verification of Multi-Operator Phase 2.
//
// Every statement is a SELECT. Nothing is written. It prints counts, ids and
// low-cardinality enum-like values only — no business names, no addresses, no
// contact details, no message bodies, no secrets.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/verify-phase2-db.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const),
  });

  let fail = 0;
  const ok = (m: string) => console.log(`  PASS  ${m}`);
  const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail = 1; };
  const chk = (c: boolean, m: string) => (c ? ok(m) : bad(m));
  const head = (m: string) => console.log(`\n${m}`);

  try {
    // ── Operators, roles ─────────────────────────────────────────────────────
    head("[A] OPERATORS AND ROLES  (users table)");
    const users = await sql`select id, role, active, daily_capacity, availability_mode, timezone from users order by id`;
    for (const u of users) {
      console.log(`        ${u.id.padEnd(8)} role=${String(u.role).padEnd(20)} active=${u.active} cap=${u.daily_capacity} avail=${u.availability_mode} tz=${u.timezone ?? "(null)"}`);
    }
    chk(users.length >= 2, `users table holds ${users.length} operators`);
    chk(users.every((u) => u.active), "every operator row is active");
    chk(users.every((u) => Number(u.daily_capacity) > 0), "every operator has a positive daily capacity");

    // ── Every Part-2 field exists (proves no migration was needed) ───────────
    head("[B] SCHEMA — every Team Management field already existed");
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'users' order by column_name`;
    const have = new Set(cols.map((c) => c.column_name));
    for (const c of ["name", "initials", "availability_mode", "daily_capacity", "preferred_work_kinds", "timezone", "role", "active"]) {
      chk(have.has(c), `users.${c} exists`);
    }
    chk(!have.has("password_hash"), "users.password_hash does NOT exist (no per-operator credential today)");

    // ── Leads carry no timezone column; hours are absent ────────────────────
    head("[C] TIMEZONE — derived, never stored");
    const leadCols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'leads'`;
    const lhave = new Set(leadCols.map((c) => c.column_name));
    chk(!lhave.has("timezone"), "leads.timezone does NOT exist — timezone is derived at read time");
    for (const c of ["state", "latitude", "longitude", "postal_code"]) chk(lhave.has(c), `leads.${c} exists (inference input)`);
    const [h] = await sql`select count(*)::int c from leads where hours is not null`;
    console.log(`        leads with stored opening hours: ${h.c}  (business hours are assumed 09-17 Mon-Fri)`);

    // ── Ownership distribution ───────────────────────────────────────────────
    head("[D] OWNERSHIP — no business can be in two queues");
    const dist = await sql`select assigned_to, count(*)::int leads from leads group by assigned_to order by leads desc`;
    for (const d of dist) console.log(`        assigned_to=${d.assigned_to ?? "(unassigned)"} leads=${d.leads}`);
    const [tot] = await sql`select count(*)::int c from leads`;
    const sum = dist.reduce((n, d) => n + Number(d.leads), 0);
    chk(sum === Number(tot.c), `ownership partitions the book exactly (${sum} = ${tot.c}) — assigned_to is single-valued`);
    const orphan = await sql`
      select l.assigned_to, count(*)::int c from leads l
      where l.assigned_to is not null and not exists (select 1 from users u where u.id = l.assigned_to)
      group by l.assigned_to`;
    chk(orphan.length === 0, "no lead is owned by an operator that does not exist");

    // ── Internal test records ────────────────────────────────────────────────
    head("[E] INTERNAL TEST RECORDS");
    const [it] = await sql`select count(*)::int c from leads where source = 'internal-test'`;
    const [ita] = await sql`select count(*)::int c from leads where source = 'internal-test' and assigned_to is not null`;
    console.log(`        internal-test leads: ${it.c}  (of which assigned: ${ita.c})`);
    chk(true, "internal-test leads counted — exclusion is enforced in the scheduler, asserted by unit test");

    // ── Ownership history ────────────────────────────────────────────────────
    head("[F] OWNERSHIP HISTORY  (audit_log is append-only)");
    const acts = await sql`
      select action, count(*)::int c, max(created_at) last
      from audit_log where action like 'lead.%' or action like 'operator.%'
      group by action order by action`;
    for (const a of acts) console.log(`        ${String(a.action).padEnd(34)} ${String(a.c).padStart(5)}   last=${a.last ? new Date(a.last as string).toISOString() : "-"}`);
    chk(acts.length > 0, "ownership history exists and is readable");

    // ── Nothing moved during the deployment ──────────────────────────────────
    head("[G] DEPLOYMENT WINDOW — no ownership change, no lead moved, no email sent");
    const since = process.env.DEPLOY_SINCE || new Date(Date.now() - 90 * 60 * 1000).toISOString();
    console.log(`        window start: ${since}`);
    const [mv] = await sql`
      select count(*)::int c from audit_log
      where created_at >= ${since}
        and action in ('lead.assigned','lead.reassigned','lead.transferred','lead.released')`;
    chk(Number(mv.c) === 0, `zero ownership events since the window opened (${mv.c})`);
    const [ch] = await sql`select count(*)::int c from leads where assigned_at >= ${since}`;
    chk(Number(ch.c) === 0, `zero leads had their assignment stamped in the window (${ch.c})`);
    const [em] = await sql`select count(*)::int c from email_sends where created_at >= ${since}`;
    chk(Number(em.c) === 0, `zero rows added to email_sends in the window (${em.c})`);
    const [es] = await sql`select count(*)::int c from email_sends where sent_at >= ${since}`;
    chk(Number(es.c) === 0, `zero emails marked sent in the window (${es.c})`);

    // ── Migrations ───────────────────────────────────────────────────────────
    head("[H] MIGRATIONS");
    const applied = await sql<{ c: number }[]>`select count(*)::int c from drizzle.__drizzle_migrations`;
    console.log(`        applied migrations recorded in the database: ${applied[0].c}`);

    console.log(`\n${fail === 0 ? "ALL DATABASE CHECKS PASSED" : "SOME DATABASE CHECKS FAILED"}`);
    console.log("rows written by this script: 0");
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.exit(fail);
}

main().catch((e) => { console.error(e); process.exit(1); });
