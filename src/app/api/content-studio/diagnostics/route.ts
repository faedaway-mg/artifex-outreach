import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getWorkerHealth } from "@/lib/content-studio/worker-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → render-worker heartbeat + queue depth (section J). Read-only diagnostics for the owner.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const worker = await getWorkerHealth();
  return NextResponse.json({ worker });
}
