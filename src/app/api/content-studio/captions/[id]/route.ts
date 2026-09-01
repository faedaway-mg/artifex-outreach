import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getPieces } from "@/lib/content-studio/store";
import { getCaption, saveCaption, regenerateCaption } from "@/lib/content-studio/caption-store";
import type { CaptionSource } from "@/lib/content-studio/caption-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sourceFor(pieceId: string): Promise<CaptionSource | null> {
  const piece = (await getPieces()).find((p) => p.id === pieceId);
  if (!piece) return null;
  return { id: piece.id, title: piece.title, concept: piece.concept, narration: piece.narration ?? [] };
}

// GET → the piece's current caption + revision history (or {caption:null} when none exists yet).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const caption = await getCaption(params.id);
  return NextResponse.json({ caption });
}

// POST { action: "save", text } → persist an owner edit (marks edited, preserves prior in history).
// POST { action: "regenerate", force? } → regenerate from the approved script; refuses to overwrite an
// owner-edited caption unless force is set (UI confirms first) → returns { needsConfirm:true }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "save");

  if (action === "save") {
    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Caption text is required." }, { status: 422 });
    if (text.length > 2200) return NextResponse.json({ error: "Caption exceeds 2200 characters." }, { status: 422 });
    const caption = await saveCaption(params.id, text);
    return NextResponse.json({ caption });
  }

  if (action === "regenerate") {
    const src = await sourceFor(params.id);
    if (!src) return NextResponse.json({ error: "piece not found" }, { status: 404 });
    const res = await regenerateCaption(src, { force: body.force === true });
    if (res.needsConfirm) return NextResponse.json({ needsConfirm: true }, { status: 409 });
    return NextResponse.json({ caption: res.caption });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
