// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL VIDEO_FOLLOW_UP (mandate 24). For a company already sent an intro email whose completed video
// was NOT delivered, prepare ONE reviewable follow-up package (READY_TO_APPROVE, never sent) that binds the
// prior provider receipt + the canonical current video. It:
//   • blocks rejected/suppressed leads and leads with no prior send;
//   • detects prior delivery (same video already sent) and refuses to duplicate;
//   • is idempotent on (priorReceiptId + video inputVersion) — a repeat is a no-op, and two concurrent
//     preparations converge to ONE logical package (identical digest);
//   • writes a truthful follow-up copy (references the prior outreach + a newly-prepared video, never a
//     fabricated promise/response);
//   • contacts NO provider and consumes NO send capacity.
// Hold is a separate, resumable operator state (editorial "held"), distinct from Reject and unsubscribe.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, allEmailSends, listAudit, appendAudit, getBusinessIntelligence, isSuppressed } from "../repo";
import { nowIso } from "../store";
import { currentActor } from "../auth";
import { validEmail } from "../acquisition/compliance";
import { isRejectedLead } from "./rejection-core";
import { skipReview } from "./review-revisions";
import { resolveCurrentVideo, latestProspectPackage, assembleDraftPackage, PROSPECT_PACKAGE_ACTION } from "./prospect-package-store";
import { computePackageDigest, PROSPECT_PACKAGE_RECORD_VERSION, type FrozenProspectPackage, type FollowUpLineage } from "./prospect-package";
import { SEND_RECEIPT_ACTION } from "../comms/receipt";

export const VIDEO_FOLLOWUP_ACTION = "prospect.video-followup.prepared";
export const HOLD_ACTION = "prospect.hold";

export interface PriorSend { receiptId: string; sentAt: string; subject: string }

/** The prior INTRO send (earliest provider-accepted email) for a lead + its receipt id, or null. */
export async function findPriorSendReceipt(leadId: string): Promise<PriorSend | null> {
  const sends = (await allEmailSends())
    .filter((e) => e.leadId === leadId && !!e.sentAt)
    .sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? -1 : 1));
  const intro = sends[0];
  if (!intro) return null;
  return { receiptId: intro.providerMessageId ?? intro.id, sentAt: intro.sentAt!, subject: intro.subject };
}

/** Was THIS canonical video already delivered? True if a prior package was SENT bound to this video input
 *  version, or a send receipt referenced the current share publicId. Prevents a duplicate follow-up. */
export async function wasVideoDelivered(leadId: string, videoInputVersion: string | null): Promise<boolean> {
  const audit = await listAudit(20000);
  const pkgs = audit
    .filter((a) => a.action === PROSPECT_PACKAGE_ACTION && a.targetId === leadId)
    .map((a) => (a.meta as { pkg?: FrozenProspectPackage } | undefined)?.pkg)
    .filter((p): p is FrozenProspectPackage => !!p);
  if (videoInputVersion && pkgs.some((p) => p.state === "SENT" && p.video?.inputVersion === videoInputVersion)) return true;
  const publicId = (await latestProspectPackage(leadId))?.share?.publicId;
  if (publicId) {
    const receipts = audit.filter((a) => a.action === SEND_RECEIPT_ACTION && ((a.meta as any)?.leadId === leadId || a.targetId === leadId));
    if (receipts.some((r) => JSON.stringify(r.meta ?? {}).includes(publicId))) return true;
  }
  return false;
}

export interface FollowUpResult {
  ok: boolean;
  leadId: string;
  state?: string;
  packageVersion?: number;
  packageDigest?: string;
  priorReceiptId?: string | null;
  videoRevision?: string | null;
  alreadyPrepared?: boolean;   // idempotent repeat — the follow-up already exists
  alreadyDelivered?: boolean;  // the video was already sent — no follow-up created
  reason?: string;
  blockers?: string[];
}

function followUpCopy(businessName: string): { subject: string; bodyText: string; bodyHtml: string } {
  const who = businessName || "your business";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  // Truthful: we DID reach out; we HAVE now prepared a short video. No claim of a prior promise/reply.
  const bodyText = `Hi,\n\nI reached out recently about ${who}. Since then I put together a short video review — it may be clearer than my note. If it's useful, just reply.\n\n— Artifex Labs`;
  const bodyHtml = `<div><p>Hi,</p><p>I reached out recently about <strong>${esc(who)}</strong>. Since then I put together a short video review — it may be clearer than my note.</p><p>If it's useful, just reply.</p><p>— Artifex Labs</p></div>`;
  return { subject: `A short video review for ${who}`, bodyText, bodyHtml };
}

/** Prepare ONE VIDEO_FOLLOW_UP package → READY_TO_APPROVE. Never approves/schedules/sends. */
export async function prepareVideoFollowUp(input: { leadId: string; actor?: string }): Promise<FollowUpResult> {
  const leadId = input.leadId;
  const actor = input.actor ?? currentActor() ?? "operator";
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, leadId, reason: "lead not found" };
  if (isRejectedLead(lead)) return { ok: false, leadId, reason: "company is rejected — cannot prepare a follow-up" };
  if (!validEmail(lead.publicEmail)) return { ok: false, leadId, reason: "no valid recipient on file" };
  if (await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone })) return { ok: false, leadId, reason: "recipient is suppressed — cannot prepare a follow-up" };

  const prior = await findPriorSendReceipt(leadId);
  if (!prior) return { ok: false, leadId, reason: "no prior sent email — a follow-up needs an intro to follow up on" };

  const cur = await resolveCurrentVideo(leadId);
  if (!cur.available || !cur.artifactKey) return { ok: false, leadId, reason: cur.reason ?? "completed video not available" };

  if (await wasVideoDelivered(leadId, cur.inputVersion)) {
    return { ok: false, leadId, alreadyDelivered: true, priorReceiptId: prior.receiptId, reason: "this video was already delivered — no follow-up needed (hold or close)" };
  }

  // Idempotency: an existing follow-up bound to the same prior receipt + video revision is a no-op.
  const existing = await latestProspectPackage(leadId);
  if (existing?.followUp && existing.followUp.priorReceiptId === prior.receiptId && existing.video?.inputVersion === cur.inputVersion
    && ["READY_TO_APPROVE", "FROZEN", "SCHEDULED", "SENT"].includes(existing.state)) {
    return { ok: true, leadId, alreadyPrepared: true, state: existing.state, packageVersion: existing.packageVersion, packageDigest: existing.packageDigest, priorReceiptId: prior.receiptId, videoRevision: cur.inputVersion };
  }

  const copy = followUpCopy(lead.businessName);
  const { draft, state, blockers } = await assembleDraftPackage(leadId, { subject: copy.subject, bodyHtml: copy.bodyHtml, bodyText: copy.bodyText, videoRequired: true });
  if (state !== "READY_TO_APPROVE" || !draft.review || !draft.video || !draft.share) {
    return { ok: false, leadId, state, blockers, reason: `follow-up package incomplete: ${blockers.join("; ")}` };
  }

  const lineage: FollowUpLineage = {
    priorReceiptId: prior.receiptId,
    priorRevisionId: existing?.video?.inputVersion ?? null,
    priorSentAt: prior.sentAt,
    reason: "completed video not yet delivered to a previously-contacted company",
  };
  const record: FrozenProspectPackage = {
    ...draft, followUp: lineage, recordVersion: PROSPECT_PACKAGE_RECORD_VERSION, review: draft.review, share: draft.share,
    packageDigest: "", state: "READY_TO_APPROVE", frozenAt: "", approvedBy: "system-video-followup",
  };
  record.packageDigest = computePackageDigest(record);
  await appendAudit({ action: PROSPECT_PACKAGE_ACTION, actor, targetType: "lead", targetId: leadId, meta: { pkg: record } as unknown as Record<string, unknown>, ip: null });
  await appendAudit({ action: VIDEO_FOLLOWUP_ACTION, actor, targetType: "lead", targetId: leadId, meta: { priorReceiptId: prior.receiptId, priorSentAt: prior.sentAt, videoInputVersion: cur.inputVersion, packageVersion: record.packageVersion, packageDigest: record.packageDigest, at: nowIso() } as unknown as Record<string, unknown>, ip: null });
  return { ok: true, leadId, state: "READY_TO_APPROVE", packageVersion: record.packageVersion, packageDigest: record.packageDigest, priorReceiptId: prior.receiptId, videoRevision: cur.inputVersion };
}

/** HOLD — a resumable operator pause (editorial "held") that removes the company from active Needs Attention
 *  without rejecting or unsubscribing. Preserves package/video/receipt. Sends/schedules nothing. */
export async function holdCompany(leadId: string, actor?: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await skipReview(leadId, "Held from Needs attention by operator");
  await appendAudit({ action: HOLD_ACTION, actor: actor ?? currentActor() ?? "operator", targetType: "lead", targetId: leadId, meta: { at: nowIso() } as unknown as Record<string, unknown>, ip: null }).catch(() => {});
  return r;
}

/** True if a prepared VIDEO_FOLLOW_UP package exists for a lead (routes it to Ready, not Needs Attention). */
export async function hasPreparedFollowUp(leadId: string): Promise<boolean> {
  const pkg = await latestProspectPackage(leadId);
  return !!pkg?.followUp && ["READY_TO_APPROVE", "FROZEN", "SCHEDULED", "SENT"].includes(pkg.state);
}
