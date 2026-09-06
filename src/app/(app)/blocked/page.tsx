import Link from "next/link";
import { ArrowLeft, RotateCcw, Ban, ChevronRight } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";
import { RejectControl } from "@/components/queue/RejectControl";

export const dynamic = "force-dynamic";

// Mandate: "Automatically excluded" is NOT Jordan's workload. Reason groups are COLLAPSED by default —
// company lists appear only after the operator opens a group. Duplicate/prior-contact is a terminal
// exclusion (never "needs an input change", never auto-retried).
export default async function ExcludedPage() {
  const snap = await buildCompanySnapshot();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-[13px] text-chalk-400"><Link href="/" className="hover:underline"><ArrowLeft size={14} className="inline" /> Today</Link></div>
      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-chalk-50"><Ban size={20} className="text-chalk-400" /> Automatically excluded · {snap.counts.blocked}</h1>
      <p className="mt-1 text-[13px] text-chalk-400">These companies are not your workload — automation excluded them and retries what it safely can.</p>

      <div className="mt-5 space-y-2">
        {snap.blocked.map((b) => {
          const terminalDuplicate = b.reason === "duplicate";
          return (
            <details key={b.reason} className="group rounded-xl border border-white/10 bg-white/[0.02]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-chalk-100"><ChevronRight size={14} className="text-chalk-500 transition-transform group-open:rotate-90" /> {b.label}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[12px] tabular-nums text-chalk-300">{b.count}</span>
              </summary>
              <ul className="divide-y divide-white/5 border-t border-white/10">
                {b.companies.map((c) => (
                  <li key={c.leadId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
                    <span className="truncate text-[13px] text-chalk-200">{c.business}</span>
                    <div className="flex items-center gap-3">
                      {terminalDuplicate ? (
                        <span className="shrink-0 text-[11.5px] text-chalk-500">prior contact — not retried</span>
                      ) : c.willRetry ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-teal-300"><RotateCcw size={12} /> automation will retry</span>
                      ) : (
                        <span className="shrink-0 text-[11.5px] text-chalk-500">needs an input change</span>
                      )}
                      {/* Deliberately remove a poor-fit / insufficient-evidence company from the pipeline. */}
                      <RejectControl leadId={c.leadId} contacted={terminalDuplicate} size="xs" />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        {snap.blocked.length === 0 && <p className="text-[13px] text-chalk-500">Nothing is excluded.</p>}
      </div>
    </div>
  );
}
