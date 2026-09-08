import Link from "next/link";
import { revenueSummary } from "@/lib/quick-fix/operator-views";
import { legalGateBlocked } from "@/lib/quick-fix/purchase-safety";
import { LEGAL_REVIEW_REQUIRED } from "@/lib/quick-fix/terms";

export const dynamic = "force-dynamic";

const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const LINKS = [
  { href: "/revenue/quick-cash", title: "Quick-Cash Opportunities", desc: "What can we confidently sell right now?" },
  { href: "/revenue/intent", title: "High Purchase Intent", desc: "Prospects showing real buying behavior" },
  { href: "/revenue/fulfillment", title: "Ready for Fulfillment", desc: "Paid work waiting to be delivered" },
  { href: "/revenue/catalog", title: "Fix Catalog", desc: "SKUs, prices, SLAs, versions, automation" },
  { href: "/revenue/profitability", title: "SKU Profitability", desc: "Gross profit per operator hour" },
  { href: "/revenue/customers", title: "Customers / CLV", desc: "Converted customers & lifetime value" },
  { href: "/revenue/trust-asset", title: "Evergreen Trust Video", desc: "Manage the shared Quick-Fix explainer" },
  { href: "/revenue/preview", title: "Preview as Customer", desc: "Walk the full funnel — no send, no charge" },
];

export default async function RevenueHub() {
  const s = await revenueSummary();
  const legal = legalGateBlocked({ ...process.env, NODE_ENV: "production" } as NodeJS.ProcessEnv); // show the prod-gate status honestly
  const jobsTotal = Object.values(s.jobsByState).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="label">Acquisition OS</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Quick-Fix Revenue</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Low-ticket transaction engine. Automation default <span className="text-chalk-200">{s.automationDefault}</span> · AUTO_ELIGIBLE allow-list <span className="text-chalk-200">{s.autoAllowlistEmpty ? "empty" : "populated"}</span>.</p>
      </div>

      {/* North Star + posture */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4"><div className="text-[11px] uppercase text-chalk-500">Paid jobs</div><div className="mt-1 text-xl font-semibold text-chalk-50">{jobsTotal}</div></div>
        <div className="card p-4"><div className="text-[11px] uppercase text-chalk-500">Customers</div><div className="mt-1 text-xl font-semibold text-chalk-50">{s.customers}</div></div>
        <div className="card p-4"><div className="text-[11px] uppercase text-chalk-500">Gross contribution</div><div className="mt-1 text-xl font-semibold text-chalk-50">{usd(s.northStar.grossContributionCents)}</div></div>
        <div className="card p-4"><div className="text-[11px] uppercase text-chalk-500">$/operator-hr</div><div className="mt-1 text-xl font-semibold text-chalk-50">{s.northStar.grossContributionPerOperatorHourCents == null ? "—" : usd(s.northStar.grossContributionPerOperatorHourCents)}</div></div>
      </div>

      {/* Activation posture — honest gates */}
      <div className="card space-y-1.5 p-4 text-[12.5px]">
        <div className="flex items-center justify-between"><span className="text-chalk-400">Stripe secret key</span><span className={s.stripeConfigured ? "text-teal-300" : "text-amber-300"}>{s.stripeConfigured ? "configured" : "NOT configured (checkout inert)"}</span></div>
        <div className="flex items-center justify-between"><span className="text-chalk-400">Legal review of terms</span><span className="text-amber-300">{LEGAL_REVIEW_REQUIRED ? "REQUIRED (pending)" : "complete"}</span></div>
        <div className="flex items-center justify-between"><span className="text-chalk-400">Production live-purchase gate</span><span className={legal ? "text-amber-300" : "text-teal-300"}>{legal ? "BLOCKED until legal sign-off" : "open"}</span></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="card p-4 transition-colors hover:bg-white/[0.05]">
            <div className="text-[15px] font-semibold text-chalk-100">{l.title}</div>
            <div className="mt-0.5 text-[12.5px] text-chalk-400">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
