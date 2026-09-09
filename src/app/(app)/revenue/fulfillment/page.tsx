import Link from "next/link";
import { fulfillmentView } from "@/lib/quick-fix/operator-views";

export const dynamic = "force-dynamic";
const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

const STATE_LABEL: Record<string, string> = {
  READY_FOR_FULFILLMENT: "Ready", IN_PROGRESS: "In progress", QA: "QA", WAITING_FOR_CUSTOMER_INPUT: "Waiting on customer",
  PAID: "Paid", DELIVERED: "Delivered", COMPLETE: "Complete", REFUNDED: "Refunded", CANCELED: "Canceled",
};

export default async function FulfillmentPage() {
  const { rows, byState } = await fulfillmentView();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Ready for Fulfillment</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Work that has already been paid for. A redirect never marks a job paid — only the verified webhook.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        {Object.entries(byState).map(([s, n]) => <span key={s} className="rounded-full bg-white/5 px-2.5 py-1 text-chalk-300">{STATE_LABEL[s] ?? s}: {n}</span>)}
      </div>
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No paid jobs yet. This inbox fills the moment a verified payment lands.</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.offerId}>
              <Link href={`/revenue/fulfillment/${r.offerId}`} className="block card p-4 transition-colors hover:bg-white/[0.05]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                    <div className="mt-0.5 text-[12px] text-chalk-500">{r.sku ?? "—"} · {usd(r.priceCents)}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-teal-400/10 px-2.5 py-1 text-[11.5px] text-teal-200">{STATE_LABEL[r.state] ?? r.state}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-chalk-500">
                  <span>blocking reqs {r.blocking}</span>
                  <span>QA items {r.qaItems}</span>
                  <span>reqs received {r.requirementsReceivedAt ? new Date(r.requirementsReceivedAt).toLocaleDateString() : "—"}</span>
                  <span>target {r.targetDeliveryAt ? new Date(r.targetDeliveryAt).toLocaleString() : "clock not started"}</span>
                  <span className="text-azure-300">Open workspace →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
