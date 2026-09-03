import postgres from "postgres";
import { studioSnapshot } from "../src/lib/content-studio/store";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false }, prepare: false });
  const rows = await sql`SELECT id FROM content_studio_templates WHERE id LIKE 'client-%' ORDER BY id LIMIT 30`.catch((e) => ({ error: e.message } as any));
  console.log("client templates in PG table:", Array.isArray(rows) ? rows.length : rows);
  if (Array.isArray(rows)) rows.slice(0, 8).forEach((r: any) => console.log("  " + r.id));
  await sql.end();
  const snap = await studioSnapshot().catch((e) => { console.log("studioSnapshot error:", e.message); return []; });
  const clientPieces = (snap as any[]).filter((s) => s.piece.id.startsWith("client-"));
  console.log("studioSnapshot client pieces:", clientPieces.length);
  clientPieces.slice(0, 8).forEach((s: any) => console.log("  " + s.piece.id + " | narration lines: " + (s.piece.narration?.length ?? 0)));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
