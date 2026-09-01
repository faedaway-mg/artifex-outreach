// TEMP read-only status probe (section G proof). Prints the current state + provenance of recent
// screenshot jobs, and confirms the stored PNG artifact exists for each ready capture.
import postgres from "postgres";
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
const sql = postgres(url, { max: 2, prepare: false, ssl, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const rows = await sql`SELECT j.id, j.business_id, j.viewport, j.status, j.attempt, j.final_url, j.sha256,
      j.byte_size, j.content_type, j.output_key, j.error, j.provenance, j.captured_at,
      a.byte_size AS artifact_bytes, a.content_type AS artifact_ct
    FROM content_studio_screenshot_jobs j
    LEFT JOIN content_studio_artifacts a ON a.object_key = j.output_key AND a.deleted_at IS NULL
    ORDER BY j.created_at DESC LIMIT 8`;
  for (const r of rows) {
    const p = r.provenance || {};
    console.log(JSON.stringify({
      id: r.id, biz: r.business_id, vp: r.viewport, status: r.status, attempt: r.attempt,
      finalUrl: r.final_url, resolvedIps: p.resolvedIps, redirects: (p.redirects || []).length,
      sha256: r.sha256 ? r.sha256.slice(0, 16) + "…" : null, bytes: r.byte_size, ct: r.content_type,
      outputKey: r.output_key, artifactBytes: r.artifact_bytes, artifactCt: r.artifact_ct,
      cached: p.cached, outputPixels: p.outputPixels, error: r.error,
    }));
  }
  const health = await sql`SELECT status, count(*) FROM content_studio_screenshot_jobs GROUP BY status ORDER BY status`;
  console.log("QUEUE=" + health.map((h) => `${h.status}:${h.count}`).join(" "));
} finally { await sql.end({ timeout: 5 }); }
