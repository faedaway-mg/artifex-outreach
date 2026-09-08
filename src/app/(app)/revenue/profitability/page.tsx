import Link from "next/link";
import { profitabilityView } from "@/lib/quick-fix/operator-views";

export const dynamic = "force-dynamic";
const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

export default async function ProfitabilityPage() {
  const { rows, northStar } = await profitabilityView();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">SKU Profitability</h1>
        <p className="mt-1 text-[13px] text-chalk-400">North Star: gross profit per operator hour. Actuals are null until live sales + tracked time — never invented.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Revenue</div><div className="text-lg font-semibold text-chalk-50">{usd(northStar.revenueCents)}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Gross contrib.</div><div className="text-lg font-semibold text-chalk-50">{usd(northStar.grossContributionCents)}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">Operator hrs</div><div className="text-lg font-semibold text-chalk-50">{northStar.operatorHours ?? "—"}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-chalk-500">$/op-hr</div><div className="text-lg font-semibold text-chalk-50">{usd(northStar.grossContributionPerOperatorHourCents)}</div></div>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.skuKey} className="card flex items-center justify-between p-3.5">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-chalk-100">{r.skuKey}</div>
              <div className="text-[11.5px] text-chalk-500">{r.sales} sales · {usd(r.revenueCents)} · est {r.estimatedHours}h · actual {r.actualHours ?? "—"}h</div>
            </div>
            <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-chalk-300">{r.verdict}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-chalk-500">Verdicts need ≥5 sales; below that everything is REVIEW (insufficient data) — by design.</p>
    </div>
  );
}
