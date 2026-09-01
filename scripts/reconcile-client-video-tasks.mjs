// One-time reconciliation for the canonical client-video unification (section C).
// READ-ONLY by default; pass --apply to complete open prepare_video tasks for any lead whose client
// video (`client-<leadId>`) is ALREADY posted — the invariant the posted route now maintains going
// forward. Prints before/after counts. Never touches any other task type or any lead without a posted
// client video. No email is ever sent.
//
//   railway run --service Postgres -- node scripts/reconcile-client-video-tasks.mjs           (dry)
//   railway run --service Postgres -- node scripts/reconcile-client-video-tasks.mjs --apply   (reconcile)

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_PUBLIC_URL/DATABASE_URL in env"); process.exit(1); }

// Reads are guarded read-only; the single write (when --apply) is an explicit, scoped UPDATE.
const sql = postgres(url, { max: 1, idle_timeout: 5, ...(APPLY ? {} : { connection: { options: "-c default_transaction_read_only=on" } }) });

const leadOf = (pieceId) => (pieceId.startsWith("client-") ? pieceId.slice("client-".length) : null);

async function counts() {
  const openTasks = await sql`SELECT DISTINCT lead_id FROM tasks WHERE type = 'prepare_video' AND status = 'open'`;
  const posted = await sql`SELECT piece_id FROM content_studio_posted WHERE piece_id LIKE 'client-%'`;
  const templates = await sql`SELECT id FROM content_studio_templates WHERE id LIKE 'client-%'`;
  const openLeads = new Set(openTasks.map((r) => r.lead_id));
  const postedLeads = new Set(posted.map((r) => leadOf(r.piece_id)).filter(Boolean));
  const mismatch = [...postedLeads].filter((l) => openLeads.has(l));
  return { openLeads, postedLeads, preparedTemplates: templates.length, mismatch };
}

try {
  const before = await counts();
  console.log(JSON.stringify({
    phase: "before",
    openPrepareVideoLeads: before.openLeads.size,
    preparedClientTemplates: before.preparedTemplates,
    postedClientVideos: before.postedLeads.size,
    postedButTaskStillOpen: before.mismatch.length,
  }));

  if (APPLY && before.mismatch.length > 0) {
    const updated = await sql`UPDATE tasks SET status = 'done', updated_at = now()
      WHERE type = 'prepare_video' AND status = 'open' AND lead_id = ANY(${before.mismatch})
      RETURNING id`;
    console.log(JSON.stringify({ phase: "apply", tasksCompleted: updated.length }));
    const after = await counts();
    console.log(JSON.stringify({
      phase: "after",
      openPrepareVideoLeads: after.openLeads.size,
      postedButTaskStillOpen: after.mismatch.length,
    }));
  } else if (APPLY) {
    console.log(JSON.stringify({ phase: "apply", tasksCompleted: 0, note: "no drift — nothing to reconcile" }));
  }
} finally {
  await sql.end({ timeout: 5 });
}
