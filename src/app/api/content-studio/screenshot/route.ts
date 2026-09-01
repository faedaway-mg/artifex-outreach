import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getLead } from "@/lib/repo";
import { normalizeCaptureUrl } from "@/lib/content-studio/ssrf-guard";
import {
  createScreenshotJob, readScreenshotJob, listScreenshotJobs, sanitizeScreenshotJob, captureTargetFor, type Viewport,
} from "@/lib/content-studio/screenshot-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The capture target is ALWAYS the lead's own stored canonical website — never an operator-supplied URL.
// This is the primary SSRF control at the enqueue boundary: an operator can pick a business, not an
// arbitrary address. The worker then re-validates (DNS + per-redirect) before it ever connects.
function resolveViewport(v: unknown): Viewport {
  return v === "desktop" ? "desktop" : "mobile";
}

// POST { leadId, viewport? } → enqueue a capture of that lead's verified website. Idempotent: an active
// capture for the same canonical URL + viewport is returned rather than duplicated.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const leadId = String(body?.leadId ?? "").trim();
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const viewport = resolveViewport(body?.viewport);

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "unknown business" }, { status: 404 });
  if (!lead.website) return NextResponse.json({ error: "This business has no website on record to capture." }, { status: 422 });

  // Shape-check the stored URL up front so an obviously-bad record can't create a doomed job.
  const norm = normalizeCaptureUrl(lead.website);
  if (!norm.ok) return NextResponse.json({ error: `Website is not a safe capture target (${norm.category}): ${norm.reason}` }, { status: 422 });

  const { job, deduped } = await createScreenshotJob({ businessId: leadId, pieceId: `client-${leadId}`, requestedUrl: captureTargetFor(norm.url!.href), viewport });
  return NextResponse.json({ job: sanitizeScreenshotJob(job), deduped }, { status: deduped ? 200 : 202 });
}

// GET ?job=<id> → one job's sanitized status; GET ?business=<leadId> → that business's captures.
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get("job");
  const business = req.nextUrl.searchParams.get("business");
  if (jobId) {
    const job = await readScreenshotJob(jobId);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ job: sanitizeScreenshotJob(job) });
  }
  if (business) {
    const jobs = await listScreenshotJobs(business);
    return NextResponse.json({ jobs: jobs.map(sanitizeScreenshotJob) });
  }
  return NextResponse.json({ error: "job or business query param required" }, { status: 400 });
}
