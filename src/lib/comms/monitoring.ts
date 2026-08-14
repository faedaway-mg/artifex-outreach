// ─────────────────────────────────────────────────────────────────────────────
// Operational monitoring for the communication layer. Assembles queue depth,
// volume, deliverability rates, reply latency, retry queue, and scheduler/provider
// health into one snapshot for dashboards + alerting.
//
// Computed from a single scan of the send ledger (+ inbound). Fine at current
// volume; at millions of rows, swap the in-JS reductions for SQL GROUP BY
// aggregates (noted as the scaling path).
// ─────────────────────────────────────────────────────────────────────────────
import { allEmailSends, listLeads, inboundForLead, getSettings } from "../repo";
import { isInternalLead } from "../operators/assignment";
import { getEmailProvider } from "./provider";
import { withinSendingWindow, dueStepIds } from "./scheduler";
import { MAX_ATTEMPTS } from "./state";
import type { EmailSend } from "../types";
import type { HealthResult as ProviderHealth } from "./provider";

function laDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
const rate = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 10000) / 10000 : 0);

export interface CommsMetrics {
  generatedAt: string;
  provider: { name: string; canSend: boolean; mode: string; health?: ProviderHealth };
  scheduler: { windowOpen: boolean; timezone: string; dueNow: number; nextRetryAt: string | null };
  queue: { waiting: number; sending: number; queuedRetries: number; dueNow: number };
  volume: { sentToday: number; sentTotal: number; failedTotal: number; inProgress: number };
  rates: { delivery: number; open: number; click: number; bounce: number; complaint: number; unsubscribe: number };
  replies: { total: number; averageReplyMinutes: number | null };
  retryQueue: { count: number; nextAttemptAt: string | null; items: Array<{ stepId: string | null; attempts: number; nextAttemptAt: string | null; lastErrorCode: string | null }> };
  alerts: string[]; // operational warnings needing attention
}

export async function commsMetrics(opts: { now?: Date; includeProviderHealth?: boolean } = {}): Promise<CommsMetrics> {
  const now = opts.now ?? new Date();
  const [allSends, settings, leads] = await Promise.all([allEmailSends(), getSettings(), listLeads()]);
  const window = settings.sendingWindow ?? { timezone: "America/Los_Angeles", startHour: 8, endHour: 17, weekdays: [1, 2, 3, 4, 5] };
  const tz = window.timezone;
  const todayKey = laDateKey(now.toISOString(), tz);

  // Business-PERFORMANCE numbers (volume, delivery/open/reply rates) describe REAL outreach, so they
  // exclude internal/test sends. Technical queue/retry/provider health (below) intentionally sees ALL
  // sends — test activity is useful there. `sends` = real; `allSends` = everything.
  const internalLeadIds = new Set(leads.filter(isInternalLead).map((l) => l.id));
  const sends = allSends.filter((s) => !(s.leadId && internalLeadIds.has(s.leadId)));

  const has = (s: EmailSend, f: keyof EmailSend) => s[f] != null;
  const sentTotal = sends.filter((s) => has(s, "sentAt")).length;
  const delivered = sends.filter((s) => has(s, "deliveredAt")).length;
  const opened = sends.filter((s) => has(s, "openedAt")).length;
  const clicked = sends.filter((s) => has(s, "clickedAt")).length;
  const bounced = sends.filter((s) => has(s, "bouncedAt")).length;
  const complained = sends.filter((s) => has(s, "complainedAt")).length;
  const unsubscribed = sends.filter((s) => has(s, "unsubscribedAt")).length;
  // Queue/retry are technical infrastructure signals — count across ALL sends (incl. test).
  const failedTotal = allSends.filter((s) => s.status === "failed").length;
  const sending = allSends.filter((s) => s.status === "sending").length;
  const queued = allSends.filter((s) => s.status === "queued").length;
  const sentToday = sends.filter((s) => s.sentAt && laDateKey(s.sentAt, tz) === todayKey).length;

  const retryRows = allSends.filter((s) => s.status === "queued").sort((a, b) => (a.nextAttemptAt ?? "").localeCompare(b.nextAttemptAt ?? ""));
  const nextRetryAt = retryRows.find((r) => r.nextAttemptAt)?.nextAttemptAt ?? null;

  // Average reply latency: for each lead with human replies, time from its first
  // send to its first reply. Averaged across leads. (Approximation — good enough
  // for an ops signal.)
  const sentByLead = new Map<string, string>();
  for (const s of sends) if (s.leadId && s.sentAt) {
    const cur = sentByLead.get(s.leadId);
    if (!cur || s.sentAt < cur) sentByLead.set(s.leadId, s.sentAt);
  }
  let replyTotal = 0;
  const latencies: number[] = [];
  for (const lead of leads) {
    if (isInternalLead(lead)) continue; // real reply performance only
    const inbound = await inboundForLead(lead.id);
    const human = inbound.filter((m) => m.classification !== "Out Of Office" && m.classification !== "Bounce");
    replyTotal += human.length;
    const firstSent = sentByLead.get(lead.id);
    const firstReply = human.map((m) => m.receivedAt).sort()[0];
    if (firstSent && firstReply && firstReply > firstSent) latencies.push((+new Date(firstReply) - +new Date(firstSent)) / 60000);
  }
  const averageReplyMinutes = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  const dueNow = (await dueStepIds(now)).length;
  const provider = getEmailProvider();

  // Operational alerts — surfaced for dashboards/alerting.
  const authStuck = retryRows.filter((r) => r.lastErrorCode === "auth").length;
  const alerts: string[] = [];
  if (authStuck > 0) alerts.push(`Provider auth failing — ${authStuck} send(s) waiting on a valid API key.`);
  if (!provider.canSend) alerts.push("No email provider configured — sends are paused.");
  if (rate(bounced, sentTotal) > 0.05 && sentTotal >= 20) alerts.push(`Bounce rate ${(rate(bounced, sentTotal) * 100).toFixed(1)}% exceeds 5%.`);
  if (rate(complained, sentTotal) > 0.001 && sentTotal >= 100) alerts.push(`Complaint rate ${(rate(complained, sentTotal) * 100).toFixed(2)}% exceeds 0.1%.`);
  if (retryRows.length > 100) alerts.push(`Retry queue backing up — ${retryRows.length} sends pending retry.`);

  const metrics: CommsMetrics = {
    generatedAt: now.toISOString(),
    provider: { name: provider.name, canSend: provider.canSend, mode: provider.meta.mode },
    scheduler: { windowOpen: withinSendingWindow(now, window), timezone: tz, dueNow, nextRetryAt },
    queue: { waiting: queued + dueNow, sending, queuedRetries: queued, dueNow },
    volume: { sentToday, sentTotal, failedTotal, inProgress: sending },
    rates: {
      delivery: rate(delivered, sentTotal), open: rate(opened, sentTotal), click: rate(clicked, sentTotal),
      bounce: rate(bounced, sentTotal), complaint: rate(complained, sentTotal), unsubscribe: rate(unsubscribed, sentTotal),
    },
    replies: { total: replyTotal, averageReplyMinutes },
    retryQueue: {
      count: retryRows.length, nextAttemptAt: nextRetryAt,
      items: retryRows.slice(0, 20).map((r) => ({ stepId: r.stepId, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt, lastErrorCode: r.lastErrorCode })),
    },
    alerts,
  };

  if (opts.includeProviderHealth) metrics.provider.health = await provider.healthCheck();
  return metrics;
}

export const MAX_SEND_ATTEMPTS = MAX_ATTEMPTS;
