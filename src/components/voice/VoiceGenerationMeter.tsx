"use client";
import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, Info, RefreshCw } from "lucide-react";

// The safe capacity shape returned by GET /api/voice/usage (mirrors VoiceUsage). Every field is
// browser-safe — no provider ids or keys are ever part of this payload.
interface VoiceUsage {
  minutesThisPeriod: number;
  minutesToday: number;
  minutesThisWeek: number;
  voiceoversThisPeriod: number;
  averageSeconds: number;
  monthlyMinuteBudget: number | null;
  percentUsed: number | null;
  minutesRemaining: number | null;
  estimatedVideosRemainingAtAverage: number | null;
  estimatedVideosRemainingAt30s: number | null;
  billingResetDate: string | null;
  warningLevel: 0 | 75 | 90 | 100;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-chalk-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-chalk-100">{value}</p>
      {sub && <p className="text-[10.5px] text-chalk-500">{sub}</p>}
    </div>
  );
}

// Voice Generation capacity meter. READ-ONLY view of GET /api/voice/usage. When no budget is configured
// it shows minutes generated but NEVER fabricates a remaining quota. The informational banner at 75/90/100
// warns but never blocks — generation is gated server-side, not here.
export function VoiceGenerationMeter({ className }: { className?: string }) {
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/voice/usage", { cache: "no-store" });
      if (!r.ok) throw new Error(`Could not load usage (${r.status}).`);
      setUsage((await r.json()) as VoiceUsage);
    } catch (e: any) {
      setErr(e?.message || "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasBudget = usage?.monthlyMinuteBudget != null && usage.monthlyMinuteBudget > 0;
  const pct = usage?.percentUsed ?? 0;
  const barPct = Math.min(100, Math.max(0, pct));
  const barTone =
    usage?.warningLevel === 100
      ? "bg-coral-400"
      : usage?.warningLevel === 90
        ? "bg-amber-400"
        : usage?.warningLevel === 75
          ? "bg-amber-300"
          : "bg-teal-400";

  return (
    <section className={`card p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100">
          <Gauge size={15} className="text-teal-300" /> Voice generation
        </h2>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[11px] text-chalk-300 hover:bg-white/5 disabled:opacity-40"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {err && (
        <p className="rounded-lg border border-coral-400/30 bg-coral-400/[0.06] px-3 py-2 text-xs text-coral-200">{err}</p>
      )}

      {!err && loading && !usage && (
        <p className="flex items-center gap-2 text-xs text-chalk-500"><Loader2 size={13} className="animate-spin" /> Loading…</p>
      )}

      {usage && (
        <>
          {/* Progress bar — only meaningful with a configured budget. */}
          {hasBudget ? (
            <div className="mb-3">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-chalk-200">
                  {usage.minutesThisPeriod} of {usage.monthlyMinuteBudget} minutes used
                </span>
                <span className="tabular-nums text-chalk-400">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full transition-[width] ${barTone}`} style={{ width: `${barPct}%` }} />
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[11px] text-chalk-500">
                <span>{usage.minutesRemaining} minutes remaining</span>
                <span>resets {fmtDate(usage.billingResetDate)}</span>
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-sm font-semibold tabular-nums text-chalk-100">{usage.minutesThisPeriod} minutes generated this period</p>
              <p className="text-[11px] text-chalk-500">No monthly budget configured — set one to see remaining quota.</p>
            </div>
          )}

          {/* Informational banner — never blocks. */}
          {usage.warningLevel > 0 && (
            <div
              className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] ${
                usage.warningLevel === 100
                  ? "border-coral-400/30 bg-coral-400/[0.06] text-coral-200"
                  : "border-amber-400/25 bg-amber-400/[0.06] text-amber-200"
              }`}
            >
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                {usage.warningLevel === 100
                  ? "Monthly voice budget reached. Generation still works — you may exceed your allowance."
                  : `You've used ${pct}% of this period's voice budget.`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Voiceovers (period)" value={String(usage.voiceoversThisPeriod)} />
            <Stat label="Minutes today" value={String(usage.minutesToday)} />
            <Stat label="Minutes this week" value={String(usage.minutesThisWeek)} />
            <Stat label="Avg duration" value={`${usage.averageSeconds}s`} />
            <Stat
              label="Videos left (avg)"
              value={usage.estimatedVideosRemainingAtAverage == null ? "—" : String(usage.estimatedVideosRemainingAtAverage)}
              sub={usage.estimatedVideosRemainingAtAverage == null ? "needs a budget" : undefined}
            />
            <Stat
              label="Videos left (30s)"
              value={usage.estimatedVideosRemainingAt30s == null ? "—" : String(usage.estimatedVideosRemainingAt30s)}
              sub={usage.estimatedVideosRemainingAt30s == null ? "needs a budget" : undefined}
            />
          </div>
        </>
      )}
    </section>
  );
}
