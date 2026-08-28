import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { parseTemplate } from "@/lib/content-studio/template-schema";
import { autoTemplateFromScript } from "@/lib/content-studio/auto-template";
import { saveTemplate, loadTemplate, REPO_ROOT } from "@/lib/content-studio/store";
import { catalogEntry } from "@/lib/content-studio/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → create/replace a data-driven Field Note template. Validated against the bounded schema (no raw
// HTML/JS). On success the cover thumbnail is rendered in the background; the piece is then renderable.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  // Two ways in: a full `beats` template (advanced, e.g. #007), or a plain script (title + narration)
  // that we auto-lay-out onto the statement grammar — phone-friendly, still schema-valid + renderable.
  const b = body as any;
  let parsed;
  if (Array.isArray(b?.beats)) {
    parsed = parseTemplate(body);
  } else {
    const id = (b?.id && String(b.id)) || "p-" + randomUUID().slice(0, 8);
    const auto = autoTemplateFromScript({ id, title: String(b?.title ?? "").trim(), concept: b?.concept ? String(b.concept) : undefined, narration: Array.isArray(b?.narration) ? b.narration.map((s: unknown) => String(s)) : String(b?.narration ?? "").split("\n") });
    parsed = auto.ok ? { ok: true as const, template: auto.template } : { ok: false as const, error: auto.error };
  }
  if (!parsed.ok) return NextResponse.json({ error: "Template failed validation: " + parsed.error }, { status: 422 });
  const t = parsed.template;
  if (catalogEntry(t.id)) return NextResponse.json({ error: `id ${t.id} collides with a built-in piece; choose another.` }, { status: 409 });

  await saveTemplate(t);

  // Render the cover thumbnail (needed for preview + as frame zero). Detached; the piece shows the
  // thumbnail once it lands.
  const worker = path.join(REPO_ROOT, "scripts", "render-template-thumbnail.mjs");
  const child = spawn(process.execPath, [worker, t.id], { cwd: REPO_ROOT, detached: true, stdio: "ignore", env: process.env });
  child.unref();

  return NextResponse.json({
    template: { id: t.id, title: t.title, beats: t.beats.length, narration: t.narration.length },
    note: "Template saved and validated. Cover thumbnail rendering in the background. Upload a voiceover, then Generate.",
  }, { status: 201 });
}

// GET ?id= → fetch a stored template (for editing/inspection).
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const t = await loadTemplate(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ template: t });
}
