// TEMP proof harness (section G): enqueue a mobile capture for each prepared client video's business,
// using the SAME canonical/dedup/normalize logic as src/lib/content-studio/screenshot-jobs.ts, then poll
// until the deployed worker captures the REAL sites. Read-heavy; the only write is enqueue (idempotent).
// Run: railway run --service Postgres -- sh -c 'DATABASE_URL=$DATABASE_PUBLIC_URL node scripts/_shot_probe.mjs'
import postgres from "postgres";
import { normalizeCaptureUrl } from "./lib/ssrf-guard.mjs";

const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
const sql = postgres(url, { max: 2, prepare: false, ssl });

// Capture the CANONICAL ORIGIN homepage (mirrors captureTargetFor in the store).
const originOf = (raw) => { const u = new URL(raw.trim()); return `${u.protocol}//${u.host}/`; };
function canonicalize(raw) {
  const u = new URL(raw.trim()); u.hash = ""; u.search = ""; u.hostname = u.hostname.toLowerCase();
  let p = u.pathname.replace(/\/+$/, ""); if (p === "") p = "/";
  return `${u.protocol}//${u.host}${p}`;
}
const genId = () => "csshot_" + Array.from({ length: 12 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function enqueue(businessId, pieceId, website) {
  const target = originOf(website);
  const norm = normalizeCaptureUrl(target);
  if (!norm.ok) return { skipped: `unsafe url (${norm.category})` };
  const canonical = canonicalize(norm.url.href);
  // Skip if this origin already has a READY capture (idempotent reconcile), else reuse an in-flight one.
  const ready = await sql`SELECT id FROM content_studio_screenshot_jobs WHERE canonical_url=${canonical} AND viewport='mobile' AND status='ready' ORDER BY captured_at DESC LIMIT 1`;
  if (ready.length) return { id: ready[0].id, alreadyReady: true };
  const existing = await sql`SELECT id,status FROM content_studio_screenshot_jobs WHERE canonical_url=${canonical} AND viewport='mobile' AND status IN ('queued','capturing') ORDER BY created_at DESC LIMIT 1`;
  if (existing.length) return { id: existing[0].id, deduped: true };
  const id = genId();
  await sql`INSERT INTO content_studio_screenshot_jobs (id,business_id,piece_id,requested_url,canonical_url,viewport,status)
    VALUES (${id},${businessId},${pieceId},${norm.url.href},${canonical},'mobile','queued')`;
  return { id, deduped: false };
}

try {
  const rows = await sql`SELECT t.id AS piece_id, t.business_id, l.business_name, l.website
    FROM content_studio_templates t JOIN leads l ON l.id = t.business_id
    WHERE t.id LIKE 'client-%' ORDER BY l.business_name`;
  console.log("=== prepared client businesses ===");
  const jobs = [];
  for (const r of rows) {
    if (!r.website) { console.log(JSON.stringify({ business: r.business_name, website: null, note: "no website on record" })); continue; }
    const res = await enqueue(r.business_id, r.piece_id, r.website);
    jobs.push({ business: r.business_name, website: r.website, ...res });
    console.log(JSON.stringify({ business: r.business_name, website: r.website, ...res }));
  }
  console.log("ENQUEUED_IDS=" + jobs.map((j) => j.id).filter(Boolean).join(","));
} finally {
  await sql.end({ timeout: 5 });
}
