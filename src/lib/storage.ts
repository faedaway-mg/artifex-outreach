// ─────────────────────────────────────────────────────────────────────────────
// Durable object storage adapter (S3-compatible: Cloudflare R2 / Amazon S3 /
// Supabase Storage-over-S3). Selected by STORAGE_PROVIDER.
//
//   • mock (default / local dev): nothing is uploaded; PDFs are regenerated
//     on-demand from Postgres via /api/deliverable/[id]/pdf, and screenshots use
//     the placeholder route. Returned url points at the regenerating route.
//   • s3 / r2: uploads the object and returns a stable key + URL.
//
// Predictable, lead-scoped object naming. No public directory listing. Deletion
// supported. File-type/size validation enforced before upload.
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredObject {
  url: string | null;
  key: string;
}

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function storageProvider(): "mock" | "s3" {
  const p = (process.env.STORAGE_PROVIDER ?? "mock").toLowerCase();
  const configured = process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY;
  return (p === "s3" || p === "r2") && configured ? "s3" : "mock";
}

export function storageStatus(): { provider: string; configured: boolean } {
  return { provider: process.env.STORAGE_PROVIDER ?? "mock", configured: storageProvider() === "s3" };
}

function keyForPdf(leadId: string, deliverableId: string): string {
  return `leads/${leadId}/deliverables/${deliverableId}.pdf`;
}
function keyForScreenshot(leadId: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `leads/${leadId}/screenshots/${safe}`;
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

function publicUrl(key: string): string | null {
  const base = process.env.S3_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : null;
}

async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  await client.send(
    new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function uploadPdf(leadId: string, deliverableId: string, buffer: Buffer): Promise<StoredObject> {
  if (buffer.byteLength > MAX_PDF_BYTES) throw new Error("PDF exceeds max size");
  const key = keyForPdf(leadId, deliverableId);
  if (storageProvider() === "mock") {
    // Not persisted to object storage; regenerated on demand from Postgres.
    return { url: `/api/deliverable/${deliverableId}/pdf`, key };
  }
  await putObject(key, buffer, "application/pdf");
  return { url: publicUrl(key) ?? `/api/deliverable/${deliverableId}/pdf`, key };
}

export async function uploadScreenshot(leadId: string, name: string, buffer: Buffer, contentType: string): Promise<StoredObject> {
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Image exceeds max size");
  if (!/^image\//.test(contentType)) throw new Error("Invalid image content type");
  const key = keyForScreenshot(leadId, name);
  if (storageProvider() === "mock") return { url: null, key };
  await putObject(key, buffer, contentType);
  return { url: publicUrl(key), key };
}

export async function deleteObject(key: string | null): Promise<void> {
  if (!key || storageProvider() === "mock") return;
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
}
