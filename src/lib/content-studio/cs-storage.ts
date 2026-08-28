// Content Studio — durable artifact storage contract. Web and worker exchange OBJECT KEYS (not Mac
// paths): uploads, render inputs/outputs, frozen posters, share media. When STORAGE_PROVIDER=s3/r2 is
// configured, artifacts live in the bucket (reusing the app's S3 client env: S3_BUCKET/S3_* — same as
// src/lib/storage.ts). With no provider configured (local dev) they live under the DURABLE .data dir
// (survives restarts) — never /tmp, never in-memory. Callers use keys; this module resolves them.
//
// STATUS: contract + local backend implemented + tested. The S3 backend reuses the app's credentials and
// is exercised only once R2 is provisioned (deploy gate). Wiring each route/worker to call these instead
// of raw fs is the remaining mechanical step (scoped in the checkpoint) — done here so it's ready.

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, createReadStream } from "node:fs";
import path from "node:path";
import { storageProvider } from "../storage";
import { REPO_ROOT } from "./store";

const LOCAL_ROOT = process.env.CONTENT_STUDIO_DATA_DIR
  ? path.join(path.resolve(process.env.CONTENT_STUDIO_DATA_DIR), "artifacts")
  : path.join(REPO_ROOT, ".data", "content-studio", "artifacts");

export type ArtifactKind = "upload" | "input" | "output" | "poster" | "share-media";

// Deterministic, collision-safe key. Private artifacts get an unguessable segment where relevant.
export function csKey(kind: ArtifactKind, id: string, ext: string): string {
  const safe = id.replace(/[^0-9a-zA-Z._-]/g, "_");
  return `content-studio/${kind}/${safe}.${ext.replace(/^\./, "")}`;
}

export function usingS3(): boolean {
  return storageProvider() === "s3";
}

async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
}

function localPath(key: string): string {
  return path.join(LOCAL_ROOT, key.replace(/^content-studio\//, ""));
}

export async function putArtifact(key: string, body: Buffer, contentType: string): Promise<{ key: string }> {
  if (usingS3()) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }));
    return { key };
  }
  const p = localPath(key);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, p); // atomic → a partial write is never visible (failed publish can't look ready)
  return { key };
}

export async function artifactExists(key: string): Promise<boolean> {
  if (usingS3()) {
    try {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      await (await s3()).send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      return true;
    } catch { return false; }
  }
  return existsSync(localPath(key));
}

// A readable stream + size for the key — used by the token media/poster routes (Range supported by the
// caller). For S3, callers may instead redirect to a presigned URL (free egress) — see the deploy doc.
export async function getArtifact(key: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
  if (usingS3()) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await s3()).send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return { stream: r.Body as NodeJS.ReadableStream, size: Number(r.ContentLength ?? 0) };
  }
  const p = localPath(key);
  if (!existsSync(p)) return null;
  const { statSync } = await import("node:fs");
  return { stream: createReadStream(p), size: statSync(p).size };
}

export async function deleteArtifact(key: string): Promise<void> {
  if (usingS3()) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return;
  }
  const p = localPath(key);
  if (existsSync(p)) await fs.rm(p, { force: true });
}
