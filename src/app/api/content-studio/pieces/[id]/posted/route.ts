import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { setPosted } from "@/lib/content-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → record that a piece was manually posted (a marker only — Content Studio never auto-posts to
// any social platform).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const when = new Date().toISOString();
  await setPosted(params.id, when);
  return NextResponse.json({ ok: true, postedAt: when });
}
