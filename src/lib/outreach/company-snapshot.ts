// ─────────────────────────────────────────────────────────────────────────────
// THE ONE CANONICAL COMPANY SNAPSHOT (Hard-Simplification mandate VI/VII). Every operator surface —
// Today, Sent & Scheduled, the focused one-company queue, and the Blocked inspector — reads THIS single
// snapshot, so counts and lead IDs can never disagree. It is COMPANY-WIDE (never operator-scoped: the
// prior scope filter could zero-out Today while Schedule still saw 8) and it excludes already-contacted
// and terminal leads from READY (the prior funnel counted 17 "eligible" including mid-sequence leads;
// the true sendable set is the SENDABLE, uncontacted, non-terminal one).
//
// Classification order (each lead lands in exactly ONE primary bucket):
//   sentToday › replied(needs-you) › scheduled › awaiting-video(needs-you) › render-failed(needs-you)
//   › ready(SENDABLE, valid recipient, uncontacted) › blocked(with reason)
// "Blocked" mirrors the read-only census buckets so the on-screen 80 reconciles exactly.
// Pure-ish: all data is passed in by the async gatherer below; the classifier is deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import {
  listLeads, allBusinessIntelligence, allEmailSends, allTasks, getSettings, isSuppressed, listOperators, allInbound, listAudit,
} from "../repo";
import { PROSPECT_PACKAGE_ACTION } from "./prospect-package-store";
import type { FrozenProspectPackage } from "./prospect-package";
import { isInternalLead } from "../operators/assignment";
import { emailsSentOn } from "./send-capacity";
import { validEmail } from "../acquisition/compliance";
import { buildQuickReview } from "./quick-review";
import { quickReviewApproved } from "./review-approval";
import { getEditorialState } from "./review-revisions";
import { emailQueueEligibility } from "./email-queue-eligibility";
import { listScheduledBindings } from "./scheduled-batch";
import { listJobs as csListJobs, listTemplateIds, loadTemplate } from "../content-studio/store";
import { gateNarration } from "../content-studio/narration-quality-gate";
import { latestReadyJob as csLatestReadyJob } from "../content-studio/job";
import { resolveSendingWindow, nextSendingDateKey, ACCOUNTING_TZ } from "./sending-window";
import { withinMorningWindow } from "./outreach-scheduler";
import { retryEligibility, terminalFailureReason } from "../comms/failure-classification";
import { isSent, MAX_ATTEMPTS } from "../comms/state";
import { resolveFrozenReviewForSend } from "./quick-review-freeze";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture"]);

// The operator-facing blocked reason buckets (mandate III). Each maps one-or-more internal
// eligibility reasons to a plain-language label + whether backend automation will safely retry it.
export type BlockedReasonKey =
  | "no-finding" | "no-recipient" | "website-inaccessible" | "review-insufficient"
  | "suppressed" | "duplicate" | "package-failure";
export const BLOCKED_LABEL: Record<BlockedReasonKey, string> = {
  "no-finding": "No directly observed finding",
  "no-recipient": "No usable recipient",
  "website-inaccessible": "Website inaccessible",
  "review-insufficient": "Review insufficient",
  "suppressed": "Suppressed or unsubscribed",
  "duplicate": "Duplicate/prior contact",
  "package-failure": "Video/package failure",
};
// Which reasons backend automation re-attempts on its own (safe to retry) vs. which need Jordan.
const AUTO_RETRIES: Record<BlockedReasonKey, boolean> = {
  "no-finding": true, "no-recipient": true, "website-inaccessible": true, "package-failure": true,
  "review-insufficient": false, "suppressed": false, "duplicate": false,
};

export interface FocusRow { leadId: string; business: string; recipient: string | null; finding: string | null; state: FocusState; failedAction?: string; failReason?: string; retryAvailable?: boolean; }
export type FocusState = "needs-voiceover" | "generating" | "needs-attention" | "ready-to-schedule" | "scheduled" | "sent";
export interface ScheduledRow { leadId: string; business: string; recipient: string; scheduledAt: string; }
export interface SentRow { leadId: string; business: string; when: string; providerState: string; }
export interface ReplyRow { leadId: string; business: string; when: string; }
export interface BlockedCompany { leadId: string; business: string; willRetry: boolean; }
export interface BlockedBucket { reason: BlockedReasonKey; label: string; count: number; companies: BlockedCompany[]; }

export interface CompanySnapshot {
  counts: {
    needsVoiceover: number; needsAttention: number; readyToSchedule: number;
    scheduled: number; sentToday: number; replies: number; blocked: number; remainingCapacity: number;
  };
  needsVoiceover: FocusRow[];   // operator's voiceover is the only thing left
  needsAttention: FocusRow[];   // render/package failure an operator can resolve
  ready: FocusRow[];            // SENDABLE, valid recipient, uncontacted, non-terminal
  scheduled: ScheduledRow[];
  sentToday: SentRow[];
  replies: ReplyRow[];
  blocked: BlockedBucket[];
  nextDateLabel: string; windowOpen: boolean; dateKey: string;
  focusQueueIds: string[];      // the exact one-company-at-a-time queue order (needs-you then ready)
}

const REASON_MAP: Record<string, BlockedReasonKey> = {
  "no-recipient": "no-recipient", "suppressed": "suppressed",
  "insufficient-evidence": "no-finding", "no-review": "no-finding",
  "needs-review": "review-insufficient", "not-delivery-ready": "review-insufficient", "no-cta": "review-insufficient",
  "held": "review-insufficient",
};

export async function buildCompanySnapshot(now: Date = new Date()): Promise<CompanySnapshot> {
  const [leads, bi, emailSends, everyTask, settings, operators, csJobs, scheduledBindings, inbound, audit, templateIdList] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), allTasks(), getSettings(), listOperators(), csListJobs(), listScheduledBindings(), allInbound(), listAudit(5000), listTemplateIds().catch(() => [] as string[]),
  ]);
  // A company is voiceover-ready ONLY if a renderable client PIECE (template) exists — so the focused
  // screen can always display it. A draft package without a template can never enter Record voiceovers.
  const templateIds = new Set(templateIdList);
  // Latest prospect package per lead (bulk; audit is recent-first). The persisted draft is the authoritative
  // signal of "prepared, awaiting only voiceover" (INCOMPLETE) or "assembled, awaiting approval" (READY_TO_APPROVE).
  const pkgByLead = new Map<string, FrozenProspectPackage>();
  for (const a of audit) {
    if (a.action !== PROSPECT_PACKAGE_ACTION) continue;
    const pkg = (a.meta as { pkg?: FrozenProspectPackage } | undefined)?.pkg;
    if (pkg?.leadId && !pkgByLead.has(pkg.leadId)) pkgByLead.set(pkg.leadId, pkg); // first seen = latest
  }
  const internal = new Set(leads.filter(isInternalLead).map((l) => l.id));
  const emailsSentToday = emailsSentOn(emailSends, now, { excludeLeadIds: internal });
  const scheduledLeadIds = new Set(scheduledBindings.map((b) => b.leadId));
  const biByLead = new Map(bi.map((b) => [b.leadId, b]));
  const contacted = new Set(emailSends.filter((e) => e.leadId).map((e) => e.leadId as string));
  // Latest ledger row per lead — so a terminally-failed follow-up surfaces under Needs attention (mandate 3).
  const tsOf = (e: any) => e.sentAt || e.failedAt || e.sendingAt || e.queuedAt || "";
  const latestSendByLead = new Map<string, any>();
  for (const e of emailSends) {
    if (!e.leadId) continue;
    const prev = latestSendByLead.get(e.leadId);
    if (!prev || tsOf(e) > tsOf(prev)) latestSendByLead.set(e.leadId, e);
  }
  // A reply "needs Jordan" when it hasn't been reviewed yet (reviewedAt null) and isn't a bare auto/opt-out class.
  const repliedLeadIds = new Set(inbound.filter((m) => m.reviewedAt == null && m.classification !== "auto_reply" && m.classification !== "opt_out").map((m) => m.leadId));
  const window = resolveSendingWindow(settings);
  const dateKey = nextSendingDateKey(now, window);
  const windowOpen = withinMorningWindow(now, window.timezone, window);
  const nextDateLabel = new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const isSameDay = (iso?: string | null) => { if (!iso) return false; const d = new Date(iso); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); };
  const nowIso = now.toISOString();

  const snap: CompanySnapshot = {
    counts: { needsVoiceover: 0, needsAttention: 0, readyToSchedule: 0, scheduled: 0, sentToday: 0, replies: 0, blocked: 0, remainingCapacity: Math.max(0, 20 - emailsSentToday) },
    needsVoiceover: [], needsAttention: [], ready: [], scheduled: [], sentToday: [], replies: [], blocked: [],
    nextDateLabel, windowOpen, dateKey, focusQueueIds: [],
  };
  const buckets = new Map<BlockedReasonKey, BlockedCompany[]>();
  const addBlocked = (reason: BlockedReasonKey, lead: Lead) => {
    if (!buckets.has(reason)) buckets.set(reason, []);
    buckets.get(reason)!.push({ leadId: lead.id, business: lead.businessName, willRetry: AUTO_RETRIES[reason] });
  };

  for (const lead of leads) {
    if (internal.has(lead.id) || TERMINAL.has(lead.pipelineStage)) continue;

    // 1) Sent today
    const sentRow = emailSends.find((e) => e.leadId === lead.id && isSameDay(e.sentAt));
    if (sentRow) { snap.sentToday.push({ leadId: lead.id, business: lead.businessName, when: new Date(sentRow.sentAt!).toLocaleString("en-US", { timeZone: ACCOUNTING_TZ, hour: "numeric", minute: "2-digit" }), providerState: String(sentRow.status) }); continue; }

    // 2) Replies that actually need Jordan
    if (repliedLeadIds.has(lead.id)) { const m = inbound.find((x) => x.leadId === lead.id); snap.replies.push({ leadId: lead.id, business: lead.businessName, when: m?.receivedAt ? new Date(m.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "" }); continue; }

    // 3) Scheduled — ONLY genuinely FUTURE bindings. A past-due timestamp is never "Scheduled": it is
    // being reconciled (rescheduled forward or terminated) and must not show as future work.
    if (scheduledLeadIds.has(lead.id)) {
      const b = scheduledBindings.find((x) => x.leadId === lead.id)!.binding;
      if (b.scheduledAt > nowIso) { snap.scheduled.push({ leadId: lead.id, business: lead.businessName, recipient: b.recipient, scheduledAt: b.scheduledAt }); continue; }
      // past-due → fall through; it is not shown as scheduled until the reconciler moves it forward.
    }

    // Package/video state for this lead
    const pieceId = `client-${lead.id}`;
    const readyJob = csLatestReadyJob(csJobs, pieceId);
    const active = csJobs.find((j) => j.pieceId === pieceId && (j.status === "queued" || j.status === "rendering"));
    const jobsForPiece = csJobs.filter((j) => j.pieceId === pieceId);
    const lastJob = jobsForPiece[jobsForPiece.length - 1];
    const videoReady = !!readyJob?.outputKey;
    const videoRequired = everyTask.some((t) => t.leadId === lead.id && t.type === "prepare_video" && t.status !== "done" && t.status !== "skipped");
    const profile = biByLead.get(lead.id)?.profile?.businessProfile ?? null;
    const review = buildQuickReview(lead, profile, null, { approved: await quickReviewApproved(lead.id) });
    const finding = (review.findings?.[0] as { observation?: string } | undefined)?.observation ?? null;
    const est = await getEditorialState(lead.id);
    const elig = emailQueueEligibility({ review, recipientValid: validEmail(lead.publicEmail), suppressed: await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone }), held: !!est.held });
    const row = (state: FocusState): FocusRow => ({ leadId: lead.id, business: lead.businessName, recipient: lead.publicEmail ?? null, finding, state });
    const pkg = pkgByLead.get(lead.id);

    // 4) A PREPARED prospect-video package is the authoritative "Record voiceovers" signal. The upstream
    // orchestrator only persists an INCOMPLETE draft once EVERYTHING except the voiceover exists (client
    // piece + finding + recipient + frozen PDF + narration + screenshot). So a company is voiceover-ready
    // iff it has an INCOMPLETE draft; a READY_TO_APPROVE draft (video assembled) is ready-to-schedule.
    const hasPiece = templateIds.has(pieceId);
    if (pkg && hasPiece && (pkg.state === "INCOMPLETE" || pkg.state === "READY_TO_APPROVE")) {
      if (pkg.state === "READY_TO_APPROVE" || videoReady) { snap.ready.push(row("ready-to-schedule")); continue; }
      if (active) { snap.needsVoiceover.push(row("generating")); continue; }        // a render is in flight
      if (lastJob?.status === "failed") { snap.needsAttention.push(row("needs-attention")); continue; }
      // Re-audit the narration at read time: a shallow / contradicted / template-equivalent narration is
      // NEVER shown as voiceover-ready — it becomes "being reanalyzed" until the pipeline regenerates it.
      const t = await loadTemplate(pieceId).catch(() => null);
      const evidence = ((biByLead.get(lead.id)?.profile as unknown as { evidence?: Array<{ field?: string; value?: unknown }> })?.evidence) ?? [];
      const primaryCta = evidence.find((e) => e.field === "primaryCTA")?.value;
      const verdict = gateNarration({ narration: t?.narration ?? [], finding: { key: String(review.findings?.[0]?.id ?? ""), observation: finding }, domFacts: { primaryCta: primaryCta != null ? String(primaryCta) : null }, businessName: lead.businessName, url: lead.website, reviewCount: lead.reviewCount ?? null });
      if (!verdict.ok) { snap.needsAttention.push({ ...row("needs-attention"), failedAction: "Prospect narration", failReason: "Needs stronger evidence — being reanalyzed", retryAvailable: true }); continue; }
      snap.needsVoiceover.push(row("needs-voiceover")); continue;
    }
    void videoRequired;

    // 5) Ready to schedule — SENDABLE, valid recipient, uncontacted (parity with the schedule engine)
    if (elig.ready && review.status === "SENDABLE" && !contacted.has(lead.id)) { snap.ready.push(row("ready-to-schedule")); continue; }

    // 5b) Terminal / exhausted-retry follow-up failure → Needs attention (mandate 3). A genuine failure
    // is never hidden: show company + failed action + plain reason + whether an operator retry is safe.
    const latest = latestSendByLead.get(lead.id);
    if (latest && latest.status === "failed" && !isSent(latest.status)) {
      const elig = retryEligibility(latest);
      const exhausted = (latest.attempts ?? 1) >= MAX_ATTEMPTS;
      if (!elig.retryable || exhausted) {
        snap.needsAttention.push({ ...row("needs-attention"), failedAction: latest.stepId ? "Follow-up email" : "Outreach email", failReason: terminalFailureReason(latest), retryAvailable: elig.retryable });
        continue;
      }
    }

    // 6) Blocked — bucket by plain-language reason (mirrors the census → reconciles to 80)
    if (contacted.has(lead.id)) { addBlocked("duplicate", lead); continue; }
    addBlocked(REASON_MAP[elig.reason ?? ""] ?? "review-insufficient", lead);
  }

  // Focus queue = the one-company-at-a-time order: voiceover first, then ready-to-schedule.
  snap.focusQueueIds = [...snap.needsVoiceover.map((r) => r.leadId), ...snap.needsAttention.map((r) => r.leadId), ...snap.ready.map((r) => r.leadId)];
  snap.blocked = [...buckets.entries()]
    .map(([reason, companies]) => ({ reason, label: BLOCKED_LABEL[reason], count: companies.length, companies }))
    .sort((a, b) => b.count - a.count);
  snap.counts = {
    needsVoiceover: snap.needsVoiceover.length, needsAttention: snap.needsAttention.length, readyToSchedule: snap.ready.length,
    scheduled: snap.scheduled.length, sentToday: snap.sentToday.length, replies: snap.replies.length,
    blocked: snap.blocked.reduce((s, b) => s + b.count, 0), remainingCapacity: Math.max(0, 20 - emailsSentToday),
  };
  return snap;
}
