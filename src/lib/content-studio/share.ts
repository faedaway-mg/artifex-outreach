// Content Studio — hosted viewing links for outreach. An APPROVED, non-placeholder render can be
// published to a branded viewing page reached by a durable, unguessable token. The approved video is
// FROZEN (copied + hashed) at share time so regenerating the piece never changes what an already-sent
// link shows. The mp4 stays PRIVATE (served only through the token route with Range support); only a
// small email thumbnail is public. Placeholder audio can never be shared. File-backed + isolatable via
// CONTENT_STUDIO_DATA_DIR (mirrors to a shares table + object storage in production).

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT, PUBLIC_DIR, listJobs, readApprovals, loadTemplate } from "./store";
import { latestReadyJob } from "./job";
import { catalogEntry, recommendedCandidates } from "./catalog";
import { ARTIFEX_IDENTITY, ARTIFEX_ADDRESS } from "../identity";
import { getArtifactStore } from "./storage-factory";
import { buildObjectKey } from "./cs-object-key";
import { csEnvironment } from "./env-guard";
import * as pgShares from "./cs-lifecycle-pg";

// Postgres mode → share RECORDS persist in content_studio_shares (bytes already live in the ArtifactStore);
// dev/test keep the JSON files below. This is what makes hosted links durable across restarts in staging/prod.
function pgMode(): boolean {
  const p = (process.env.CS_STORAGE_PROVIDER ?? "").trim().toLowerCase();
  return p === "postgres" || p === "pg";
}

const APPROVED_MASTER = ["001", "002", "003", "004", "005", "006"];
function approvedMasterFile(pieceId: string): string | null {
  for (const rel of recommendedCandidates(pieceId)) {
    const abs = path.join(PUBLIC_DIR, "content", rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

const DATA_DIR = process.env.CONTENT_STUDIO_DATA_DIR
  ? path.resolve(process.env.CONTENT_STUDIO_DATA_DIR)
  : path.join(REPO_ROOT, ".data", "content-studio");
const SHARES_DIR = path.join(DATA_DIR, "shares");
const PUBLIC_SHARE_DIR = path.join(PUBLIC_DIR, "content", "shares"); // public email thumbnails only

export interface ShareRecord {
  token: string;
  pieceId: string;
  businessId: string | null;
  businessName: string | null;
  title: string;
  intro: string;
  videoHash: string; // sha256 of the bound mp4 (immutability receipt)
  inputVersion: string; // the approved render version this link is bound to
  videoKey: string; // ArtifactStore key the video route serves — the approved render's output key (no copy),
  // or, for a legacy/master source with no durable key, a token-scoped share-media key published ONCE.
  posterKey: string | null; // ArtifactStore key the poster route serves (approved render poster, or a
  // token-scoped share-media poster published once). Null → poster route 404s and the page degrades.
  posterContentType: string; // content type of the poster object (image/png from a render, image/jpeg if generated)
  posterRel: string; // full cover (for the page poster fallback)
  emailThumbRel: string | null; // small public thumbnail w/ play badge (for email)
  createdAt: string;
  revokedAt: string | null;
}

function ensure() { for (const d of [SHARES_DIR, PUBLIC_SHARE_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
const recPath = (t: string) => path.join(SHARES_DIR, `${t}.json`);

async function pieceMeta(pieceId: string): Promise<{ title: string; businessId: string | null; businessName: string | null; posterRel: string; intro: string }> {
  const tpl = await loadTemplate(pieceId);
  if (tpl) return { title: tpl.title, businessId: tpl.businessId ?? null, businessName: tpl.businessName ?? null, posterRel: `/content/thumbnails/field-note-${pieceId}-thumbnail.png`, intro: tpl.concept };
  const c = catalogEntry(pieceId);
  return { title: c?.title ?? pieceId, businessId: null, businessName: null, posterRel: `/content/thumbnails/field-note-${pieceId}-thumbnail.png`, intro: c?.concept ?? "" };
}

// Publish the piece's CURRENT approved render as a viewing link. Refuses placeholder/unapproved.
// The link REFERENCES the approved render's durable object keys (no byte copy). For a legacy/master
// source that has no key in the store yet, the bytes are published ONCE under a token-scoped share-media
// key — immutability comes from the token→key binding (a regenerate makes a NEW key, never mutating this).
export async function createShare(pieceId: string): Promise<{ ok: true; share: ShareRecord } | { ok: false; error: string }> {
  if (!pgMode()) ensure(); // file mode needs the dirs; pg mode never touches container disk
  const store = getArtifactStore();
  const env = csEnvironment();
  const [jobs, approvals] = await Promise.all([listJobs(), readApprovals()]);
  const ready = latestReadyJob(jobs, pieceId);

  const token = randomBytes(18).toString("hex"); // 36 hex chars — durable + unguessable
  let inputVersion: string;
  let videoKey: string;
  let videoHash: string;
  let posterKey: string | null = null;
  let posterContentType = "image/jpeg";

  // Resolve the approved source to a durable object key.
  if (ready && (ready.outputKey || (ready.outputFile && existsSync(ready.outputFile)))) {
    if (ready.audioKind === "placeholder") return { ok: false, error: "This render uses a placeholder voiceover — replace and approve it before sharing." };
    const approval = approvals[pieceId];
    const approved = approval && approval.jobId === ready.id && approval.inputVersion === ready.inputVersion;
    if (!approved) return { ok: false, error: "Approve this render for posting before creating a viewing link." };
    inputVersion = ready.inputVersion;

    const outMeta = ready.outputKey ? await store.getMeta(ready.outputKey) : null;
    if (ready.outputKey && outMeta) {
      // Durable render output already in the store → REFERENCE it, no copy.
      videoKey = ready.outputKey;
      videoHash = outMeta.sha256;
      if (ready.posterKey && (await store.getMeta(ready.posterKey))) { posterKey = ready.posterKey; posterContentType = "image/png"; }
    } else {
      // Legacy render with only local bytes (no durable key) → publish once under a share-media key.
      const pub = await publishShareVideo(store, env, token, inputVersion, ready.outputFile!);
      videoKey = pub.key; videoHash = pub.sha256;
    }
  } else if (APPROVED_MASTER.includes(pieceId) && approvedMasterFile(pieceId)) {
    // #001–#006 are previously-approved finals with no job/key — publish their master bytes once.
    inputVersion = "approved-master";
    const pub = await publishShareVideo(store, env, token, "master", approvedMasterFile(pieceId)!);
    videoKey = pub.key; videoHash = pub.sha256;
  } else {
    return { ok: false, error: "No approved render to share. Render, then approve a non-placeholder voiceover." };
  }

  const meta = await pieceMeta(pieceId);

  // Poster: prefer the render's durable poster (already bound above). Otherwise generate a small,
  // progressive jpg from the piece cover (fallback: the video's frame zero) and publish it once.
  if (!posterKey) {
    const gen = await generateAndPublishPoster(store, env, token, pieceId, videoKey);
    if (gen) { posterKey = gen.key; posterContentType = "image/jpeg"; }
  }

  // Small PUBLIC email thumbnail (separate from the full cover) with a play badge. Best-effort.
  let emailThumbRel: string | null = null;
  try {
    const emailAbs = path.join(PUBLIC_SHARE_DIR, `${token}-email.jpg`);
    execFileSync("ffmpeg", ["-y", "-i", path.join(PUBLIC_DIR, "content", "thumbnails", `field-note-${pieceId}-thumbnail.png`),
      "-vf", "scale=600:-1,drawbox=x=(iw-170)/2:y=(ih-170)/2:w=170:h=170:color=black@0.45:t=fill,drawtext=text='▶':fontcolor=white:fontsize=96:x=(w-text_w)/2+8:y=(h-text_h)/2:fontfile=/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
      "-q:v", "4", emailAbs], { stdio: "ignore" });
    emailThumbRel = `/content/shares/${token}-email.jpg`;
  } catch { emailThumbRel = meta.posterRel; /* fall back to the cover */ }

  const share: ShareRecord = {
    token, pieceId, businessId: meta.businessId, businessName: meta.businessName,
    title: meta.title, intro: meta.intro, videoHash, inputVersion,
    videoKey, posterKey, posterContentType,
    posterRel: meta.posterRel, emailThumbRel, createdAt: new Date().toISOString(), revokedAt: null,
  };
  if (pgMode()) await pgShares.insertSharePg(share);
  else await fs.writeFile(recPath(token), JSON.stringify(share, null, 2), "utf8");
  return { ok: true, share };
}

// Publish approved video bytes ONCE under a token-scoped share-media key (only when the source has no
// durable render output key — legacy renders and seeded masters). Returns the key + integrity hash.
async function publishShareVideo(store: ReturnType<typeof getArtifactStore>, env: string, token: string, version: string, sourceFile: string) {
  const ver = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(version) ? version : "media";
  const key = buildObjectKey({ artifactClass: "share-media", env, shareToken: token, version: ver, ext: "mp4" });
  const bytes = readFileSync(sourceFile);
  const r = await store.put(key, bytes, { artifactClass: "share-media", contentType: "video/mp4", shareToken: token });
  return { key, sha256: r.sha256 };
}

// Generate a small progressive poster jpg (cover, or the video's frame zero) and publish it once under a
// token-scoped share-media key. Best-effort — returns null if ffmpeg fails (page degrades to no poster).
async function generateAndPublishPoster(store: ReturnType<typeof getArtifactStore>, env: string, token: string, pieceId: string, videoKey: string): Promise<{ key: string } | null> {
  const scratch = path.join(tmpdir(), `cs-share-poster-${token}.jpg`);
  const coverPng = path.join(PUBLIC_DIR, "content", "thumbnails", `field-note-${pieceId}-thumbnail.png`);
  let videoScratch: string | null = null;
  try {
    const scale = "scale=440:782";
    if (existsSync(coverPng)) {
      execFileSync("ffmpeg", ["-y", "-i", coverPng, "-vf", scale, "-q:v", "5", scratch], { stdio: "ignore" });
    } else {
      // Materialize the bound video's frame zero from the store (no assumption of a local file).
      const vbytes = await store.readFull(videoKey);
      if (!vbytes) return null;
      videoScratch = path.join(tmpdir(), `cs-share-vid-${token}.mp4`);
      writeFileSync(videoScratch, vbytes);
      execFileSync("ffmpeg", ["-y", "-i", videoScratch, "-frames:v", "1", "-vf", scale, "-q:v", "5", scratch], { stdio: "ignore" });
    }
    const key = buildObjectKey({ artifactClass: "share-media", env, shareToken: token, version: "poster", ext: "jpg" });
    await store.put(key, readFileSync(scratch), { artifactClass: "share-media", contentType: "image/jpeg", shareToken: token });
    return { key };
  } catch {
    return null;
  } finally {
    try { rmSync(scratch, { force: true }); } catch {}
    if (videoScratch) try { rmSync(videoScratch, { force: true }); } catch {}
  }
}

export async function getShare(token: string): Promise<ShareRecord | null> {
  if (pgMode()) return pgShares.getSharePg(token);
  try { return JSON.parse(await fs.readFile(recPath(token), "utf8")); } catch { return null; }
}
export async function revokeShare(token: string): Promise<boolean> {
  if (pgMode()) return pgShares.revokeSharePg(token);
  const s = await getShare(token);
  if (!s) return false;
  s.revokedAt = new Date().toISOString();
  await fs.writeFile(recPath(token), JSON.stringify(s, null, 2), "utf8");
  return true;
}
export async function sharesForPiece(pieceId: string): Promise<ShareRecord[]> {
  if (pgMode()) return pgShares.sharesForPiecePg(pieceId);
  ensure();
  try {
    const files = (await fs.readdir(SHARES_DIR)).filter((f) => f.endsWith(".json"));
    const out: ShareRecord[] = [];
    for (const f of files) { try { const s = JSON.parse(await fs.readFile(path.join(SHARES_DIR, f), "utf8")); if (s.pieceId === pieceId) out.push(s); } catch {} }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}
export function isLive(s: ShareRecord | null): s is ShareRecord { return !!s && !s.revokedAt; }

// Resolve a LIVE share to its bound video object metadata (size/contentType/hash) via the ArtifactStore.
// Returns null for an unknown/revoked share or a missing object — so a revoked link exposes nothing.
export async function shareVideoMeta(token: string) {
  const s = await getShare(token);
  if (!isLive(s)) return null;
  const meta = await getArtifactStore().getMeta(s.videoKey);
  return meta ? { meta, share: s } : null;
}
export function readShareVideoRange(videoKey: string, start: number, end: number) {
  return getArtifactStore().readRange(videoKey, start, end);
}
export async function sharePoster(token: string) {
  const s = await getShare(token);
  if (!isLive(s) || !s.posterKey) return null;
  const meta = await getArtifactStore().getMeta(s.posterKey);
  if (!meta) return null;
  const bytes = await getArtifactStore().readFull(s.posterKey);
  return bytes ? { bytes, contentType: s.posterContentType || meta.contentType || "image/jpeg" } : null;
}

// Build the outreach email (thumbnail links to the viewing page; NO mp4, NO embedded player).
export function buildShareEmail(share: ShareRecord, opts: { baseUrl: string; recipientName?: string | null }): { subject: string; text: string; html: string; viewUrl: string } {
  const viewUrl = `${opts.baseUrl.replace(/\/$/, "")}/v/${share.token}`;
  const who = share.businessName || "your business";
  const subject = `A short video review for ${who}`;
  const text = [
    `Hi${opts.recipientName ? " " + opts.recipientName : ""},`,
    ``,
    `I put together a short, focused video review for ${who}.`,
    ``,
    `Watch your video review: ${viewUrl}`,
    ``,
    `If it's useful, just reply to this email or book a quick conversation: ${ARTIFEX_IDENTITY.bookingUrl}`,
    ``,
    `— ${ARTIFEX_IDENTITY.companyName}`,
    `${ARTIFEX_ADDRESS}`,
    `(The manual-send workflow appends the standard opt-out/unsubscribe footer at dispatch.)`,
  ].join("\n");
  const thumb = share.emailThumbRel ? `${opts.baseUrl.replace(/\/$/, "")}${share.emailThumbRel}` : `${opts.baseUrl.replace(/\/$/, "")}${share.posterRel}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0C1220;font-size:15px;line-height:1.5">
  <p>Hi${opts.recipientName ? " " + escapeHtml(opts.recipientName) : ""},</p>
  <p>I put together a short, focused video review for <strong>${escapeHtml(who)}</strong>.</p>
  <p><a href="${viewUrl}" style="display:inline-block;text-decoration:none">
    <img src="${thumb}" width="300" alt="Watch your video review" style="display:block;border:1px solid #26334a;border-radius:12px;max-width:300px;height:auto" />
  </a></p>
  <p><a href="${viewUrl}" style="color:#2c5ac4;font-weight:bold">▶ Watch your video review</a></p>
  <p>If it's useful, just reply to this email or <a href="${ARTIFEX_IDENTITY.bookingUrl}" style="color:#2c5ac4">book a quick conversation</a>.</p>
  <p style="color:#5A6B85;font-size:13px">— ${escapeHtml(ARTIFEX_IDENTITY.companyName)}<br/>${escapeHtml(ARTIFEX_ADDRESS)}</p>
  <p style="color:#8A96AC;font-size:11px">The standard opt-out/unsubscribe footer is appended by the manual-send workflow at dispatch.</p>
</div>`;
  return { subject, text, html, viewUrl };
}
function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
