import Link from "next/link";
import { catalogView } from "@/lib/quick-fix/operator-views";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const { rows, priceVersions, automationDefault, autoAllowlist } = catalogView();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Fix Catalog</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Canonical SKUs. Prices are versioned & deterministic — the LLM never sets a price. Automation default {automationDefault}; AUTO_ELIGIBLE allow-list {autoAllowlist.length === 0 ? "empty" : autoAllowlist.join(", ")}.</p>
      </div>

      <div className="card p-4 text-[12px]">
        <div className="text-[11px] uppercase text-chalk-500">Active price versions</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {priceVersions.filter((v) => v.active).map((v) => <span key={v.id} className="rounded-full bg-white/5 px-2.5 py-1 text-chalk-200">{v.band} ${Math.round(v.priceCents / 100)} <span className="text-chalk-500">{v.id}</span></span>)}
          {priceVersions.filter((v) => !v.active).map((v) => <span key={v.id} className="rounded-full bg-white/5 px-2.5 py-1 text-chalk-500 line-through">{v.band} ${Math.round(v.priceCents / 100)} (retired)</span>)}
        </div>
      </div>

      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-chalk-100">{r.name} {r.key === "artifex-fix-scan" && <span className="ml-1 rounded bg-azure-500/15 px-1.5 py-0.5 text-[10px] text-azure-200">DIAGNOSTIC</span>}</div>
                <div className="mt-0.5 text-[12px] text-chalk-500">{r.family} · {r.priceHint} · SLA {r.slaLabel} · {r.priceVersion}</div>
              </div>
              <div className="shrink-0 text-right text-[11px]">
                <div className={r.state === "PROVEN" ? "text-teal-300" : "text-chalk-300"}>{r.state}</div>
                <div className="text-chalk-500">{r.estLaborMinutes ? `~${r.estLaborMinutes}m` : ""}</div>
              </div>
            </div>
            <div className="mt-2 text-[11.5px] text-chalk-500">Platforms: {r.platformCompatibility.join(", ")}</div>
            <div className="mt-1 text-[11.5px] text-chalk-500">Access: {r.requiredAccess.join("; ") || "—"}</div>
            <div className="mt-1 text-[11.5px] text-chalk-500">Automation: {r.automation} · Active: {r.active ? "yes" : "no"}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
