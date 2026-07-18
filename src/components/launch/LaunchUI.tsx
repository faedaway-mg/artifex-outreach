import { cn } from "@/lib/utils";
import type { Check, CheckSection, CheckStatus, Metric, Rollup } from "@/lib/launch/types";
import { rollupChecks } from "@/lib/launch/types";

const STATUS_STYLE: Record<CheckStatus, string> = {
  pass: "text-teal-300 border-teal-400/30 bg-teal-400/10",
  warn: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  fail: "text-coral-300 border-coral-400/30 bg-coral-400/10",
};
const STATUS_TEXT: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };

export function StatusPill({ status, label }: { status: CheckStatus; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLE[status])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "pass" ? "bg-teal-400" : status === "warn" ? "bg-amber-400" : "bg-coral-400")} />
      {label ?? STATUS_TEXT[status]}
    </span>
  );
}

export function CheckRow({ check }: { check: Check }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/[0.04] py-2.5 last:border-0">
      <StatusPill status={check.status} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-chalk-100">{check.label}</p>
        <p className="text-xs text-chalk-500">{check.detail}</p>
        {check.fix && check.status !== "pass" && (
          <p className="mt-0.5 text-xs text-amber-300/80">↳ {check.fix}</p>
        )}
      </div>
    </div>
  );
}

export function RollupBadge({ rollup }: { rollup: Rollup }) {
  return (
    <span className="flex items-center gap-2 text-xs text-chalk-500">
      <span className="text-teal-300">{rollup.pass} pass</span>
      <span className="text-amber-300">{rollup.warn} warn</span>
      <span className="text-coral-300">{rollup.fail} fail</span>
    </span>
  );
}

export function ChecklistSection({ section }: { section: CheckSection }) {
  const rollup = rollupChecks(section.checks);
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusPill status={rollup.status} />
          <h3 className="text-sm font-semibold text-chalk-100">{section.name}</h3>
        </div>
        <RollupBadge rollup={rollup} />
      </div>
      <div>{section.checks.map((c) => <CheckRow key={c.id} check={c} />)}</div>
    </div>
  );
}

/** A metric that honestly renders "—" (with a note) when not yet instrumented. */
export function MetricStat({ metric, tone }: { metric: Metric; tone?: "amber" | "indigo" | "azure" | "emerald" | "teal" }) {
  const dot =
    tone === "amber" ? "bg-amber-400" : tone === "indigo" ? "bg-indigo-400" : tone === "azure" ? "bg-azure-400" : tone === "emerald" || tone === "teal" ? "bg-teal-400" : "bg-chalk-500";
  const num =
    tone === "amber" ? "text-amber-300" : tone === "indigo" ? "text-indigo-300" : tone === "azure" ? "text-azure-300" : tone === "emerald" || tone === "teal" ? "text-teal-300" : "text-chalk-50";
  const display = !metric.tracked || metric.value == null ? "—" : String(metric.value);
  return (
    <div className="card card-hover p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-chalk-400">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {metric.label}
      </p>
      <p className={cn("mt-2 text-metric font-semibold tabular-nums tracking-tight", metric.tracked && metric.value != null ? num : "text-chalk-600")}>{display}</p>
      {metric.hint && <p className="mt-0.5 text-xs text-chalk-500">{metric.hint}</p>}
      {!metric.tracked && !metric.hint && <p className="mt-0.5 text-xs text-chalk-600">Not yet instrumented</p>}
    </div>
  );
}

export function Breakdown({ title, data, empty }: { title: string; data: [string, number][]; empty?: string }) {
  const max = Math.max(1, ...data.map(([, n]) => n));
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold text-chalk-100">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-chalk-600">{empty ?? "No data yet."}</p>
      ) : (
        <div className="space-y-2.5">
          {data.map(([label, n]) => (
            <div key={label}>
              <div className="flex justify-between text-xs">
                <span className="truncate text-chalk-400">{label}</span>
                <span className="font-mono text-chalk-300">{n}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-indigo-500" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScoreBar({ name, score, status, rationale }: { name: string; score: number | null; status: CheckStatus; rationale: string }) {
  const barColor = status === "fail" ? "from-coral-500 to-coral-400" : status === "warn" ? "from-amber-500 to-amber-400" : "from-teal-500 to-emerald-400";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusPill status={status} />
          <span className="text-sm font-medium text-chalk-100">{name}</span>
        </div>
        <span className="font-mono text-sm tabular-nums text-chalk-200">{score == null ? "n/a" : `${score}/100`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full bg-gradient-to-r", barColor)} style={{ width: `${score ?? 0}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-chalk-500">{rationale}</p>
    </div>
  );
}

export function PendingList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-semibold text-chalk-100">{title}</h3>
      <p className="mb-3 text-xs text-chalk-500">These activate automatically once real outreach and discovery calls start producing outcomes.</p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 text-xs text-chalk-400">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-chalk-600" />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
