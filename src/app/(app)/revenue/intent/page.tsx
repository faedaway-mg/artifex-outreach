import Link from "next/link";
import { highIntentView } from "@/lib/quick-fix/operator-views";

export const dynamic = "force-dynamic";
const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

export default async function HighIntentPage() {
  const rows = await highIntentView();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">High Purchase Intent</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Scored only from measurable funnel events. No real events yet → empty is correct (never fabricated).</p>
      </div>
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No prospect has recorded buying-intent events yet.</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.offerId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                  <div className="mt-0.5 text-[12px] text-chalk-500">{r.sku ?? "—"} · {usd(r.priceCents)} · {r.checkoutState}</div>
                </div>
                <div className="shrink-0 text-right"><div className="text-[18px] font-bold text-azure-200">{r.intentScore}</div><div className="text-[10.5px] text-chalk-500">intent</div></div>
              </div>
              <div className="mt-2 text-[11.5px] text-chalk-500">Strongest: {r.strongestSignal ?? "—"} · last {r.lastActionAt ? new Date(r.lastActionAt).toLocaleString() : "—"}</div>
              <div className="mt-1.5 text-[12.5px] text-chalk-300">Next: {r.recommendedNextStep}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
