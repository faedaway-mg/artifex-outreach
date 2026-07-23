// ─────────────────────────────────────────────────────────────────────────────
// Portfolio — the founder's executive read across every engaged business.
//
// One calm row per business: stage, relationship health, implementation progress,
// reviews waiting, top opportunity, momentum — and quiet flags for a recent win or a
// business at risk. Plus the consulting patterns we've learned across engagements.
// An operating system, not a CRM. Composed from the same deterministic engines.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { TrendingUp, AlertTriangle, Network, ArrowRight } from "lucide-react";
import type { PortfolioRow } from "@/lib/engagement";
import type { KnowledgePattern } from "@/lib/outcomes";

export function PortfolioView({ rows, patterns }: { rows: PortfolioRow[]; patterns: KnowledgePattern[] }) {
  const atRisk = rows.filter((r) => r.atRisk);
  const wins = rows.filter((r) => r.recentWin);
  const needsReview = rows.filter((r) => r.awaitingReviews > 0);

  return (
    <div className="space-y-6">
      {/* ── Summary strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="card p-3"><p className="text-[11px] text-chalk-500">Engaged businesses</p><p className="mt-1 text-[18px] font-semibold text-chalk-100">{rows.length}</p></div>
        <div className="card p-3"><p className="text-[11px] text-chalk-500">Recent wins</p><p className="mt-1 text-[18px] font-semibold text-emerald-300">{wins.length}</p></div>
        <div className="card p-3"><p className="text-[11px] text-chalk-500">Awaiting review</p><p className={`mt-1 text-[18px] font-semibold ${needsReview.length ? "text-amber-300" : "text-chalk-100"}`}>{needsReview.length}</p></div>
        <div className="card p-3"><p className="text-[11px] text-chalk-500">At risk</p><p className={`mt-1 text-[18px] font-semibold ${atRisk.length ? "text-coral-300" : "text-chalk-100"}`}>{atRisk.length}</p></div>
      </div>

      {/* ── Businesses ───────────────────────────────────────────────────────── */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-chalk-100">Businesses</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-[13px] text-chalk-500">No engaged businesses yet. As you capture memory and move work forward, they appear here.</p>
        ) : (
          <div className="mt-3 divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <Link key={r.leadId} href={`/leads/${r.leadId}/command`} className="flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13.5px] font-medium text-chalk-100">{r.businessName}</p>
                    {r.recentWin && <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/30 px-1.5 py-0.5 text-[9.5px] text-emerald-300"><TrendingUp size={9} /> win</span>}
                    {r.atRisk && <span className="inline-flex items-center gap-0.5 rounded-full border border-coral-400/30 px-1.5 py-0.5 text-[9.5px] text-coral-300"><AlertTriangle size={9} /> at risk</span>}
                  </div>
                  <p className="truncate text-[11.5px] text-chalk-600">{r.stage} · {r.topOpportunity ?? "no opportunity sequenced"}</p>
                </div>
                <div className="hidden shrink-0 gap-4 text-[11px] text-chalk-500 sm:flex">
                  <span title="relationship health">♥ {r.healthReached}/{r.healthTotal}</span>
                  <span title="implemented / recommendations">▶ {r.implementedCount}/{r.recommendationCount}</span>
                  <span title="awaiting review" className={r.awaitingReviews ? "text-amber-300" : ""}>◷ {r.awaitingReviews}</span>
                  <span className="w-12" title="momentum">{r.momentum}</span>
                </div>
                <ArrowRight size={14} className="shrink-0 text-chalk-600" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Consulting patterns learned across engagements ───────────────────── */}
      {patterns.length > 0 && (
        <section className="card p-5">
          <div className="flex items-center gap-2"><Network size={16} className="text-teal-300" /><h2 className="text-sm font-semibold text-chalk-100">Patterns we're learning</h2></div>
          <p className="mt-1 text-[12px] text-chalk-500">Recorded only after repeated evidence — each cites the engagements behind it.</p>
          <div className="mt-3 space-y-2">
            {patterns.map((p) => (
              <div key={p.recommendationId} className="rounded-lg border border-teal-400/15 bg-teal-500/[0.03] p-3">
                <p className="text-[13px] font-medium text-chalk-100">{p.title}</p>
                <p className="mt-0.5 text-[12.5px] text-chalk-300">{p.summary}</p>
                <p className="mt-1 text-[11px] text-chalk-600">{p.supportedCount} engagements · {p.supportingLeadIds.join(", ")}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
