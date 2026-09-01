// Render-worker heartbeat (section J). The persistent cs-render-worker renews its job lease and touches
// updated_at every ~lease/3 while rendering, and stamps finished_at on completion — so the most recent of
// those IS the worker's heartbeat, without needing to expose the lease columns. This is a READ-ONLY
// health view; it never claims a worker is up from mere queued rows (a backlog with no progress is
// "degraded", not "active").

import type { RenderJob } from "./types";
import { listJobs } from "./store";

const STALE_MS = 10 * 60 * 1000;

export interface WorkerHealth {
  verdict: "active" | "idle" | "degraded";
  lastActivityAt: string | null; // heartbeat: newest render progress / completion
  rendering: number;
  queued: number;
  stale: number; // rendering jobs whose lease/heartbeat has gone silent
  lastCompletedAt: string | null;
}

export async function getWorkerHealth(now: number = Date.now()): Promise<WorkerHealth> {
  return computeWorkerHealth(await listJobs(), now);
}

// Pure core (unit-testable) — deliberately never marks the worker "active" from queued rows alone.
export function computeWorkerHealth(jobs: Pick<RenderJob, "status" | "updatedAt" | "finishedAt">[], now: number = Date.now()): WorkerHealth {
  let lastActivity = 0;
  let lastCompleted = 0;
  let rendering = 0;
  let queued = 0;
  let stale = 0;
  for (const j of jobs) {
    const upd = new Date(j.updatedAt).getTime();
    if (j.status === "rendering") {
      rendering++;
      if (upd > lastActivity) lastActivity = upd;
      if (now - upd > STALE_MS) stale++;
    } else if (j.status === "queued") {
      queued++;
    } else if (j.status === "ready" && j.finishedAt) {
      const f = new Date(j.finishedAt).getTime();
      if (f > lastCompleted) lastCompleted = f;
      if (f > lastActivity) lastActivity = f;
    }
  }
  let verdict: WorkerHealth["verdict"];
  if (rendering > 0 && stale === 0) verdict = "active";
  else if (stale > 0 || (queued > 0 && (lastActivity === 0 || now - lastActivity > STALE_MS))) verdict = "degraded";
  else verdict = "idle";
  return {
    verdict,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    rendering,
    queued,
    stale,
    lastCompletedAt: lastCompleted ? new Date(lastCompleted).toISOString() : null,
  };
}
