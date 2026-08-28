import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { createShare, sharesForPiece } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { pieceId } → publish the piece's APPROVED render as a viewing link. Refuses placeholder/unapproved.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const pieceId = String(body?.pieceId ?? "").trim();
  if (!pieceId) return NextResponse.json({ error: "pieceId required" }, { status: 400 });
  const res = await createShare(pieceId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 422 });
  const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
  return NextResponse.json({ token: res.share.token, viewUrl: `${base}/v/${res.share.token}`, videoHash: res.share.videoHash, createdAt: res.share.createdAt }, { status: 201 });
}

// GET ?pieceId= → existing shares for a piece.
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pieceId = req.nextUrl.searchParams.get("pieceId");
  if (!pieceId) return NextResponse.json({ error: "pieceId required" }, { status: 400 });
  const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
  const shares = (await sharesForPiece(pieceId)).map((s) => ({ token: s.token, viewUrl: `${base}/v/${s.token}`, createdAt: s.createdAt, revokedAt: s.revokedAt, videoHash: s.videoHash.slice(0, 12), inputVersion: s.inputVersion }));
  return NextResponse.json({ shares });
}
