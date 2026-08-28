// Content Studio — outreach-email DRAFT repository + a non-delivering dispatch harness. This proves the
// full draft → approve → dispatch flow against an ISOLATED persistent store and a transport that RECORDS
// instead of sending — no real email leaves. It enforces the video-artifact policy (email-draft.ts) at
// dispatch. The LIVE Acquisition OS wiring (its draft table, server actions, preview UI and comms/
// dispatch.ts) is owned by the contact-first/scheduler session; see the handoff in the checkpoint. This
// module is the CS-side contract they call, kept isolated so it can be tested end to end today.

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { REPO_ROOT } from "./store";
import { getShare, buildShareEmail, type ShareRecord } from "./share";
import { videoDispatchGate, invalidateApprovalOnShareChange, type EmailDraft, type DispatchContext } from "./email-draft";

const DATA_DIR = process.env.CONTENT_STUDIO_DATA_DIR ? path.resolve(process.env.CONTENT_STUDIO_DATA_DIR) : path.join(REPO_ROOT, ".data", "content-studio");
const DRAFTS_DIR = path.join(DATA_DIR, "email-drafts");
const SENT_DIR = path.join(DATA_DIR, "sent");
const ensure = () => { for (const d of [DRAFTS_DIR, SENT_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const dpath = (id: string) => path.join(DRAFTS_DIR, `${id}.json`);

async function write(f: string, o: unknown) { ensure(); const t = `${f}.tmp-${process.pid}`; await fs.writeFile(t, JSON.stringify(o, null, 2)); await fs.rename(t, f); }

// A "transport" that records instead of sending. The real send is the existing manual workflow.
export interface SendResult { delivered: false; recordedAt: string; to: string; subject: string; sharedVersion: string; }
export type NonDeliveringTransport = (msg: { to: string; subject: string; text: string; html: string; sharedVersion: string }) => Promise<SendResult>;
export const recordingTransport: NonDeliveringTransport = async (msg) => ({ delivered: false, recordedAt: new Date().toISOString(), to: msg.to, subject: msg.subject, sharedVersion: msg.sharedVersion });

// Prepare a draft bound to a business + share + the approved video VERSION.
export async function prepareDraft(opts: { businessId: string; shareToken: string; baseUrl: string; recipientName?: string | null }): Promise<{ ok: true; draft: EmailDraft } | { ok: false; error: string }> {
  const share = await getShare(opts.shareToken);
  if (!share) return { ok: false, error: "share not found" };
  if (share.revokedAt) return { ok: false, error: "share is revoked" };
  if (share.businessId && share.businessId !== opts.businessId) return { ok: false, error: "share belongs to a different business" };
  const email = buildShareEmail(share, { baseUrl: opts.baseUrl, recipientName: opts.recipientName });
  const draft: EmailDraft = {
    id: "csdraft_" + randomUUID().slice(0, 12), businessId: opts.businessId, shareToken: share.token,
    inputVersion: share.inputVersion, subject: email.subject, bodyText: email.text, bodyHtml: email.html,
    artifactKind: "video-link", approvedAt: null, sentAt: null, sentVersion: null,
  };
  await write(dpath(draft.id), draft);
  return { ok: true, draft };
}

export async function getDraft(id: string): Promise<EmailDraft | null> { try { return JSON.parse(await fs.readFile(dpath(id), "utf8")); } catch { return null; } }

// Explicit approval — bound to the current share version. Approving a placeholder/revoked share is refused.
export async function approveDraft(id: string): Promise<{ ok: true; draft: EmailDraft } | { ok: false; error: string }> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: "draft not found" };
  const share = await getShare(draft.shareToken);
  if (!share || share.revokedAt) return { ok: false, error: "viewing link is missing/revoked" };
  if (share.inputVersion !== draft.inputVersion) return { ok: false, error: "video changed since the draft was prepared — re-prepare it" };
  const approved = { ...draft, approvedAt: new Date().toISOString() };
  await write(dpath(id), approved);
  return { ok: true, draft: approved };
}

// Re-sync a draft's approval against its share (revoke/version change → approval cleared).
export async function reconcileDraft(id: string): Promise<EmailDraft | null> {
  const draft = await getDraft(id);
  if (!draft) return null;
  const share = await getShare(draft.shareToken);
  const next = invalidateApprovalOnShareChange(draft, share);
  if (next.approvedAt !== draft.approvedAt) await write(dpath(id), next);
  return next;
}

// FINAL dispatch — enforces the full policy, then hands to a NON-DELIVERING transport and records history.
// Never sends a real email; never silently downgrades a broken video message to a bare email.
export async function dispatchDraft(id: string, ctx: DispatchContext, transport: NonDeliveringTransport = recordingTransport): Promise<{ ok: true; result: SendResult } | { ok: false; blockers: string[] }> {
  const draft = await reconcileDraft(id);
  if (!draft) return { ok: false, blockers: ["draft not found"] };
  const share: ShareRecord | null = await getShare(draft.shareToken);
  const gate = videoDispatchGate(draft, share, ctx);
  if (!gate.ok) return { ok: false, blockers: gate.blockers };
  const result = await transport({ to: draft.businessId, subject: draft.subject, text: draft.bodyText, html: draft.bodyHtml, sharedVersion: draft.inputVersion });
  const sent = { ...draft, sentAt: result.recordedAt, sentVersion: draft.inputVersion };
  await write(dpath(id), sent);
  // Preserve message + shared-version reference in history.
  await write(path.join(SENT_DIR, `${draft.id}.json`), { draftId: draft.id, businessId: draft.businessId, subject: draft.subject, shareToken: draft.shareToken, sharedVersion: draft.inputVersion, artifactKind: draft.artifactKind, recordedAt: result.recordedAt, delivered: false });
  return { ok: true, result };
}
