import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { studioSnapshot, addDraft } from "@/lib/content-studio/store";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → the full Content Studio snapshot (pieces + jobs + uploads + posted markers).
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await studioSnapshot();
  return NextResponse.json({ items });
}

// POST → create a new draft piece (manual script entry). Draft pieces are NOT renderable until a scene
// template is authored for the concept — the response says so explicitly.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const title = String(body?.title ?? "").trim();
  const concept = String(body?.concept ?? "").trim();
  const narration = Array.isArray(body?.narration)
    ? body.narration.map((s: unknown) => String(s)).filter((s: string) => s.trim())
    : String(body?.narration ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  const draft = { id: "draft_" + randomUUID().slice(0, 8), title, concept, narration, createdAt: new Date().toISOString() };
  await addDraft(draft);
  return NextResponse.json({
    draft,
    note: "Draft saved. A scene template must be authored before this concept can be rendered by the engine.",
  }, { status: 201 });
}
