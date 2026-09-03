import Link from "next/link";
import { ArrowLeft, RotateCcw, Ban } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";

export const dynamic = "force-dynamic";

// Mandate III: the "Blocked N" number on Today is clickable and opens HERE — a simple reason summary,
// never 80 full lead pages. Each reason shows its count and the affected companies; each company shows
// only the reason and whether backend automation will retry it. No scoring, no pipeline controls.
export default async function BlockedPage() {
  const snap = await buildCompanySnapshot();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-[13px] text-chalk-400"><Link href="/" className="hover:underline"><ArrowLeft size={14} className="inline" /> Today</Link></div>
      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-chalk-50"><Ban size={20} className="text-chalk-400" /> Automatically excluded · {snap.counts.blocked}</h1>
      <p className="mt-1 text-[13px] text-chalk-400">These companies are not your workload — automation excluded them and retries what it safely can. The rest are genuinely stuck until their input changes.</p>

      <div className="mt-5 space-y-4">
        {snap.blocked.map((b) => (
          <section key={b.reason} className="rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-semibold text-chalk-100">{b.label}</h2>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[12px] tabular-nums text-chalk-300">{b.count}</span>
            </div>
            <ul className="divide-y divide-white/5 border-t border-white/10">
              {b.companies.map((c) => (
                <li key={c.leadId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate text-[13px] text-chalk-200">{c.business}</span>
                  {c.willRetry ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-teal-300"><RotateCcw size={12} /> Automation will retry</span>
                  ) : (
                    <span className="shrink-0 text-[11.5px] text-chalk-500">Needs an input change</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {snap.blocked.length === 0 && <p className="text-[13px] text-chalk-500">Nothing is blocked.</p>}
      </div>
    </div>
  );
}
