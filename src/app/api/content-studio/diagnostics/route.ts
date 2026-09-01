import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";
import { getScreenshotHealth } from "@/lib/content-studio/screenshot-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → render-worker heartbeat + queue depth (section J) AND screenshot-worker heartbeat + queue depth
// (section G). Read-only diagnostics for the owner. Each health call is independent so one failing store
// never blanks the other.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [worker, screenshot] = await Promise.all([
    getWorkerHealth().catch((e) => ({ error: String(e?.message ?? e) })),
    getScreenshotHealth().catch((e) => ({ error: String(e?.message ?? e) })),
  ]);
  return NextResponse.json({ worker, screenshot });
}
