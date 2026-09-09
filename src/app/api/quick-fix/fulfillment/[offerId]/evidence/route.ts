import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import type { EvidenceKind } from "@/lib/quick-fix/store";
import { uploadScreenshot, uploadPdf } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: EvidenceKind[] = ["before", "after", "test", "artifact", "url"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// OPERATOR-ONLY: attach a completion-evidence artifact to a paid job. Accepts either a
// multipart file (image → uploadScreenshot, pdf → uploadPdf) or a plain URL reference.
// The operator MUST state what the artifact demonstrates. Reuses src/lib/storage.ts —
// no plaintext/executable upload paths. Immutable + audited + de-duped in the store.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const job = await store.getJob(params.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });

  const ct = req.headers.get("content-type") ?? "";

  // ── URL evidence (JSON body) ────────────────────────────────────────────────
  if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { kind?: string; url?: string; label?: string; demonstrates?: string };
    const kind = (body.kind ?? "url") as EvidenceKind;
    if (!KINDS.includes(kind)) return NextResponse.json({ ok: false, error: "invalid kind" }, { status: 400 });
    const url = String(body.url ?? "").trim();
    const demonstrates = String(body.demonstrates ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ ok: false, error: "a valid http(s) url is required" }, { status: 400 });
    if (!demonstrates) return NextResponse.json({ ok: false, error: "state what this evidence demonstrates" }, { status: 400 });
    const { item, deduped } = await store.addEvidence(params.offerId, {
      kind, url, storageKey: null, label: String(body.label ?? "URL evidence").slice(0, 200), demonstrates: demonstrates.slice(0, 300),
    });
    return NextResponse.json({ ok: true, item, deduped });
  }

  // ── File evidence (multipart) ───────────────────────────────────────────────
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "expected multipart/form-data or application/json" }, { status: 400 }); }

  const kind = String(form.get("kind") ?? "artifact") as EvidenceKind;
  if (!KINDS.includes(kind) || kind === "url") return NextResponse.json({ ok: false, error: "invalid kind for a file upload" }, { status: 400 });
  const demonstrates = String(form.get("demonstrates") ?? "").trim();
  if (!demonstrates) return NextResponse.json({ ok: false, error: "state what this evidence demonstrates" }, { status: 400 });
  const label = String(form.get("label") ?? "").trim() || (kind + " evidence");

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });

  const contentType = file.type || "application/octet-stream";
  const isImage = /^image\//.test(contentType);
  const isPdf = contentType === "application/pdf";
  if (!isImage && !isPdf) return NextResponse.json({ ok: false, error: "only images or PDFs are accepted as evidence" }, { status: 422 });
  if (isImage && file.size > MAX_IMAGE_BYTES) return NextResponse.json({ ok: false, error: "image exceeds 10MB" }, { status: 413 });
  if (isPdf && file.size > MAX_PDF_BYTES) return NextResponse.json({ ok: false, error: "pdf exceeds 20MB" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const safeName = (file.name || `${kind}.bin`).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const objName = `${params.offerId}__${kind}__${sha256.slice(0, 12)}__${safeName}`;

  let stored: { url: string | null; key: string };
  try {
    stored = isPdf ? await uploadPdf(job.leadId, `qf-evidence-${sha256.slice(0, 16)}`, buf) : await uploadScreenshot(job.leadId, objName, buf, contentType);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "storage failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  const { item, deduped } = await store.addEvidence(params.offerId, {
    kind,
    storageKey: stored.key,
    url: stored.url,
    label: label.slice(0, 200),
    demonstrates: demonstrates.slice(0, 300),
    filename: safeName,
    contentType,
    sizeBytes: buf.byteLength,
  });
  return NextResponse.json({ ok: true, item, deduped }, { status: deduped ? 200 : 201 });
}
