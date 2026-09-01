// TEMP read-only verification: (1) the 3 client templates persisted narrationEvidence + evidenceState +
// revision; (2) each business has a READY screenshot with a stored PNG artifact.
import postgres from "postgres";
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
const sql = postgres(url, { max: 2, prepare: false, ssl, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const tpls = await sql`SELECT id, business_id, doc FROM content_studio_templates WHERE id LIKE 'client-%' ORDER BY id`;
  for (const t of tpls) {
    const d = t.doc || {};
    const ev = d.narrationEvidence || [];
    const material = ev.filter((e) => e.kind !== "framing");
    const withSource = material.filter((e) => e.confidence || (e.basis && e.basis.length));
    const shot = await sql`SELECT id, status, byte_size, sha256, final_url, output_key FROM content_studio_screenshot_jobs
      WHERE business_id=${t.business_id} AND viewport='mobile' AND status='ready' ORDER BY captured_at DESC LIMIT 1`;
    const art = shot.length ? await sql`SELECT content_type, byte_size FROM content_studio_artifacts WHERE object_key=${shot[0].output_key} AND deleted_at IS NULL` : [];
    console.log(JSON.stringify({
      template: t.id, businessName: d.businessName, evidenceState: d.evidenceState, revision: d.revision,
      narrationLines: (d.narration || []).length, evidenceEntries: ev.length,
      materialLines: material.length, materialLinesWithSource: withSource.length,
      screenshot: shot.length ? { status: shot[0].status, finalUrl: shot[0].final_url, bytes: shot[0].byte_size, sha: (shot[0].sha256 || "").slice(0, 12) + "…", artifactCt: art[0]?.content_type, artifactBytes: art[0]?.byte_size } : "NONE",
    }));
  }
  const q = await sql`SELECT status, count(*) FROM content_studio_screenshot_jobs GROUP BY status ORDER BY status`;
  console.log("SHOT_QUEUE=" + q.map((h) => `${h.status}:${h.count}`).join(" "));
} finally { await sql.end({ timeout: 5 }); }
