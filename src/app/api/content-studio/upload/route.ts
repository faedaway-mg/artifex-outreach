import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isAuthenticated } from "@/lib/auth";
import { uploadsDirFor, writeUploadMeta, hasTemplate } from "@/lib/content-studio/store";
import { validateAudioMeta, AUDIO_MAX_BYTES } from "@/lib/content-studio/upload";
import { catalogEntry } from "@/lib/content-studio/catalog";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { buildObjectKey } from "@/lib/content-studio/cs-object-key";
import { csEnvironment } from "@/lib/content-studio/env-guard";
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

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ext = (file.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  // Canonical, safe object key — a stamped upload id (NOT the raw filename). Store bytes through the
  // ONE ArtifactStore (local in dev, Postgres in prod). No browser-supplied key, no path traversal.
  const uploadId = "up" + Date.now().toString(36) + Math.floor(performance.now()).toString(36).slice(-4);
  const objectKey = buildObjectKey({ artifactClass: "upload", env: csEnvironment(), operatorId: pieceId.replace(/[^a-z0-9]/gi, "-").slice(0, 32) || "op", version: uploadId, ext });
  try {
    await getArtifactStore().put(objectKey, buf, { artifactClass: "upload", contentType: file.type || "audio/mpeg", metadata: { pieceId, name: file.name } });
  } catch (e: any) {
    return NextResponse.json({ error: "storage failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  // LEGACY dev fallback path (retained so existing dev readers work during the caller cutover). In
  // production/staging the objectKey is authoritative; nothing reads the local path and the container has
  // no writable .data — so the directory creation AND write are best-effort inside one guard (never 500).
  let abs = "";
  try {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    abs = path.join(uploadsDirFor(pieceId), `${stamp}__${safe}`);
    await fs.writeFile(abs, buf);
  } catch { abs = ""; /* production has no local uploads dir — objectKey covers it */ }

  const kind = String(form.get("kind") ?? "uploaded") === "placeholder" ? "placeholder" : "uploaded";
  const meta: AudioUpload = {
    pieceId, file: abs, objectKey, sha256, name: file.name, bytes,
    durationSeconds: Number.isFinite(durationSeconds as number) ? durationSeconds : null,
    uploadedAt: new Date().toISOString(),
    kind,
  };
  await writeUploadMeta(meta);
  // Never return a filesystem path — only the object key + integrity.
  return NextResponse.json({ upload: { ...meta, file: undefined, objectKey, sha256 } }, { status: 201 });
}
