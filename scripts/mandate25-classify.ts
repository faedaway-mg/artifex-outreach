// MANDATE 25 B2 — read-only classification DRY-RUN of every existing video. Reports each video's canonical
// purpose + the lineage basis, before any backfill. Writes NOTHING.
import { studioSnapshot } from "../src/lib/content-studio/store";
import { classifyVideoPurpose } from "../src/lib/content-studio/video-classification";

async function main() {
  const snap = await studioSnapshot();
  const rows = snap.map((it) => {
    const p: any = it.piece;
    const v = classifyVideoPurpose({ id: p.id, businessId: p.businessId ?? null, workflow: p.workflow ?? null });
    return { id: p.id, workflow: p.workflow ?? null, businessId: p.businessId ?? null, title: (p.title ?? "").slice(0, 40), purpose: v.purpose, basis: v.basis };
  });
  const counts = rows.reduce((a, r) => { a[r.purpose] = (a[r.purpose] ?? 0) + 1; return a; }, {} as Record<string, number>);
  console.log(JSON.stringify({ total: rows.length, counts, rows }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
