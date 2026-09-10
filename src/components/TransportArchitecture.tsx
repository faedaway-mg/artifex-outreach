"use client";
// TRANSPORT ARCHITECTURE — the operator-facing "which mail system does which job" card.
// THREE clearly-labeled sections so nothing has to be inferred:
//   1. OUTBOUND PROSPECTING → the two Google Workspace lanes (A/B) + combined capacity.
//   2. TRANSACTIONAL EMAIL → Resend, receipts/confirmations only, never prospect outreach.
//   3. BUSINESS MAILBOX → hello@artifexlabs.tech on Microsoft 365 / Outlook.
// Reads the auth-gated, non-secret /api/prospect-transport read-model (booleans, addresses,
// counters — no secrets). Visually consistent with the Launch Readiness page (card + StatusPill).
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/launch/LaunchUI";
import type { CheckStatus } from "@/lib/launch/types";
import {
  laneDisplayStatus,
  laneSentSummary,
  laneTitle,
  transactionalDisplayStatus,
  type LaneDisplayStatus,
  type ProspectTransportView,
} from "@/lib/transport/prospect-transport-view";

/** A lane status word → the StatusPill visual bucket. Only "Healthy" is a pass; the rest warn. */
function laneStatusStyle(s: LaneDisplayStatus): CheckStatus {
  return s === "Healthy" ? "pass" : s === "Unconfigured" || s === "Disabled" ? "fail" : "warn";
}

export function TransportArchitecture() {
  const [view, setView] = useState<ProspectTransportView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/prospect-transport")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ProspectTransportView) => alive && setView(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="card border-coral-400/20 p-5">
        <h3 className="text-sm font-semibold text-chalk-100">Transport architecture</h3>
        <p className="mt-1 text-xs text-chalk-500">Could not load transport status.</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-chalk-100">Transport architecture</h3>
        <p className="mt-1 text-xs text-chalk-500">Loading transport status…</p>
      </div>
    );
  }

  const { prospect, transactional, businessMailbox } = view;
  const txStatus = transactionalDisplayStatus(transactional);

  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-semibold text-chalk-100">Transport architecture</h3>
      <p className="mb-4 text-xs text-chalk-500">Which mail system does which job. Configuration presence, counts, and addresses only — no secrets.</p>

      {/* 1 · OUTBOUND PROSPECTING — the two Google Workspace lanes. */}
      <section className="mb-5">
        <p className="label mb-2">Outbound prospecting</p>
        <div className="space-y-2">
          {prospect.lanes.map((lane) => {
            const status = laneDisplayStatus(lane);
            return (
              <div key={lane.id} className="flex items-start gap-3 border-b border-white/[0.04] py-2 last:border-0">
                <StatusPill status={laneStatusStyle(status)} label={status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-chalk-100">{laneTitle(lane)}</p>
                  <p className="text-xs text-chalk-500">
                    {laneSentSummary(lane)}
                    {lane.domain ? <> · {lane.domain}</> : <> · no domain configured</>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-chalk-400">
          Combined available today: <span className="font-mono text-chalk-200">{prospect.combinedCapacityRemaining}</span>
          <span className="ml-2 text-chalk-600">Google Workspace · {prospect.configuredLaneCount} lane(s) configured</span>
        </p>
      </section>

      {/* 2 · TRANSACTIONAL EMAIL — Resend, never prospect outreach. */}
      <section className="mb-5">
        <p className="label mb-2">Transactional email</p>
        <div className="flex items-start gap-3 border-b border-white/[0.04] py-2">
          <StatusPill status={transactional.configured ? "pass" : "warn"} label={txStatus} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-chalk-100">Resend</p>
            <p className="text-xs text-chalk-500">Receipts &amp; confirmations only — never prospect outreach.</p>
          </div>
        </div>
      </section>

      {/* 3 · BUSINESS MAILBOX — the human inbox on Microsoft 365. */}
      <section>
        <p className="label mb-2">Business mailbox</p>
        <div className="flex items-start gap-3 py-2">
          <StatusPill status="pass" label="Live" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-chalk-100">{businessMailbox.address}</p>
            <p className="text-xs text-chalk-500">{businessMailbox.provider}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
