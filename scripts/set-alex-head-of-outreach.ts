// ─────────────────────────────────────────────────────────────────────────────
// ONE ROW WRITE: promote Alex from the prose role "Operator" to the canonical
// role "head_of_outreach", so that the declared operating mode — Jordan and Alex
// as CO-EQUAL outreach managers — is what the deployed system actually enforces.
//
// This is NOT an ownership change. No lead moves. No email is sent. No
// environment variable changes. It writes exactly two rows:
//
//   1. users.role for `alex`         "Operator" -> "head_of_outreach"
//   2. one append-only audit_log entry (action = operator.role)
//
// It takes the same path setRoleAction takes in the UI, so the audit entry is
// indistinguishable from one a manager would have written by hand. Idempotent:
// re-running it after the change is a no-op.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/set-alex-head-of-outreach.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const TARGET = "alex";
const ACTOR = "jordan";
const NEW_ROLE = "head_of_outreach";

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const),
  });

  try {
    const [before] = await sql`select id, role from users where id = ${TARGET}`;
    if (!before) { console.log(`No operator '${TARGET}'. Nothing written.`); return; }
    console.log(`before: ${before.id} role=${before.role}`);

    if (before.role === NEW_ROLE) { console.log("Already Head of Outreach. Nothing written."); return; }

    const now = new Date().toISOString();
    await sql`update users set role = ${NEW_ROLE}, updated_at = ${now} where id = ${TARGET}`;
    await sql`
      insert into audit_log (action, actor, target_type, target_id, meta, ip, created_at)
      values ('operator.role', ${ACTOR}, 'operator', ${TARGET},
              ${sql.json({ from: before.role, to: NEW_ROLE, label: "Head of Outreach",
                           reason: "Co-equal outreach managers until the first three paying clients." })},
              null, ${now})`;

    const [after] = await sql`select id, role from users where id = ${TARGET}`;
    console.log(`after:  ${after.id} role=${after.role}`);
    console.log("rows written: 2 (one users row, one append-only audit entry). No ownership touched.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
