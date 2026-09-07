import Link from "next/link";
import { buildTargetingBoard } from "@/lib/targeting/board";

export const dynamic = "force-dynamic";

const BAND_TONE: Record<string, string> = {
  PRIORITY_A: "border-teal-400/30 bg-teal-400/[0.06] text-teal-300",
  PRIORITY_B: "border-azure-400/30 bg-azure-400/[0.06] text-azure-300",
  REVIEW: "border-amber-400/30 bg-amber-400/[0.06] text-amber-300",
  DO_NOT_PREPARE: "border-white/10 text-chalk-500",
  INELIGIBLE: "border-white/10 text-chalk-600",
};

// TARGETING VIEW (mandate 27). Read-only: which smaller markets discovery is searching + why, the qualified
// backlog counts, and a scored/explained card per business. Mobile taps through to a full-page detail. Every
// count equals the list it opens.
export default async function TargetingPage() {
  const board = await buildTargetingBoard({ limit: 80 });
  const c = board.counts;
  const eligible = board.cards.filter((x) => x.promotionState === "PRIORITY_A" || x.promotionState === "PRIORITY_B");

  return (
    <div className="space-y-6" data-targeting-board>
      <div>
        <p className="label">Targeting</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Reputation-rich, digitally underrepresented operators</h1>
        <p className="mt-1 text-sm text-chalk-400">Persona: REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR · model {board.version}. Read-only — nothing is approved, scheduled, or sent here.</p>
      </div>

      {/* Backlog counts — each equals its canonical list. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([["PRIORITY_A", c.priorityA], ["PRIORITY_B", c.priorityB], ["NEEDS_RECIPIENT", c.needsRecipient], ["NEEDS_EVIDENCE", c.needsEvidence], ["REVIEW", c.review], ["DO_NOT_PREPARE", c.doNotPrepare], ["INELIGIBLE", c.ineligible], ["auto-prepare", c.autoPrepareEligible]] as const).map(([k, v]) => (
          <div key={k} data-backlog-count={k} className={`min-w-0 rounded-xl border p-3 ${BAND_TONE[k] ?? "border-white/10 text-chalk-300"}`}>
            <div className="text-xl font-semibold">{v}</div>
            <div className="break-words text-[11px] opacity-80">{k.replace(/_/g, " ").toLowerCase()}</div>
          </div>
        ))}
      </div>

      {/* Next markets + why (mandate 26/27). */}
      <section data-next-markets className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-chalk-100">Next markets being searched</h2>
          <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-300">{board.excludedMajorCount} major metros excluded</span>
        </div>
        <p className="mt-1 text-[11px] text-chalk-500">{board.populationSource}</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {board.nextMarkets.map((m) => (
            <li key={`${m.city}-${m.state}`} data-next-market={`${m.city}, ${m.state}`} className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2"><span className="min-w-0 truncate text-[13px] font-medium text-chalk-100">{m.city}, {m.state}</span><span data-market-tier={m.tier} className="shrink-0 text-[10px] uppercase text-chalk-500">{m.tier} · {m.region}</span></div>
              <p data-market-reason className="mt-1 break-words text-[11px] leading-snug text-chalk-500">{m.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Qualified backlog — tap-through to a full-page "why this business". */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-chalk-200">Qualified backlog <span className="text-chalk-500">· {eligible.length}</span></h2>
        {eligible.length === 0 ? (
          <div data-targeting-empty className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[12.5px] text-chalk-500">No qualified PRIORITY A/B businesses yet — the targeting engine is still gathering evidence.</div>
        ) : (
          <ul className="space-y-2" data-targeting-list>
            {eligible.map((t) => (
              <li key={t.leadId}>
                <Link href={`/targeting/${t.leadId}`} data-target-card={t.leadId} data-target-band={t.band} className="block min-w-0 rounded-lg border border-white/10 bg-white/[0.02] p-3 ring-focus hover:border-white/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium text-chalk-100">{t.businessName}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${BAND_TONE[t.band]}`}>{t.band.replace(/_/g, " ")} · {t.total}</span>
                  </div>
                  <p className="mt-1 break-words text-[11.5px] text-chalk-500">{t.city}, {t.state} · {t.marketTier} · {t.recommendedAsset} · recipient {t.recipientRole}{t.recipientVerified ? " ✓" : ""}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
