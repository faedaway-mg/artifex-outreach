// Content Studio — hosted viewing links for outreach. An APPROVED, non-placeholder render can be
// published to a branded viewing page reached by a durable, unguessable token. The approved video is
// FROZEN (copied + hashed) at share time so regenerating the piece never changes what an already-sent
// link shows. The mp4 stays PRIVATE (served only through the token route with Range support); only a
// small email thumbnail is public. Placeholder audio can never be shared. File-backed + isolatable via
// CONTENT_STUDIO_DATA_DIR (mirrors to a shares table + object storage in production).

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, PUBLIC_DIR, listJobs, readApprovals, loadTemplate } from "./store";
import { latestReadyJob } from "./job";
import { catalogEntry, recommendedCandidates } from "./catalog";
import { ARTIFEX_IDENTITY, ARTIFEX_ADDRESS } from "../identity";

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
const MEDIA_DIR = path.join(SHARES_DIR, "media"); // PRIVATE frozen mp4s
const PUBLIC_SHARE_DIR = path.join(PUBLIC_DIR, "content", "shares"); // public email thumbnails only

export interface ShareRecord {
  token: string;
  pieceId: string;
  businessId: string | null;
  businessName: string | null;
  title: string;
  intro: string;
  videoHash: string; // sha256 of the frozen mp4 (immutability receipt)
  inputVersion: string; // the approved render version this link is bound to
  posterRel: string; // full cover (for the page poster)
  emailThumbRel: string | null; // small public thumbnail w/ play badge (for email)
  createdAt: string;
  revokedAt: string | null;
}

function ensure() { for (const d of [SHARES_DIR, MEDIA_DIR, PUBLIC_SHARE_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
const recPath = (t: string) => path.join(SHARES_DIR, `${t}.json`);
export const shareMediaPath = (t: string) => path.join(MEDIA_DIR, `${t}.mp4`);
// The poster is FROZEN alongside the mp4 (same approved version) — regenerating the piece can't change
// what an already-sent link shows before playback.
export const sharePosterPath = (t: string) => path.join(MEDIA_DIR, `${t}-poster.jpg`);

async function pieceMeta(pieceId: string): Promise<{ title: string; businessId: string | null; businessName: string | null; posterRel: string; intro: string }> {
  const tpl = await loadTemplate(pieceId);
  if (tpl) return { title: tpl.title, businessId: tpl.businessId ?? null, businessName: tpl.businessName ?? null, posterRel: `/content/thumbnails/field-note-${pieceId}-thumbnail.png`, intro: tpl.concept };
  const c = catalogEntry(pieceId);
  return { title: c?.title ?? pieceId, businessId: null, businessName: null, posterRel: `/content/thumbnails/field-note-${pieceId}-thumbnail.png`, intro: c?.concept ?? "" };
}

// Publish the piece's CURRENT approved render as a viewing link. Refuses placeholder/unapproved.
export async function createShare(pieceId: string): Promise<{ ok: true; share: ShareRecord } | { ok: false; error: string }> {
  ensure();
  const [jobs, approvals] = await Promise.all([listJobs(), readApprovals()]);
  const ready = latestReadyJob(jobs, pieceId);
  let sourceFile: string;
  let inputVersion: string;
  if (ready && ready.outputFile && existsSync(ready.outputFile)) {
    if (ready.audioKind === "placeholder") return { ok: false, error: "This render uses a placeholder voiceover — replace and approve it before sharing." };
    const approval = approvals[pieceId];
    const approved = approval && approval.jobId === ready.id && approval.inputVersion === ready.inputVersion;
    if (!approved) return { ok: false, error: "Approve this render for posting before creating a viewing link." };
    sourceFile = ready.outputFile;
    inputVersion = ready.inputVersion;
  } else if (APPROVED_MASTER.includes(pieceId) && approvedMasterFile(pieceId)) {
    // #004–#006 (and #001–#003) are previously-approved finals — shareable directly from their master.
    sourceFile = approvedMasterFile(pieceId)!;
    inputVersion = "approved-master";
  } else {
    return { ok: false, error: "No approved render to share. Render, then approve a non-placeholder voiceover." };
  }

  const meta = await pieceMeta(pieceId);
  const token = randomBytes(18).toString("hex"); // 36 hex chars — durable + unguessable

  // Freeze the approved mp4 (private) + hash it.
  const frozen = shareMediaPath(token);
  await fs.copyFile(sourceFile, frozen);
  const videoHash = await sha256(frozen);

  // Freeze the POSTER too (private, version-bound). Prefer the piece's generated cover; fall back to the
  // mp4's frame zero (which IS the embedded thumbnail) so the poster always exists and matches the video.
  const posterAbs = sharePosterPath(token);
  const coverPng = path.join(PUBLIC_DIR, "content", "thumbnails", `field-note-${pieceId}-thumbnail.png`);
  try {
    // Small + progressive so it paints fast even on a throttled phone connection.
    const scale = "scale=440:782";
    if (existsSync(coverPng)) execFileSync("ffmpeg", ["-y", "-i", coverPng, "-vf", scale, "-q:v", "5", posterAbs], { stdio: "ignore" });
    else execFileSync("ffmpeg", ["-y", "-i", frozen, "-frames:v", "1", "-vf", scale, "-q:v", "5", posterAbs], { stdio: "ignore" });
  } catch { /* poster optional; the page degrades to a plain player */ }

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
    posterRel: meta.posterRel, emailThumbRel, createdAt: new Date().toISOString(), revokedAt: null,
  };
  await fs.writeFile(recPath(token), JSON.stringify(share, null, 2), "utf8");
  return { ok: true, share };
}

export async function getShare(token: string): Promise<ShareRecord | null> {
  try { return JSON.parse(await fs.readFile(recPath(token), "utf8")); } catch { return null; }
}
export async function revokeShare(token: string): Promise<boolean> {
  const s = await getShare(token);
  if (!s) return false;
  s.revokedAt = new Date().toISOString();
  await fs.writeFile(recPath(token), JSON.stringify(s, null, 2), "utf8");
  return true;
}
export async function sharesForPiece(pieceId: string): Promise<ShareRecord[]> {
  ensure();
  try {
    const files = (await fs.readdir(SHARES_DIR)).filter((f) => f.endsWith(".json"));
    const out: ShareRecord[] = [];
    for (const f of files) { try { const s = JSON.parse(await fs.readFile(path.join(SHARES_DIR, f), "utf8")); if (s.pieceId === pieceId) out.push(s); } catch {} }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}
export function isLive(s: ShareRecord | null): s is ShareRecord { return !!s && !s.revokedAt; }
export function openMediaStream(token: string, start: number, end: number) { return createReadStream(shareMediaPath(token), { start, end }); }

function sha256(file: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256"); const s = createReadStream(file);
    s.on("data", (d) => h.update(d)); s.on("end", () => res(h.digest("hex"))); s.on("error", rej);
  });
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
