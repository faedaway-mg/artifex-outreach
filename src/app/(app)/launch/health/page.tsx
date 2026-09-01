// Phase 4 — Platform Health. Is the platform functioning normally right now?
import { platformHealth } from "@/lib/launch/health";
import { metric } from "@/lib/launch/types";
import { MetricStat, StatusPill } from "@/components/launch/LaunchUI";
import { SectionHeader } from "@/components/ui";
import { getSettings } from "@/lib/repo";
import { DEFAULT_REFILL_POLICY, emptyCheckpoint } from "@/lib/acquisition/refill";

export const dynamic = "force-dynamic";

const rate = (n: number) => `${Math.round(n * 1000) / 10}%`;

export default async function HealthPage() {
  const h = await platformHealth();

  // §5 owner visibility — the autonomous refill's last run / next run / outcome, read from the persisted
  // checkpoint. "Next run" is the scheduled 5:30 AM PT full cron; refill discovers only when the reserve
  // has dropped below 40 (and a Places credential is configured), and it never sends email.
  const settings = await getSettings().catch(() => null);
  const cp = { ...emptyCheckpoint(), ...(settings?.refillCheckpoint ?? {}) };
  const lastRefill = cp.lastRefillAt || cp.updatedAt || null;
  const refillReady = cp.lastReserveReady ?? 0;
  const refillHolding = refillReady >= DEFAULT_REFILL_POLICY.refillThreshold;
  const refillReadyDelivery = cp.lastFunnel?.deliveryReady ?? null;

  return (
    <div className="space-y-8">
      <div className={`card flex flex-wrap items-center justify-between gap-3 p-5 ${h.status === "fail" ? "border-coral-400/30" : h.status === "warn" ? "border-amber-400/30" : "border-teal-400/30"}`}>
        <div className="flex items-center gap-3">
          <StatusPill status={h.status} />
          <div>
            <p className="text-sm font-semibold text-chalk-100">
              {h.status === "fail" ? "A subsystem needs attention." : h.status === "warn" ? "Operating with warnings." : "All systems normal."}
            </p>
            <p className="text-xs text-chalk-500">Snapshot at {new Date(h.generatedAt).toLocaleTimeString()}.</p>
          </div>
        </div>
      </div>

      {h.alerts.length > 0 && (
        <div className="card border-amber-400/30 p-5">
          <p className="mb-2 text-sm font-semibold text-amber-200">Active alerts</p>
          <ul className="space-y-1.5">
            {h.alerts.map((a) => <li key={a} className="flex items-start gap-2 text-sm text-chalk-300"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />{a}</li>)}
          </ul>
        </div>
      )}

      <section>
        <SectionHeader title="System" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Database", h.database.configured ? (h.database.connected ? "Connected" : "Unreachable") : "In-memory")} tone={h.database.configured && h.database.connected ? "teal" : undefined} />
          <MetricStat metric={metric("Storage", `${h.storage.provider}${h.storage.configured ? "" : " (ephemeral)"}`)} />
          <MetricStat metric={metric("Auth", h.auth.configured ? "Secure" : "Dev defaults")} tone={h.auth.configured ? "teal" : "amber"} />
          <MetricStat metric={metric("Scheduler window", h.scheduler.windowOpen ? "Open" : "Closed", true, h.scheduler.timezone)} />
        </div>
      </section>

      <section>
        <SectionHeader title="Providers" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Enrichment providers", `${h.intelligenceProviders.ready}/${h.intelligenceProviders.total}`, true, `${h.intelligenceProviders.planned} planned`)} tone="teal" />
          <MetricStat metric={metric("Email provider", h.email.canSend ? h.email.name : `${h.email.mode} (paused)`)} tone={h.email.canSend ? "teal" : "amber"} />
          <MetricStat metric={metric("AI mode", h.ai.mode)} />
          <MetricStat metric={metric("Places mode", h.places.mode)} tone={h.places.mode === "disabled" ? "amber" : undefined} />
        </div>
      </section>

      <section>
        <SectionHeader title="Queue & throughput" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Waiting", h.queue.waiting)} />
          <MetricStat metric={metric("Sending", h.queue.sending)} tone="azure" />
          <MetricStat metric={metric("Due now", h.queue.dueNow)} />
          <MetricStat metric={metric("Retry queue", h.queue.queuedRetries)} tone={h.queue.queuedRetries ? "amber" : undefined} />
          <MetricStat metric={metric("Sent today", h.volume.sentToday)} />
          <MetricStat metric={metric("Sent total", h.volume.sentTotal)} />
          <MetricStat metric={metric("Failure rate", `${h.failureRate}%`)} tone={h.failureRate >= 20 ? "amber" : undefined} />
          <MetricStat metric={metric("Retry rate", `${h.retryRate}%`)} tone={h.retryRate >= 25 ? "amber" : undefined} />
        </div>
      </section>

      <section>
        <SectionHeader title="Reserve refill (autonomous)" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Ready reserve", `${refillReady} / ${DEFAULT_REFILL_POLICY.targetReserve}`, true, refillHolding ? `holding (≥${DEFAULT_REFILL_POLICY.refillThreshold})` : `below ${DEFAULT_REFILL_POLICY.refillThreshold}`)} tone={refillHolding ? "teal" : "amber"} />
          <MetricStat metric={metric("Refill status", refillHolding ? "Idle — at/above threshold" : "Refilling")} tone={refillHolding ? undefined : "amber"} />
          <MetricStat metric={metric("Last refill run", lastRefill ? new Date(lastRefill).toLocaleString() : "never", lastRefill != null)} />
          <MetricStat metric={metric("Next refill run", "5:30 AM PT daily (auto)", true, "no manual POST")} tone="teal" />
          <MetricStat metric={metric("Delivery-ready (last)", refillReadyDelivery == null ? null : refillReadyDelivery, refillReadyDelivery != null)} />
          <MetricStat metric={metric("Discovery budget", `${cp.searchBudgetSpent} / ${cp.searchBudgetLimit}`)} />
          <MetricStat metric={metric("Rotation offset", cp.rotationOffset)} />
          <MetricStat metric={metric("Discovery source", h.places.mode === "disabled" ? "Places key absent" : `Places ${h.places.mode}`)} tone={h.places.mode === "disabled" ? "amber" : "teal"} />
        </div>
      </section>

      <section>
        <SectionHeader title="Communication & latency" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Delivery rate", rate(h.rates.delivery))} tone="teal" />
          <MetricStat metric={metric("Open rate", rate(h.rates.open))} />
          <MetricStat metric={metric("Bounce rate", rate(h.rates.bounce))} tone={h.rates.bounce > 0.05 ? "amber" : undefined} />
          <MetricStat metric={metric("Complaint rate", rate(h.rates.complaint))} tone={h.rates.complaint > 0.001 ? "amber" : undefined} />
          <MetricStat metric={metric("Replies", h.replies.total)} tone="emerald" />
          <MetricStat metric={metric("Avg reply time", h.replies.averageReplyMinutes == null ? null : `${h.replies.averageReplyMinutes} min`, h.replies.averageReplyMinutes != null)} />
          <MetricStat metric={metric("Avg enrichment time", h.avgEnrichmentSeconds == null ? null : `${h.avgEnrichmentSeconds}s`, h.avgEnrichmentSeconds != null, "prospecting-run proxy")} />
          <MetricStat metric={metric("Avg analysis time", h.avgAnalysisSeconds, false)} />
        </div>
      </section>
    </div>
  );
}
