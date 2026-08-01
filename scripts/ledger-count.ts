// READ-ONLY production counts. Writes nothing. Prints no addresses or content.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/ledger-count.ts
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const) });
  try {
    const [a] = await sql`select count(*)::int total, count(sent_at)::int sent from email_sends`;
    const [b] = await sql`select count(*)::int c from tasks`;
    const [c] = await sql`select count(*)::int c from tasks where source_step_id is not null`;
    const [d] = await sql`select count(*)::int c from acquisition_plans where status = 'active'`;
    console.log(`email_sends ..................... ${a.total} rows (${a.sent} sent)`);
    console.log(`tasks ........................... ${b.c} rows`);
    console.log(`tasks projected from a step ..... ${c.c}`);
    console.log(`active acquisition plans ........ ${d.c}`);
    console.log("rows written by this script: 0");
  } finally {
    await sql.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
