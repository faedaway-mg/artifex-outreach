import Link from "next/link";
import { quickCashPipelineView } from "@/lib/quick-fix/operator-views";
import { QUICK_CASH_STATE_TITLE, type QuickCashState, type Tone } from "@/lib/quick-fix/quick-cash-lifecycle";

export const dynamic = "force-dynamic";
const usd = (c: number) => `$${Math.round(c / 100)}`;

// OPERATOR Quick-Cash — an autonomous OPERATING QUEUE (mandate E). The page answers
// "what is the machine doing?" (Preparing → Ready → Queued → Scheduled → Sent), NOT
// "what must I approve?". Eligible packages are auto-reconciled to READY; while cold
// delivery is OFF they read "Waiting for outbound activation" — never a fake Scheduled,
// never a routine Prepare & approve button. Mobile-first, no send, no charge.
const TONE_CLASS: Record<Tone, string> = {
  muted: "text-chalk-400",
  ready: "text-teal-300",
  active: "text-azure-300",
  sent: "text-emerald-300",
  won: "text-emerald-300",
  hold: "text-amber-300",
};
const TONE_DOT: Record<Tone, string> = {
  muted: "bg-chalk-500", ready: "bg-teal-400", active: "bg-azure-400", sent: "bg-emerald-400", won: "bg-emerald-400", hold: "bg-amber-400",
};

// The order the summary + groups render in (skip empty buckets except the headline ones).
const SUMMARY_STATES: QuickCashState[] = ["PREPARING", "READY", "QUEUED", "SCHEDULED", "SENT"];

export default async function QuickCashPage() {
  const { rows, counts, order, totals, outbound } = await quickCashPipelineView();

  return (
    <div data-testid="quick-cash-page" className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Quick Cash</h1>
        <p className="mt-1 text-[13px] text-chalk-400">The autonomous pipeline — packages prepare, validate, and queue themselves. Nothing here is waiting on you to approve.</p>
      </div>

      {/* Top summary — what is being prepared / ready / queued / scheduled / sent. */}
      <div data-testid="quick-cash-summary" className="grid grid-cols-3 gap-2 sm:grid-cols-5 text-center">
        {SUMMARY_STATES.map((s) => (
          <div key={s} className="card p-3">
            <div className="text-[11px] uppercase tracking-wide text-chalk-500">{QUICK_CASH_STATE_TITLE[s]}</div>
            <div className="text-lg font-semibold text-chalk-50">{counts[s]}</div>
          </div>
        ))}
      </div>

      {/* Outbound posture — makes it obvious why Scheduled/Sent may be zero (not operator inaction). */}
      <div data-testid="quick-cash-outbound" className="card flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-[12px]">
        <span className="text-chalk-500">Outbound</span>
        <span className={outbound.deliveryOn ? "font-medium text-emerald-300" : "font-medium text-amber-300"}>
          {outbound.deliveryOn ? "ACTIVE" : outbound.posture === "WARMING" ? "WARMING" : "PAUSED"}
        </span>
        {!outbound.deliveryOn && <span className="text-chalk-500">— cold delivery is OFF, so Ready packages wait for outbound activation.</span>}
        {outbound.lanes.map((l) => (
          <span key={l.laneId} className="text-chalk-500">{l.laneId} <span className="text-chalk-300">{l.state}</span></span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No confidently-sellable fixes in the current inventory.</div>
      ) : (
        <div className="space-y-6">
          {order.map((groupState) => {
            const groupRows = rows.filter((r) => r.lifecycle.state === groupState);
            if (groupRows.length === 0) return null;
            return (
              <section key={groupState} data-testid={`qc-group-${groupState}`}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-500">{QUICK_CASH_STATE_TITLE[groupState]} · {groupRows.length}</p>
                <ul className="space-y-2.5">
                  {groupRows.map((r) => {
                    const lc = r.lifecycle;
                    return (
                      <li key={r.leadId} data-testid={`qc-card-${r.leadId}`} data-state={lc.state} className="card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                            <div className="mt-0.5 text-[12.5px] text-chalk-400">{r.offerName} — {r.problem}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[16px] font-bold text-chalk-50">{usd(r.priceCents)}</div>
                            <div className="text-[11px] text-chalk-500">{r.band}</div>
                          </div>
                        </div>

                        {/* Canonical state — what the SYSTEM is doing (not an approval prompt). */}
                        <div className="mt-3 flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${TONE_DOT[lc.tone]}`} />
                          <span data-testid={`qc-state-${r.leadId}`} className={`text-[12px] font-semibold uppercase tracking-wide ${TONE_CLASS[lc.tone]}`}>{lc.label}</span>
                        </div>
                        <p className="mt-1 text-[12px] text-chalk-400">{lc.detail}</p>

                        {/* Inspection only — never tied to readiness. No routine Prepare & approve. */}
                        {r.offerId && (
                          <div className="mt-3">
                            <Link data-testid="qc-view-package" href={`/revenue/opportunity/${r.offerId}`} className="inline-flex rounded-lg bg-azure-500/15 px-2.5 py-1 text-[12px] font-medium text-azure-200 hover:bg-azure-500/25">View package →</Link>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
