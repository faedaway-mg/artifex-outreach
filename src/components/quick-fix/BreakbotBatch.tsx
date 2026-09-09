"use client";
import { useState } from "react";
import Link from "next/link";
import type { BreakbotBatchView } from "@/lib/quick-fix/operator-views";

// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT BATCH SURFACE (Part A/V) — the operator can run Breakbot over:
//   • Ready-to-Sell  — the top high-confidence READY_TO_SELL stored offers (real, read-only)
//   • Top 10         — same, capped at 10
//   • Demo Fixtures  — the 5 golden + 20 failure fixtures (pure/offline)
//   • Regression     — the release gate: every golden READY, every failure BLOCKED-on-surface
// Nothing here approves/sends/charges. A pass NEVER auto-advances anything.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "ready" | "top10" | "fixtures" | "regression";

const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

interface FixturesResp {
  golden: Array<{ id: string; label: string; overall: string; pass: boolean }>;
  failure: Array<{ id: string; label: string; expectBlockerSurface: string; overall: string; blockers: number; pass: boolean }>;
  allPass: boolean;
}
interface RegressionResp {
  goldenPassed: number; goldenTotal: number; failurePassed: number; failureTotal: number;
  allPass: boolean; regressions: Array<{ id: string; kind: string; reason: string }>;
}

export function BreakbotBatch() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [batch, setBatch] = useState<BreakbotBatchView | null>(null);
  const [fixtures, setFixtures] = useState<FixturesResp | null>(null);
  const [regression, setRegression] = useState<RegressionResp | null>(null);

  async function run(m: Mode) {
    setMode(m); setLoading(true); setErr(null);
    setBatch(null); setFixtures(null); setRegression(null);
    try {
      const r = await fetch(`/api/revenue/breakbot/batch?mode=${m}`, { method: "GET" });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || "Run failed."); return; }
      if (j.batch) setBatch(j.batch as BreakbotBatchView);
      if (j.fixtures) setFixtures(j.fixtures as FixturesResp);
      if (j.regression) setRegression(j.regression as RegressionResp);
    } catch { setErr("Request failed."); } finally { setLoading(false); }
  }

  const RUNS: Array<{ m: Mode; label: string; desc: string }> = [
    { m: "ready", label: "Run on Ready-to-Sell", desc: "Real high-confidence READY_TO_SELL offers (read-only)" },
    { m: "top10", label: "Top 10", desc: "Top 10 by confidence (read-only)" },
    { m: "fixtures", label: "Demo Fixtures", desc: "5 golden + 20 failure fixtures (offline)" },
    { m: "regression", label: "Regression Suite", desc: "Pre-deploy gate — every fixture must pass" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Breakbot QA</h1>
        <p className="mt-1 text-[13px] text-chalk-400">
          Adversarial pre-flight over the assembled customer journey. Read-only QA gate — it never approves, sends, or charges.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {RUNS.map((r) => (
          <button
            key={r.m}
            onClick={() => run(r.m)}
            disabled={loading}
            className={`card p-3 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50 ${mode === r.m ? "ring-1 ring-azure-400/40" : ""}`}
          >
            <div className="text-[13px] font-semibold text-chalk-100">{r.label}</div>
            <div className="mt-0.5 text-[11.5px] text-chalk-500">{r.desc}</div>
          </button>
        ))}
      </div>

      {loading && <div className="card p-4 text-[13px] text-chalk-400">Running Breakbot…</div>}
      {err && <div className="card p-4 text-[13px] text-coral-300">{err}</div>}

      {/* ── Real read-only batch ── */}
      {batch && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Scanned</div><div className="text-lg font-semibold text-chalk-50">{batch.scanned}</div></div>
            <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Asset READY</div><div className="text-lg font-semibold text-teal-300">{batch.assetReadyCount}</div></div>
            <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Asset BLOCKED</div><div className="text-lg font-semibold text-rose-300">{batch.assetBlockedCount}</div></div>
            <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Sales-qualified</div><div className="text-lg font-semibold text-chalk-50">{batch.salesQualifiedCount}</div></div>
          </div>

          {/* The distinction the operator must NOT conflate. */}
          <div className="card p-3 text-[12.5px] text-chalk-300">
            <span className="text-chalk-100">{batch.salesQualifiedButAssetBlocked}</span> offer(s) are
            {" "}<span className="text-teal-300">SALES-QUALIFIED</span> but
            {" "}<span className="text-rose-300">ASSET-BLOCKED</span>. That is a build/QA task — the asset is unbuilt or stale — not a disqualification. Sales qualification is never downgraded by an ungenerated asset.
          </div>

          {batch.commonBlockers.length > 0 && (
            <div className="card p-4">
              <div className="text-[11px] uppercase tracking-wide text-chalk-500">Most-common blockers</div>
              <ul className="mt-2 space-y-1 text-[12.5px]">
                {batch.commonBlockers.map((b) => (
                  <li key={b.surface} className="flex justify-between"><span className="text-chalk-300">{b.surface}</span><span className="text-rose-300">{b.count}×</span></li>
                ))}
              </ul>
            </div>
          )}

          <ul className="space-y-2">
            {batch.rows.map((r) => (
              <li key={r.offerId} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/revenue/opportunity/${r.offerId}?tab=breakbot`} className="truncate text-[14px] font-semibold text-chalk-100 hover:text-azure-200">{r.company}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                      <span className={r.assetReady ? "text-teal-300" : "text-rose-300"}>{r.assetReady ? "ASSET READY" : "ASSET BLOCKED"}</span>
                      <span className="text-chalk-600">·</span>
                      <span className={r.salesQualified === null ? "text-chalk-500" : r.salesQualified ? "text-teal-300" : "text-chalk-500"}>
                        {r.salesQualified === null ? "sales: unknown" : r.salesQualified ? "SALES-QUALIFIED" : "not sales-qualified"}
                      </span>
                    </div>
                    {r.blockerSurfaces.length > 0 && (
                      <div className="mt-1 text-[11px] text-chalk-500">{r.blockerSurfaces.join(" · ")}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-bold text-chalk-50">{usd(r.priceCents)}</div>
                    <div className="text-[11px] text-chalk-500">conf {r.confidence.toFixed(2)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Demo fixtures ── */}
      {fixtures && (
        <div className="space-y-3">
          <div className={`card p-3 text-[13px] font-semibold ${fixtures.allPass ? "text-teal-300" : "text-rose-300"}`}>
            {fixtures.allPass ? "✓ All fixtures behaved as expected" : "✕ Some fixtures did not behave as expected"}
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Golden (expect READY)</div>
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {fixtures.golden.map((g) => (
                <li key={g.id} className="flex justify-between"><span className="text-chalk-300">{g.label}</span><span className={g.pass ? "text-teal-300" : "text-rose-300"}>{g.pass ? "✓" : "✕"} {g.overall}</span></li>
              ))}
            </ul>
          </div>
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">Failure (expect BLOCKED on surface)</div>
            <ul className="mt-2 space-y-1 text-[12px]">
              {fixtures.failure.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-chalk-300">{f.label} <span className="text-chalk-600">→ {f.expectBlockerSurface}</span></span>
                  <span className={f.pass ? "text-teal-300" : "text-rose-300"}>{f.pass ? "✓" : "✕"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Regression gate ── */}
      {regression && (
        <div className="space-y-3">
          <div className={`card p-4 text-[13px] font-semibold ${regression.allPass ? "text-teal-300" : "text-rose-300"}`}>
            {regression.allPass ? "✓ RELEASE GATE PASS" : "✕ RELEASE GATE FAIL"}
            <div className="mt-1 text-[12px] font-normal text-chalk-400">
              Golden {regression.goldenPassed}/{regression.goldenTotal} READY · Failure {regression.failurePassed}/{regression.failureTotal} blocked-on-surface
            </div>
          </div>
          {regression.regressions.length > 0 && (
            <div className="card p-4">
              <div className="text-[11px] uppercase tracking-wide text-rose-300">Critical regressions</div>
              <ul className="mt-2 space-y-1 text-[12px]">
                {regression.regressions.map((r) => (
                  <li key={`${r.kind}-${r.id}`} className="text-chalk-300"><span className="text-chalk-500">[{r.kind}] {r.id}:</span> {r.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
