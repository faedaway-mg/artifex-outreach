// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR COCKPIT (master mandate §14) — the one screen that summarizes the machine so the operator
// manages the SYSTEM, not lead-by-lead. Renders a serializable CockpitView (built server-side by
// buildOperatorCockpit). Mobile-first; every unavailable number shows "—" (never invented).
// ─────────────────────────────────────────────────────────────────────────────
import type { CockpitView } from "@/lib/lead-sprint/cockpit";

const n = (v: number | null | undefined) => (v == null ? "—" : String(v));
const usd = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] uppercase tracking-wide text-chalk-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ?? "text-chalk-50"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-chalk-500">{hint}</p>}
    </div>
  );
}

function LaneCard({ lane }: { lane: CockpitView["lanes"][number] }) {
  const paused = lane.state === "PAUSED";
  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-chalk-100">{lane.laneId}</p>
        <span className={`rounded-md px-2 py-0.5 text-[11px] ${paused ? "bg-rose-400/10 text-rose-300" : "bg-teal-400/10 text-teal-300"}`}>{lane.state}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-chalk-400">
        <div>Level <span className="text-chalk-100">{lane.level}</span></div>
        <div>Real-send cap <span className="text-chalk-100">{lane.effectiveDailyCap}/day</span></div>
        <div>Gmail seed <span className="text-chalk-100">{lane.seed.gmail}</span></div>
        <div>Outlook seed <span className={lane.seed.outlook === "junk" ? "text-amber-300" : "text-chalk-100"}>{lane.seed.outlook}</span></div>
      </div>
      {lane.blocksPromotion && (
        <p className="mt-2 rounded-md bg-amber-400/[0.06] px-2 py-1 text-[11px] text-amber-200">
          Outlook seed not confirmed in Inbox → automatic promotion is blocked (honest deliverability, not transport health).
        </p>
      )}
    </div>
  );
}

export function Cockpit({ view }: { view: CockpitView }) {
  const ls = view.leadSprint;
  const go = view.launchReadiness.state === "GO";
  return (
    <div className="space-y-6">
      {/* Safety banner — delivery/autosend posture always visible. */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 border-white/[0.08] p-3 text-xs">
        <span className={`rounded-md px-2 py-0.5 ${view.safety.prospectDeliveryOn ? "bg-rose-400/10 text-rose-300" : "bg-white/[0.05] text-chalk-300"}`}>
          Prospect delivery {view.safety.prospectDeliveryOn ? "ON" : "OFF"}
        </span>
        <span className={`rounded-md px-2 py-0.5 ${view.safety.autosendOn ? "bg-rose-400/10 text-rose-300" : "bg-white/[0.05] text-chalk-300"}`}>
          Autosend {view.safety.autosendOn ? "ON" : "OFF"}
        </span>
        <span className="text-chalk-500">Cold transport: <span className="text-chalk-200">Google Workspace</span></span>
        <span className="text-chalk-500">Transactional: <span className="text-chalk-200">Resend</span></span>
      </div>

      {/* System health + launch readiness. */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-chalk-500">System health</p>
          <p className="mt-1 text-lg font-semibold text-chalk-50">{view.systemHealth.status}</p>
          {view.systemHealth.alerts.length > 0
            ? <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200">{view.systemHealth.alerts.slice(0, 4).map((a, i) => <li key={i}>• {a}</li>)}</ul>
            : <p className="mt-0.5 text-[11px] text-chalk-500">No active alerts.</p>}
        </div>
        <div className="card p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-chalk-500">Launch readiness</p>
          <p className={`mt-1 text-lg font-semibold ${go ? "text-teal-300" : "text-amber-300"}`}>{view.launchReadiness.state}</p>
          {view.launchReadiness.blockers.length > 0
            ? <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200">{view.launchReadiness.blockers.slice(0, 5).map((b, i) => <li key={i}>• {b}</li>)}</ul>
            : <p className="mt-0.5 text-[11px] text-chalk-500">All required checks pass.</p>}
        </div>
      </section>

      {/* Google lanes. */}
      <section>
        <p className="label mb-2">Google lanes · combined real-send capacity {view.combinedDailyCapacity}/day (no quota transfer)</p>
        <div className="grid gap-3 sm:grid-cols-2">{view.lanes.map((l) => <LaneCard key={l.laneId} lane={l} />)}</div>
      </section>

      {/* Lead Sprint funnel. */}
      <section>
        <p className="label mb-2">Lead Sprint (#183) · free pipeline behind the delivery gate</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Discovered" value={n(ls.discovered)} />
          <Stat label="Cheap-qualified" value={n(ls.cheaplyQualified)} tone="text-azure-300" />
          <Stat label="Ranked pool" value={n(ls.rankedPool)} tone="text-teal-300" />
          <Stat label="Finalists" value={n(ls.finalists)} hint={`meeting contract: ${ls.finalistsMeetingContract}`} />
          <Stat label="Ready-to-Send target" value={`${ls.readyToSendTarget.min}–${ls.readyToSendTarget.max}`} />
          <Stat label="Rejected pre-paid" value={n(ls.rejectedBeforePaid)} tone="text-amber-300" />
          <Stat label="Legacy excluded" value={n(ls.excludedLegacy)} hint="archived/disqualified" />
          <Stat label="Avg send value" value={n(ls.avgSendValue)} />
        </div>
      </section>

      {/* Production. */}
      <section>
        <p className="label mb-2">Production</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Voiceovers" value={n(view.production.voiceovers)} />
          <Stat label="Renders" value={n(view.production.renders)} />
          <Stat label="Breakbot failures" value={n(view.production.breakbotFailures)} tone="text-amber-300" />
          <Stat label="Replacement candidates" value={n(view.production.replacementCandidates)} />
        </div>
      </section>

      {/* Cost ledger — honest known vs unknown. */}
      <section>
        <p className="label mb-2">Cost · {view.cost.totalEvents} measured events · known total {usd(view.cost.summary.knownUsdTotal)}</p>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
              <tr><th className="px-4 py-2.5 font-medium">Provider</th><th className="px-3 py-2.5 text-right font-medium">Units</th><th className="px-3 py-2.5 text-right font-medium">Events</th><th className="px-4 py-2.5 text-right font-medium">Known USD</th></tr>
            </thead>
            <tbody>
              {view.cost.byKind.map((k) => (
                <tr key={k.kind} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-2.5 text-chalk-200">{k.kind}</td>
                  <td className="px-3 py-2.5 text-right text-chalk-300">{k.units} {k.unit}</td>
                  <td className="px-3 py-2.5 text-right text-chalk-300">{k.events}</td>
                  <td className="px-4 py-2.5 text-right text-chalk-300">{usd(k.knownUsd)}</td>
                </tr>
              ))}
              {view.cost.byKind.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-5 text-center text-xs text-chalk-600">No paid compute recorded — paid pipeline is fail-closed OFF (honest, not a bug).</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {view.cost.summary.unknownCostKinds.length > 0 && (
          <p className="mt-1.5 text-[11px] text-chalk-500">Unknown $ (no configured provider rate — never fabricated): {view.cost.summary.unknownCostKinds.join(", ")}</p>
        )}
      </section>

      {/* Outcomes — unavailable until sending begins. */}
      <section>
        <p className="label mb-2">Outcomes (available once sending begins)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Sent" value={n(view.outcomes.sent)} />
          <Stat label="Replies" value={n(view.outcomes.replies)} />
          <Stat label="Positive" value={n(view.outcomes.positiveReplies)} tone="text-emerald-300" />
          <Stat label="Opt-outs" value={n(view.outcomes.optOuts)} />
          <Stat label="Bounces" value={n(view.outcomes.bounces)} tone="text-amber-300" />
          <Stat label="Purchases" value={n(view.outcomes.purchases)} tone="text-emerald-300" />
        </div>
      </section>

      <p className="text-[11px] text-chalk-600">Generated {view.generatedAt} · read-only · no send, no charge.</p>
    </div>
  );
}
