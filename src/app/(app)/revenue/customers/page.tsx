import Link from "next/link";
import { customersView } from "@/lib/quick-fix/operator-views";

export const dynamic = "force-dynamic";
const usd = (c: number) => `$${Math.round(c / 100)}`;

export default async function CustomersPage() {
  const rows = await customersView();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Customers / CLV</h1>
        <p className="mt-1 text-[13px] text-chalk-400">A verified purchase turns a prospect into a customer — cold outreach stops. They are never treated as cold again.</p>
      </div>
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No converted customers yet.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.leadId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                  <div className="mt-0.5 text-[12px] text-chalk-500">First: {r.firstPurchaseType} · {new Date(r.firstPurchaseAt).toLocaleDateString()} · {r.purchases} purchase(s)</div>
                </div>
                <div className="shrink-0 text-right"><div className="text-[16px] font-bold text-chalk-50">{usd(r.lifetimeRevenueCents)}</div><div className="text-[10.5px] text-chalk-500">lifetime</div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-chalk-500">
                <span>maintenance {r.maintenancePlanKey ?? "none"}</span>
                <span>last delivered {r.lastDeliveredAt ? new Date(r.lastDeliveredAt).toLocaleDateString() : "—"}</span>
                <span>next {r.nextOpportunity ?? "—"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
