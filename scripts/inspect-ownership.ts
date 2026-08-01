// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY ownership survey.
//
// Answers the questions the multi-operator design depends on, from production
// evidence rather than assumption:
//
//   • Is the dormant `users` table actually empty in production?
//   • What distinct values does `leads.assigned_to` really hold?
//   • What distinct values does `acquisition_plans.owner` really hold?
//   • What distinct values does `audit_log.actor` really hold?
//   • How much work is currently open, and against how many businesses?
//
// Every statement is a SELECT. It prints counts and low-cardinality enum-like
// values only — no business names, no addresses, no message content, no secrets.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/inspect-ownership.ts
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

  const show = (label: string, rows: Array<Record<string, unknown>>) => {
    console.log(`\n${label}`);
    if (!rows.length) console.log("  (no rows)");
    for (const r of rows) console.log(`  ${Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  };

  try {
    // Does the users table exist, and does it hold anything?
    const [u] = await sql`select count(*)::int c from users`;
    console.log(`users table rows ................ ${u.c}`);
    if (u.c > 0) show("users (id / role only — no names or emails printed)", await sql`select id, role from users order by id`);

    show("leads.assigned_to distribution", await sql`
      select assigned_to, count(*)::int leads from leads group by assigned_to order by leads desc`);

    show("acquisition_plans.owner distribution", await sql`
      select owner, count(*)::int plans from acquisition_plans group by owner order by plans desc`);

    show("audit_log.actor distribution", await sql`
      select actor, count(*)::int entries from audit_log group by actor order by entries desc`);

    show("open tasks by type", await sql`
      select type, count(*)::int open_tasks, count(distinct lead_id)::int businesses
      from tasks where status = 'open' group by type order by open_tasks desc`);

    show("leads by pipeline stage", await sql`
      select pipeline_stage, count(*)::int leads from leads group by pipeline_stage order by leads desc`);

    const [w] = await sql`
      select
        (select count(*)::int from leads)                                          total_leads,
        (select count(*)::int from tasks where status = 'open')                    open_tasks,
        (select count(*)::int from acquisition_plans where status = 'active')      active_plans,
        (select count(*)::int from inbound_messages)                               inbound_messages,
        (select count(*)::int from meetings)                                       meetings`;
    show("workspace totals", [w]);

    console.log("\nrows written by this script: 0");
  } finally {
    await sql.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
