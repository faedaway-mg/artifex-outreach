// ─────────────────────────────────────────────────────────────────────────────
// APPEND a correction to the ownership/role history. It does NOT rewrite it.
//
// What went wrong: the first attempt at Alex's promotion ran the UPDATE and the
// audit INSERT as two separate statements. The INSERT failed (audit_log.id has
// no database default — the application generates it), leaving the role changed
// with no record. The recovery run then read users.role to build the audit
// entry's `from` value, and by then it already said "head_of_outreach". So the
// surviving entry claims Alex went from Head of Outreach to Head of Outreach.
//
// He did not. He went from "Operator".
//
// audit_log is append-only, and that rule is worth more than a tidy row. The
// entry stays exactly as written; this appends a second entry recording the true
// prior value and why the first one is misleading. A history you are allowed to
// edit is not a history.
//
// Writes exactly one row. No ownership touched, no lead moved, no email sent.
// Idempotent.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/correct-role-audit-provenance.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const TARGET = "alex";
const ACTOR = "jordan";
const TRUE_FROM = "Operator";

async function main() {
  const { newId } = await import("../src/lib/store");
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const),
  });

  try {
    const [existing] = await sql`
      select count(*)::int c from audit_log
      where action = 'operator.role.corrected' and target_id = ${TARGET}`;
    if (Number(existing.c) > 0) { console.log("Correction already recorded. Nothing written."); return; }

    const [orig] = await sql`
      select id, created_at, meta from audit_log
      where action = 'operator.role' and target_id = ${TARGET}
      order by created_at asc limit 1`;
    if (!orig) { console.log("No operator.role entry to correct. Nothing written."); return; }

    const id = newId("audit");
    const at = new Date().toISOString();
    const origMeta = (orig.meta ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
    const meta = {
      corrects: String(orig.id),
      actualFrom: TRUE_FROM,
      recordedFrom: str(origMeta.from),
      recordedTo: str(origMeta.to),
      currentRole: "head_of_outreach",
      changesRole: false,
      changesCapabilities: false,
      cause:
        "The first promotion attempt was not transactional. Its UPDATE of users.role succeeded and its "
        + "audit INSERT then failed (audit_log.id has no database default — the application generates it). "
        + "The recovery run read users.role to fill `from`, by which time it already said head_of_outreach, "
        + "so the surviving entry incorrectly records head_of_outreach -> head_of_outreach.",
      why:
        "Alex's true previous role was \"Operator\". This entry records that fact. The original entry is "
        + "left exactly as written because audit_log is append-only — a history you may edit is not a "
        + "history. This correction changes no role and no capability; it changes only the record.",
    };

    await sql`
      insert into audit_log (id, action, actor, target_type, target_id, meta, ip, created_at)
      values (${id}, 'operator.role.corrected', ${ACTOR}, 'operator', ${TARGET},
              ${sql.json(meta)}, null, ${at})`;

    console.log(`correction row id: ${id}`);
    console.log(`correction timestamp: ${at}`);
    console.log(`corrects: ${orig.id} (recorded ${orig.created_at})`);
    console.log(`  recorded from: ${JSON.stringify(meta.recordedFrom)}`);
    console.log(`  actual   from: ${JSON.stringify(TRUE_FROM)}`);
    console.log(`  current role:  ${JSON.stringify(meta.currentRole)} (unchanged by this row)`);
    console.log("rows written: 1 (append-only). No ownership touched. No role changed.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
