import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { createRenderJob } from "@/lib/content-studio/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → start (or reuse) a real render job. Duplicate clicks for the same inputs return the in-flight
// job (deduped:true) instead of launching a second render.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const pieceId = String(body?.pieceId ?? "").trim();
  const useUpload = Boolean(body?.useUpload);
  if (!pieceId) return NextResponse.json({ error: "pieceId required" }, { status: 400 });
  try {
    const { job, deduped } = await createRenderJob(pieceId, { useUpload });
    return NextResponse.json({ job, deduped }, { status: deduped ? 200 : 202 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
