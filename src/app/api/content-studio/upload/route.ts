import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { uploadsDirFor, writeUploadMeta, hasTemplate } from "@/lib/content-studio/store";
import { validateAudioMeta, AUDIO_MAX_BYTES } from "@/lib/content-studio/upload";
import { catalogEntry } from "@/lib/content-studio/catalog";
import type { AudioUpload } from "@/lib/content-studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST (multipart) → store a manually-produced voiceover MP3 for a piece, PRIVATELY (under .data, never
// public). The client passes the detected duration so we can enforce the duration limits.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 }); }

  const pieceId = String(form.get("pieceId") ?? "").trim();
  const known = pieceId && (catalogEntry(pieceId) || (await hasTemplate(pieceId)));
  if (!known) return NextResponse.json({ error: "unknown piece" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

  const durationRaw = form.get("durationSeconds");
  const durationSeconds = durationRaw != null && durationRaw !== "" ? Number(durationRaw) : null;
  const bytes = file.size;
  if (bytes > AUDIO_MAX_BYTES) return NextResponse.json({ error: `File exceeds ${AUDIO_MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });

  const check = validateAudioMeta({ name: file.name, type: file.type, bytes, durationSeconds });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 422 });

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = uploadsDirFor(pieceId);
  const abs = path.join(dir, `${stamp}__${safe}`);
  await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));

  const meta: AudioUpload = {
    pieceId, file: abs, name: file.name, bytes,
    durationSeconds: Number.isFinite(durationSeconds as number) ? durationSeconds : null,
    uploadedAt: new Date().toISOString(),
  };
  await writeUploadMeta(meta);
  return NextResponse.json({ upload: { ...meta, file: undefined } }, { status: 201 });
}
