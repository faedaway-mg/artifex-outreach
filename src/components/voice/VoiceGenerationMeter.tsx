"use client";
import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, Info, RefreshCw, ShieldAlert, Ban } from "lucide-react";

// The safe capacity shapes returned by GET /api/voice/usage. Every field is browser-safe — no provider
// ids or keys are ever part of this payload. Kept in sync with VoiceUsage / VoiceUsageView / VoiceConfigSource.
interface VoiceUsage {
  minutesThisPeriod: number;
  minutesToday: number;
  minutesThisWeek: number;
  voiceoversThisPeriod: number;
  averageSeconds: number;
  measuredThisPeriod: number;
  estimatedThisPeriod: number;
  monthlyMinuteBudget: number | null;
  percentUsed: number | null;
  minutesRemaining: number | null;
  estimatedVideosRemainingAtAverage: number | null;
  estimatedVideosRemainingAt30s: number | null;
  billingResetDate: string | null;
  warningLevel: 0 | 75 | 90 | 100;
  hardCapMinutes: number | null;
  hardCapReached: boolean;
  quotaUnknown: boolean;
}

type ConfigSourceValue = "operator" | "env" | "unset";
interface ConfigSourceView {
  source: ConfigSourceValue;
  label: string;
}

interface VoiceUsageView {
  minutesThisPeriod: string;
  monthlyAllowance: string;
  allowanceConfigured: boolean;
  percentUsed: string;
  percentUsedValue: number | null;
  minutesRemaining: string;
  minutesToday: string;
  minutesThisWeek: string;
  voiceoversThisPeriod: string;
  averageDuration: string;
  estimatedVideosRemainingAtAverage: string;
  estimatedVideosRemainingAt30s: string;
  billingResetDate: string;
  warningLevel: 0 | 75 | 90 | 100;
  warningLabel: string | null;
  hardCapConfigured: boolean;
  hardCap: string;
  hardCapReached: boolean;
  hardCapMessage: string | null;
  quotaUnknown: boolean;
  quotaUnknownMessage: string | null;
  durationsExact: boolean;
  durationAccuracyNote: string;
  source: {
    monthlyMinuteBudget: ConfigSourceView;
    billingResetDay: ConfigSourceView;
    hardCapMinutes: ConfigSourceView;
  };
}

interface UsagePayload {
  usage: VoiceUsage;
  view: VoiceUsageView;
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

// Tiny provenance chip — "operator" / "env" / "unset" — so the operator always knows where a configured
// value came from and that we never fabricated a plan.
function SourceChip({ source }: { source: ConfigSourceView }) {
  const tone =
    source.source === "operator"
      ? "border-teal-400/25 bg-teal-400/[0.08] text-teal-200"
      : source.source === "env"
        ? "border-azure-400/25 bg-azure-400/[0.06] text-azure-200"
        : "border-white/10 bg-white/[0.02] text-chalk-500";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>{source.label}</span>;
}

// Voice Generation capacity meter. READ-ONLY view of GET /api/voice/usage. When no budget is configured it
// shows minutes generated but NEVER fabricates a remaining quota. The 75/90/100 banner is informational and
// never blocks. A configured hard cap DOES block generation server-side when reached — shown distinctly.
// Refreshable so the sibling config panel can trigger an update.
export function VoiceGenerationMeter({ className, refreshSignal }: { className?: string; refreshSignal?: number }) {
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/voice/usage", { cache: "no-store" });
      if (!r.ok) throw new Error(`Could not load usage (${r.status}).`);
      setPayload((await r.json()) as UsagePayload);
    } catch (e: any) {
      setErr(e?.message || "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const usage = payload?.usage;
  const view = payload?.view;

  const barPct = Math.min(100, Math.max(0, view?.percentUsedValue ?? 0));
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

      {!err && loading && !payload && (
        <p className="flex items-center gap-2 text-xs text-chalk-500"><Loader2 size={13} className="animate-spin" /> Loading…</p>
      )}

      {usage && view && (
        <>
          {/* Progress bar — only meaningful with a configured allowance. */}
          {view.allowanceConfigured ? (
            <div className="mb-3">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-chalk-200">
                  {view.minutesThisPeriod} of {view.monthlyAllowance} used
                </span>
                <span className="tabular-nums text-chalk-400">{view.percentUsed}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full transition-[width] ${barTone}`} style={{ width: `${barPct}%` }} />
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[11px] text-chalk-500">
                <span>{view.minutesRemaining} remaining</span>
                <span>resets {view.billingResetDate}</span>
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-sm font-semibold tabular-nums text-chalk-100">{view.minutesThisPeriod} generated this period</p>
              {/* quotaUnknown honesty — never fabricate a remaining quota. */}
              <p className="text-[11px] text-chalk-500">{view.quotaUnknownMessage ?? "No monthly allowance configured."}</p>
            </div>
          )}

          {/* Hard cap — a real BLOCK when reached (distinct from the informational warnings). */}
          {view.hardCapReached && view.hardCapMessage && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-coral-400/40 bg-coral-400/[0.09] px-3 py-2 text-[11.5px] text-coral-200">
              <Ban size={13} className="mt-0.5 shrink-0" />
              <span>{view.hardCapMessage}</span>
            </div>
          )}

          {/* Informational warning banner — never blocks. */}
          {view.warningLevel > 0 && view.warningLabel && (
            <div
              className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] ${
                view.warningLevel === 100
                  ? "border-coral-400/30 bg-coral-400/[0.06] text-coral-200"
                  : "border-amber-400/25 bg-amber-400/[0.06] text-amber-200"
              }`}
            >
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>{view.warningLabel}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Minutes (period)" value={view.minutesThisPeriod} />
            <Stat label="Voiceovers (period)" value={view.voiceoversThisPeriod} />
            <Stat label="Avg duration" value={view.averageDuration} />
            <Stat label="Minutes today" value={view.minutesToday} />
            <Stat label="Minutes this week" value={view.minutesThisWeek} />
            <Stat label="Remaining" value={view.allowanceConfigured ? view.minutesRemaining : "—"} sub={view.allowanceConfigured ? undefined : "needs an allowance"} />
            <Stat
              label="Videos left (avg)"
              value={view.estimatedVideosRemainingAtAverage}
              sub={usage.estimatedVideosRemainingAtAverage == null ? "needs an allowance" : undefined}
            />
            <Stat
              label="Videos left (30s)"
              value={view.estimatedVideosRemainingAt30s}
              sub={usage.estimatedVideosRemainingAt30s == null ? "needs an allowance" : undefined}
            />
            <Stat label="Hard cap" value={view.hardCap} sub={view.hardCapConfigured ? "blocks generation" : undefined} />
          </div>

          {/* Duration accuracy disclosure — exact vs partly estimated. */}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-chalk-500">
            <Info size={12} className="mt-0.5 shrink-0" />
            {view.durationAccuracyNote}
          </p>

          {/* Provenance of each configured value — operator vs env vs unset. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-chalk-500">
            <span className="inline-flex items-center gap-1.5">Allowance: <SourceChip source={view.source.monthlyMinuteBudget} /></span>
            <span className="inline-flex items-center gap-1.5">Reset day: <SourceChip source={view.source.billingResetDay} /></span>
            <span className="inline-flex items-center gap-1.5">Hard cap: <SourceChip source={view.source.hardCapMinutes} /></span>
          </div>

          {/* Restate the informational-vs-blocking distinction so the operator is never surprised. */}
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-chalk-600">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
            75 / 90 / 100% are informational warnings — they never block. Only a configured hard cap blocks generation.
          </p>
        </>
      )}
    </section>
  );
}
