// ─────────────────────────────────────────────────────────────────────────────
// breakbot explainer-qa — sample EVERY required explainer across its whole runtime and
// report (and optionally persist a snapshot for the Explainer QA Gallery).
//
//   pnpm -s tsx scripts/breakbot-explainer-qa.ts                 # probe LOCAL masters, print only
//   pnpm -s tsx scripts/breakbot-explainer-qa.ts --served        # probe the PROD served assets
//   ... --persist                                                # also write gallery snapshots (needs DB)
//
// Media QA needs ffprobe/ffmpeg (a local/CI tool). It NEVER calls a paid provider, never
// renders, never sends. Persisting writes only a small snapshot into Settings JSONB.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { join } from "node:path";
import { probeMedia } from "../src/lib/breakbot/media-probe";
import { assessMedia } from "../src/lib/breakbot/media-qa";
import { REQUIRED_EXPLAINER_SCOPES, EXPLAINER_ORIENTATION, resolveCanonicalExplainer, explainerLocalMasterPath } from "../src/lib/quick-fix/explainer-library";

const ROOT = process.cwd();
const has = (f: string) => process.argv.includes(f);
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const BASE = arg("--base") ?? "https://outreach.artifexlabs.tech";
const SERVED = has("--served");
const PERSIST = has("--persist");

async function main() {
  const rows: string[] = [];
  let anyBlocked = false;

  for (const scope of REQUIRED_EXPLAINER_SCOPES) {
    const resolved = await resolveCanonicalExplainer(scope).catch(() => null);
    // Decide the probe source: a static /trust-videos asset can be probed locally; a
    // served api route (Matt-bound) is probed over http against BASE.
    let source: string | null = null;
    const url = resolved?.servedMp4Url ?? null;
    if (url && url.startsWith("/trust-videos/") && !SERVED) {
      const local = join(ROOT, `public${url}`);
      source = existsSync(local) ? local : `${BASE}${url}`;
    } else if (url) {
      source = `${BASE}${url}`;
    } else {
      const localMaster = explainerLocalMasterPath(scope);
      source = localMaster && existsSync(join(ROOT, localMaster)) ? join(ROOT, localMaster) : null;
    }

    if (!source) { rows.push(`  ✗ ${scope.padEnd(28)} MISSING (no canonical asset)`); anyBlocked = true; continue; }

    try {
      const probe = await probeMedia(source, { label: scope, expectedOrientation: EXPLAINER_ORIENTATION, motionExpected: true, narrated: true, minDurationSeconds: 20 });
      const r = assessMedia(probe);
      if (r.status === "BLOCKED") anyBlocked = true;
      const icon = r.status === "PASS" ? "✓" : r.status === "WARNING" ? "⚠" : "✗";
      rows.push(`  ${icon} ${scope.padEnd(28)} ${r.status.padEnd(8)} alive→${r.aliveThroughPct}% ${r.orientation ?? "?"} ${r.aspectRatio ?? ""} ${r.findings.map((f) => f.kind).join(",")}`);

      if (PERSIST && resolved?.assetRevision) {
        const { setMediaQaSnapshot } = await import("../src/lib/breakbot/explainer-qa-store");
        await setMediaQaSnapshot({
          scope, assetRevision: resolved.assetRevision, status: r.status, aliveThroughPct: r.aliveThroughPct,
          orientation: r.orientation, aspectRatio: r.aspectRatio, durationSeconds: probe.durationSeconds,
          findings: r.findings, timeline: r.timeline, probedAt: new Date().toISOString(), source,
        }, "breakbot-explainer-qa");
      }
    } catch (e: any) {
      rows.push(`  ✗ ${scope.padEnd(28)} PROBE-ERROR ${e?.message || e}`);
      anyBlocked = true;
    }
  }

  console.log("━━ BREAKBOT — EXPLAINER LIBRARY MEDIA QA ━━");
  console.log(`  source: ${SERVED ? `served @ ${BASE}` : "local masters"}   persist: ${PERSIST ? "yes" : "no (print only)"}`);
  console.log(rows.join("\n"));
  console.log(`  ${anyBlocked ? "✗ one or more explainers BLOCKED/MISSING" : "✓ all explainers healthy across the full runtime"}`);
  process.exit(anyBlocked ? 1 : 0);
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
