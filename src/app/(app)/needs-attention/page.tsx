import Link from "next/link";
import { ArrowLeft, AlertTriangle, RotateCcw, Video } from "lucide-react";
import { buildCompanySnapshot } from "@/lib/outreach/company-snapshot";

export const dynamic = "force-dynamic";

// Mandate 3: genuine automation failures are never hidden. Terminal / exhausted-retry follow-up failures
// and render/package failures surface HERE with company, failed action, plain reason, and whether an
// operator retry is available. No scoring, no pipeline controls.
export default async function NeedsAttentionPage() {
  const snap = await buildCompanySnapshot();
  const rows = snap.needsAttention;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-2 text-[13px] text-chalk-400"><Link href="/" className="hover:underline"><ArrowLeft size={14} className="inline" /> Today</Link></div>
      <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-chalk-50"><AlertTriangle size={20} className="text-coral-300" /> Needs attention · {rows.length}</h1>
      <p className="mt-1 text-[13px] text-chalk-400">Only genuine failures automation can’t resolve on its own.</p>

      {rows.length === 0 ? (
        <p className="mt-5 text-[13px] text-chalk-500">Nothing needs you right now.</p>
      ) : (
        <ul className="mt-5 divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
          {rows.map((r) => (
            <li key={r.leadId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[14px] text-chalk-100">{r.business}</div>
                <div className="truncate text-[12px] text-chalk-500">
                  {r.failedAction ?? "Video render"} failed{r.failReason ? ` · ${r.failReason}` : ""}
                  {r.retryAvailable === false ? " · automation won’t retry" : r.retryAvailable ? " · retry available" : ""}
                </div>
              </div>
              {r.failedAction ? (
                <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-chalk-500"><RotateCcw size={12} /> {r.retryAvailable ? "retryable" : "terminal"}</span>
              ) : (
                <Link href={`/company/${r.leadId}`} className="btn-secondary shrink-0 text-xs"><Video size={13} /> Open</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
