"use client";
// Morning Intelligence Warming — eliminates the cold start. The operator warms
// today's queue and every business is understood before outreach begins: each gets
// a Technology Snapshot, Maturity, Opportunity Graph, Discovery Questions, Evolution
// preview, and Operator Briefing. Warms sequentially with live progress.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { warmBusinessIntelligenceAction } from "@/lib/warming-actions";
import { cn } from "@/lib/utils";

type Status = "ready" | "pending" | "warming" | "error";
interface Business { id: string; name: string; warm: boolean }

export function MorningWarming({ businesses }: { businesses: Business[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Record<string, Status>>(() =>
    Object.fromEntries(businesses.map((b) => [b.id, b.warm ? "ready" : "pending"])),
  );
  const [confidence, setConfidence] = useState<Record<string, number>>({});

  const total = businesses.length;
  const ready = useMemo(() => businesses.filter((b) => status[b.id] === "ready").length, [businesses, status]);
  const remaining = businesses.filter((b) => status[b.id] === "pending" || status[b.id] === "error");
  const allReady = ready === total;

  const warmAll = () => startTransition(async () => {
    for (const b of remaining) {
      setStatus((s) => ({ ...s, [b.id]: "warming" }));
      const r = await warmBusinessIntelligenceAction(b.id);
      setStatus((s) => ({ ...s, [b.id]: r.ok ? "ready" : "error" }));
      if (r.ok && r.evidenceConfidence != null) setConfidence((c) => ({ ...c, [b.id]: r.evidenceConfidence! }));
    }
    router.refresh();
  });

  if (total === 0) return null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Brain size={15} className="text-azure-300" /> Morning intelligence</h2>
          <p className="mt-0.5 text-xs text-chalk-500">
            {allReady
              ? `All ${total} businesses in today's queue are understood and ready.`
              : `${ready} of ${total} ready — warm the rest so every business is understood before outreach.`}
          </p>
        </div>
        {!allReady && (
          <button onClick={warmAll} disabled={pending} className="btn-secondary text-xs disabled:opacity-60">
            {pending ? <><Loader2 size={14} className="animate-spin" /> Warming…</> : <><Sparkles size={14} /> Warm today's queue</>}
          </button>
        )}
        {allReady && <span className="flex items-center gap-1.5 text-xs text-teal-300"><Check size={14} /> Ready</span>}
      </div>

      {/* Overall progress */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-teal-400 transition-all duration-500" style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
      </div>

      {!allReady && (
        <p className="mt-3 text-[11px] text-chalk-600">Each business receives a Technology Snapshot, Maturity, Opportunity Graph, Discovery Questions, Evolution preview, and Operator Briefing.</p>
      )}

      {/* Per-business status */}
      <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {businesses.map((b) => {
          const st = status[b.id];
          return (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-chalk-300">
                {st === "ready" ? <Check size={13} className="shrink-0 text-teal-400" />
                  : st === "warming" ? <Loader2 size={13} className="shrink-0 animate-spin text-azure-300" />
                  : st === "error" ? <AlertCircle size={13} className="shrink-0 text-coral-300" />
                  : <span className="h-2 w-2 shrink-0 rounded-full bg-chalk-600" />}
                <span className="truncate">{b.name}</span>
              </span>
              <span className={cn("shrink-0 text-[11px]", st === "ready" ? "text-teal-300" : st === "error" ? "text-coral-300" : "text-chalk-600")}>
                {st === "ready" ? (confidence[b.id] != null ? `${confidence[b.id]}%` : "ready") : st === "warming" ? "warming…" : st === "error" ? "retry" : "not yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
