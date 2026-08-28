import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { readJob, writeJob } from "@/lib/content-studio/store";
import { reconcileStale } from "@/lib/content-studio/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → poll a job's status. A crashed worker (stale + process gone) is reconciled to "failed" so the
// UI can offer retry instead of spinning forever.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = await readJob(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const reconciled = reconcileStale(job);
  if (reconciled.status !== job.status) await writeJob(reconciled);
  return NextResponse.json({ job: reconciled });
}
