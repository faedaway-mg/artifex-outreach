import Link from "next/link";
import { quickCashOpportunitiesView } from "@/lib/quick-fix/operator-views";
import { PrepareOfferButton } from "@/components/quick-fix/PrepareOfferButton";

export const dynamic = "force-dynamic";
const usd = (c: number) => `$${Math.round(c / 100)}`;

// OPERATOR Quick-Cash list — the entry point to the opportunity workspace. Each ready
// row taps straight into /revenue/opportunity/<offerId> when the offer is prepared;
// unprepared rows show Prepare & approve first. Mobile-first, no send, no charge.
export default async function QuickCashPage() {
  const { rows, totals, routing } = await quickCashOpportunitiesView();
  const eligible = rows.filter((r) => r.eligible);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Quick-Cash Opportunities</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Ranked by transaction quality (Fixability), not price. Tap an opportunity to open its command center.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Eligible</div><div className="text-lg font-semibold text-chalk-50">{totals.eligibleCount}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Addressable</div><div className="text-lg font-semibold text-chalk-50">{usd(totals.eligibleTotalCents)}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Direct fix</div><div className="text-lg font-semibold text-chalk-50">{routing.DIRECT_FIX}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Fix Scan</div><div className="text-lg font-semibold text-chalk-50">{routing.FIX_SCAN}</div></div>
      </div>

      {eligible.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No confidently-sellable fixes in the current inventory.</div>
      ) : (
        <ul className="space-y-2.5">
          {eligible.map((r) => {
            const body = (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                  <div className="mt-0.5 text-[12.5px] text-chalk-400">{r.offerName} — {r.problem}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[16px] font-bold text-chalk-50">{usd(r.priceCents)}</div>
                  <div className="text-[11px] text-chalk-500">{r.band} · {r.sla || "—"}</div>
                </div>
              </div>
            );
            return (
              <li key={r.leadId} className="card p-4">
                {r.offerId ? (
                  <Link href={`/revenue/opportunity/${r.offerId}`} className="block transition-colors hover:opacity-90">{body}</Link>
                ) : body}
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-chalk-500">
                  <span>Fixability <span className="text-chalk-300">{r.score}</span></span>
                  <span>~{r.estimatedHours}h · {usd(r.effectiveHourlyCents)}/hr</span>
                  <span>evidence conf <span className="text-chalk-300">{r.confidence.toFixed(2)}</span></span>
                  <span className={r.readyToSell ? "text-teal-300" : "text-amber-300"}>{r.readyToSell ? "READY TO SELL" : r.fixabilityState}</span>
                </div>
                <div className="mt-3">
                  {r.offerId ? (
                    <Link href={`/revenue/opportunity/${r.offerId}`} className="inline-flex rounded-lg bg-azure-500/15 px-2.5 py-1 text-[12px] font-medium text-azure-200 hover:bg-azure-500/25">Open opportunity →</Link>
                  ) : (
                    <PrepareOfferButton leadId={r.leadId} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
