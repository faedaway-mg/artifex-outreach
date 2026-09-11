import Link from "next/link";
import {
  seedDemoScenarios, listDemoJobs, buildDemoWalkthroughs, DEMO_SCENARIOS,
  type DemoScenarioKey,
} from "@/lib/quick-fix/demo-fulfillment";
import { DemoWalkthrough } from "@/components/fulfillment/DemoWalkthrough";

export const dynamic = "force-dynamic";

const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

const STATE_LABEL: Record<string, string> = {
  READY_FOR_FULFILLMENT: "Ready", IN_PROGRESS: "In progress", QA: "QA", WAITING_FOR_CUSTOMER_INPUT: "Waiting on customer",
  PAID: "Paid", DELIVERED: "Delivered", COMPLETE: "Complete", REFUNDED: "Refunded", CANCELED: "Canceled",
};

// DEMO FULFILLMENT — an isolated rehearsal inbox PLUS three explicit, USABLE guided
// walkthroughs (§46–§48): DEMO A (simple Quick-Fix completion), DEMO B (waiting for
// customer access), DEMO C (scope complication / Additional Decision Needed). Seeding is
// idempotent — opening this page (or hitting ?reset=1) ensures the demo scenarios exist
// and re-seeds them to their initial sub-state — then resolves each walkthrough's deep
// links into the SAME technician workspace + customer portal real jobs use. Every job
// here is `isDemo:true` under the reserved non-deliverable test domain, so it is
// HARD-excluded from every real revenue / fulfillment / customer / sprint number.
export default async function DemoFulfillmentPage() {
  const seeded = await seedDemoScenarios(); // idempotent — reuses/re-seeds demo records (also serves ?reset=1)
  const rows = await listDemoJobs();

  // Resolve each walkthrough's deep links to the freshly-seeded offerIds.
  const offerIdByScenario: Partial<Record<DemoScenarioKey, string>> = {};
  for (const s of seeded) offerIdByScenario[s.key] = s.offerId;
  const walkthroughs = buildDemoWalkthroughs(offerIdByScenario);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue/fulfillment" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Ready for Fulfillment</Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-chalk-50">Demo Fulfillment</h1>
          <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200">Demo · isolated</span>
        </div>
        <p className="mt-1 text-[13px] text-chalk-400">
          Rehearse the whole post-purchase workflow before Customer #1. These jobs are isolated
          (<code className="text-chalk-300">isDemo</code>, reserved test domain) and never send email, charge Stripe, mutate a
          real site, store a credential, or enter any real metric. They open in the same technician workspace real jobs use.
        </p>
      </div>

      {/* The three explicit, USABLE guided walkthroughs (DEMO A / B / C). */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-chalk-400">Guided walkthroughs</h2>
          <Link href="/revenue/fulfillment/demo?reset=1" className="text-[11.5px] text-chalk-500 hover:text-chalk-300">Reset all demos</Link>
        </div>
        <div className="space-y-3">
          {walkthroughs.map((w) => (
            <DemoWalkthrough key={w.scenarioKey} walkthrough={w} />
          ))}
        </div>
      </div>

      {/* The raw isolated rehearsal inbox — every demo job, straight into the workspace. */}
      <div>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-chalk-400">All rehearsal jobs</h2>
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.offerId}>
              <Link href={`/revenue/fulfillment/${r.offerId}`} className="block card p-4 transition-colors hover:bg-white/[0.05]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-chalk-100">{r.company}</div>
                    <div className="mt-0.5 text-[12px] text-chalk-500">{r.scenario?.title ?? r.sku ?? "—"} · {usd(r.priceCents)}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11.5px] text-amber-200">{STATE_LABEL[r.state] ?? r.state}</span>
                </div>
                {r.scenario ? <p className="mt-2 text-[12px] leading-relaxed text-chalk-500">{r.scenario.summary}</p> : null}
                <div className="mt-2 text-[11.5px] text-azure-300">Open workspace →</div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-4 text-[12px] text-chalk-500">
        <div className="font-semibold text-chalk-300">The four rehearsal scenarios</div>
        <ul className="mt-2 space-y-1.5">
          {DEMO_SCENARIOS.map((s) => (
            <li key={s.key}><span className="text-chalk-300">{s.title}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
