// ─────────────────────────────────────────────────────────────────────────────
// Platform Health (Phase 4).
//
// One snapshot that tells the operator whether the platform is functioning
// normally: system, provider, queue, database, and communication status plus the
// operational rates that matter (failure, retry, latency). Reuses the existing,
// well-tested comms monitoring and the health-route primitives — this is a
// composition layer, not a new subsystem.
// ─────────────────────────────────────────────────────────────────────────────
import { hasDb, pingDb } from "@/db/client";
import { storageStatus } from "@/lib/storage";
import { artifactStoreStatus } from "@/lib/content-studio/storage-factory";
import { aiMode } from "@/lib/providers/ai";
import { placesMode } from "@/lib/providers/places";
import { authConfigOk } from "@/lib/auth-config";
import { providers, readyProviders, PLANNED_PROVIDERS } from "@/lib/intelligence";
import { commsMetrics, type CommsMetrics } from "@/lib/comms/monitoring";
import { listProspectingRuns } from "@/lib/repo";
import { pct, worst, type CheckStatus } from "./types";

export interface PlatformHealth {
  generatedAt: string;
  database: { configured: boolean; connected: boolean };
  storage: { provider: string; configured: boolean };
  /** The DURABLE video/media ArtifactStore (Content Studio) — distinct from `storage` (PDF/screenshot S3).
   *  `postgres` = durable production; required for servable trust/personalized video assets (§16). */
  artifactStore: { mode: string; configured: boolean };
  auth: { configured: boolean };
  ai: { mode: string };
  places: { mode: string; configured: boolean };
  email: { name: string; canSend: boolean; mode: string };
  intelligenceProviders: { ready: number; total: number; planned: number };
  queue: CommsMetrics["queue"];
  volume: CommsMetrics["volume"];
  rates: CommsMetrics["rates"];
  replies: CommsMetrics["replies"];
  scheduler: CommsMetrics["scheduler"];
  failureRate: number; // % of attempted sends that permanently failed
  retryRate: number; // % of sends currently waiting on a retry
  avgEnrichmentSeconds: number | null; // proxy: average prospecting-run duration
  avgAnalysisSeconds: number | null; // not instrumented (analysis is synchronous, untimed)
  alerts: string[];
  status: CheckStatus;
}

export async function platformHealth(now: Date = new Date()): Promise<PlatformHealth> {
  const dbConfigured = hasDb();
  const [dbConnected, comms, runs] = await Promise.all([
    dbConfigured ? pingDb() : Promise.resolve(false),
    commsMetrics({ now }),
    listProspectingRuns(50),
  ]);

  const store = storageStatus();
  const artifactStore = artifactStoreStatus();
  const readyCount = readyProviders().length;
  const totalProviders = providers().length;

  const completed = runs.filter((r) => r.completedAt);
  const durations = completed.map((r) => (+new Date(r.completedAt!) - +new Date(r.startedAt)) / 1000).filter((s) => s >= 0);
  const avgEnrichmentSeconds = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const attempted = comms.volume.sentTotal + comms.volume.failedTotal;
  const failureRate = pct(comms.volume.failedTotal, attempted);
  const retryRate = pct(comms.queue.queuedRetries, comms.volume.sentTotal + comms.queue.queuedRetries);

  // Overall status: a configured-but-unreachable DB is a hard fail; provider auth
  // alerts or an elevated failure rate are warnings. Mock/dev (no DB) is healthy.
  const signals: CheckStatus[] = ["pass"];
  if (dbConfigured && !dbConnected) signals.push("fail");
  if (comms.alerts.length > 0) signals.push("warn");
  if (failureRate >= 20 && attempted >= 10) signals.push("warn");

  return {
    generatedAt: now.toISOString(),
    database: { configured: dbConfigured, connected: dbConnected },
    storage: { provider: store.provider, configured: store.configured },
    artifactStore,
    auth: { configured: authConfigOk() },
    ai: { mode: aiMode().mode },
    places: { mode: placesMode(), configured: Boolean(process.env.GOOGLE_PLACES_API_KEY) },
    email: { name: comms.provider.name, canSend: comms.provider.canSend, mode: comms.provider.mode },
    intelligenceProviders: { ready: readyCount, total: totalProviders, planned: PLANNED_PROVIDERS.length },
    queue: comms.queue,
    volume: comms.volume,
    rates: comms.rates,
    replies: comms.replies,
    scheduler: comms.scheduler,
    failureRate,
    retryRate,
    avgEnrichmentSeconds,
    avgAnalysisSeconds: null,
    alerts: comms.alerts,
    status: worst(signals),
  };
}
