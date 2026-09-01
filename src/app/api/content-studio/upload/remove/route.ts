import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { removeLatestUpload, hasTemplate } from "@/lib/content-studio/store";
import { catalogEntry } from "@/lib/content-studio/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { pieceId } → retire the piece's CURRENT voiceover so it returns to NEEDS_AUDIO (section I-B
// "remove"). Auth + piece-ownership gated. Older upload versions are preserved for provenance.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const pieceId = String(body?.pieceId ?? "").trim();
  const known = pieceId && (catalogEntry(pieceId) || (await hasTemplate(pieceId)));
  if (!known) return NextResponse.json({ error: "unknown piece" }, { status: 400 });
  const removed = await removeLatestUpload(pieceId);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}
