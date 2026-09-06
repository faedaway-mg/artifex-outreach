// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO TWO-WORKSPACE MODEL (mandate 25 §B3–B5). Pure, deterministic separation of every studio
// video into exactly ONE of two workspaces — Proposal Videos (prospect outreach) and Content Videos (Artifex
// marketing) — using the canonical classifyVideoPurpose. A record NEVER appears in both. A CONTENT (or
// unclassified) video is structurally barred from the proposal/outreach workspace (assertNoContentInOutreach).
//
// Proposal videos are grouped by the CANONICAL prospect lifecycle state (we reuse the existing resolver's
// vocabulary — we do NOT invent a parallel state machine). Content videos are grouped by their own content
// lifecycle (needs-narration → rendering → ready → posted), with an honest needs-attention bucket.
// ─────────────────────────────────────────────────────────────────────────────
import { classifyVideoPurpose, outreachBarReason, type VideoPurpose } from "./video-classification";
import { evaluateNarrationQuality, type NarrationQuality } from "./narration-quality";

// The canonical proposal groups shown as sections in the Proposal workspace.
export type ProposalGroup =
  | "needs-narration" | "rendering" | "needs-attention" | "ready-to-approve" | "scheduled" | "sent";
export const PROPOSAL_GROUP_ORDER: ProposalGroup[] = [
  "needs-narration", "rendering", "needs-attention", "ready-to-approve", "scheduled", "sent",
];
export const PROPOSAL_GROUP_LABEL: Record<ProposalGroup, string> = {
  "needs-narration": "Needs narration", rendering: "Rendering", "needs-attention": "Needs attention",
  "ready-to-approve": "Ready to approve", scheduled: "Scheduled", sent: "Sent / history",
};

// The content lifecycle groups shown in the Content workspace (Artifex's own videos — never outreach).
export type ContentGroup = "needs-narration" | "rendering" | "ready" | "posted" | "needs-attention";
export const CONTENT_GROUP_ORDER: ContentGroup[] = ["needs-narration", "rendering", "ready", "posted", "needs-attention"];
export const CONTENT_GROUP_LABEL: Record<ContentGroup, string> = {
  "needs-narration": "Needs narration", rendering: "Rendering", ready: "Ready", posted: "Posted", "needs-attention": "Needs attention",
};

/** The render/lifecycle status the workspace derives its grouping from. Producible from studioSnapshot()
 *  (provenance + jobs) and, for proposals, the canonical prospect lifecycle. */
export type VideoRenderStatus = "needs-narration" | "queued" | "rendering" | "ready" | "failed" | "posted";

/** Canonical prospect lifecycle states (subset used for grouping proposals). Mirrors ProspectState so the
 *  page can pass resolveProspectState()'s output straight through. */
export type ProspectStateLike =
  | "PREPARING_AUTOMATICALLY" | "NEEDS_VOICEOVER" | "RENDERING" | "READY_TO_APPROVE"
  | "SCHEDULED" | "SENT" | "AUTOMATIC_REPAIR" | "NEEDS_ATTENTION" | "AUTOMATICALLY_EXCLUDED";

/** One studio video, reduced to exactly what the workspace needs. The page builds these from studioSnapshot(). */
export interface WorkspaceVideo {
  id: string;                       // piece id ("004", "client-lead_X", "status-meeting")
  businessId?: string | null;
  workflow?: "social" | "prospect" | null;
  title: string;
  businessName?: string | null;
  narration: string;                // joined narration text ("" when none yet)
  evidenceSummary?: string | null;  // one-line finding summary
  findings?: string[];              // verified findings (for quality grading)
  hasScreenshot?: boolean;
  hasApprovedRecommendation?: boolean;
  renderStatus: VideoRenderStatus;
  wordCount?: number;               // optional precomputed; else derived from narration
  packageVersion?: number | null;
  revision?: number | null;
  frozen?: boolean;                 // package is FROZEN/SCHEDULED/SENT (immutable)
  approved?: boolean;
  approvalStale?: boolean;
  prospectState?: ProspectStateLike | null; // canonical lifecycle for proposals (drives grouping)
}

export interface ProposalCard {
  id: string; leadId: string | null; purpose: "PROPOSAL"; group: ProposalGroup;
  businessName: string; evidenceSummary: string | null; narrationPreview: string;
  wordCount: number; estimatedSeconds: number; quality: NarrationQuality; qualityReasons: string[];
  packageVersion: number | null; revision: number | null; videoStatus: VideoRenderStatus;
  frozen: boolean; approved: boolean; nextAction: string;
}
export interface ContentCard {
  id: string; purpose: "CONTENT"; group: ContentGroup; title: string;
  narrationPreview: string; videoStatus: VideoRenderStatus;
}

export interface WorkspaceSplit {
  proposal: { cards: ProposalCard[]; groups: Record<ProposalGroup, ProposalCard[]>; count: number };
  content: { cards: ContentCard[]; groups: Record<ContentGroup, ContentCard[]>; count: number };
  unclassified: WorkspaceVideo[]; // NEEDS_CLASSIFICATION — shown in neither outreach nor content until resolved
}

const wc = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []).length;
const preview = (s: string, n = 160) => { const t = s.trim().replace(/\s+/g, " "); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const purposeOf = (v: WorkspaceVideo): VideoPurpose => classifyVideoPurpose({ id: v.id, businessId: v.businessId, workflow: v.workflow }).purpose;

/** Map a proposal's canonical prospect state (preferred) or render status to a workspace group. */
export function proposalGroupOf(v: WorkspaceVideo): ProposalGroup {
  switch (v.prospectState) {
    case "NEEDS_VOICEOVER": return "needs-narration";
    case "PREPARING_AUTOMATICALLY":
    case "RENDERING":
    case "AUTOMATIC_REPAIR": return "rendering";
    case "READY_TO_APPROVE": return "ready-to-approve";
    case "SCHEDULED": return "scheduled";
    case "SENT": return "sent";
    case "NEEDS_ATTENTION":
    case "AUTOMATICALLY_EXCLUDED": return "needs-attention";
  }
  // Fallback to render status when no canonical lifecycle state was supplied.
  switch (v.renderStatus) {
    case "needs-narration": return "needs-narration";
    case "queued":
    case "rendering": return "rendering";
    case "failed": return "needs-attention";
    case "ready": return "ready-to-approve";
    case "posted": return "sent";
  }
  return "needs-attention";
}

export function contentGroupOf(v: WorkspaceVideo): ContentGroup {
  switch (v.renderStatus) {
    case "needs-narration": return "needs-narration";
    case "queued":
    case "rendering": return "rendering";
    case "ready": return "ready";
    case "posted": return "posted";
    case "failed": return "needs-attention";
  }
  return "needs-attention";
}

function proposalNextAction(v: WorkspaceVideo, group: ProposalGroup, quality: NarrationQuality): string {
  if (v.frozen) return "Frozen — no changes";
  switch (group) {
    case "needs-narration":
      return quality === "TOO_SHORT" || quality === "GENERIC" ? "Expand & personalize the narration" : "Upload narration audio";
    case "rendering": return "Rendering — no action needed";
    case "needs-attention": return "Review the issue and choose a recovery action";
    case "ready-to-approve": return "Review and approve";
    case "scheduled": return "Scheduled — awaiting send";
    case "sent": return "Sent — history only";
  }
}

/** Split every studio video into the two workspaces. Deterministic; a record is in EXACTLY one workspace. */
export function splitWorkspaces(videos: WorkspaceVideo[]): WorkspaceSplit {
  const emptyProposalGroups = () => Object.fromEntries(PROPOSAL_GROUP_ORDER.map((g) => [g, [] as ProposalCard[]])) as Record<ProposalGroup, ProposalCard[]>;
  const emptyContentGroups = () => Object.fromEntries(CONTENT_GROUP_ORDER.map((g) => [g, [] as ContentCard[]])) as Record<ContentGroup, ContentCard[]>;
  const proposal = { cards: [] as ProposalCard[], groups: emptyProposalGroups(), count: 0 };
  const content = { cards: [] as ContentCard[], groups: emptyContentGroups(), count: 0 };
  const unclassified: WorkspaceVideo[] = [];

  for (const v of videos) {
    const purpose = purposeOf(v);
    if (purpose === "NEEDS_CLASSIFICATION") { unclassified.push(v); continue; }
    if (purpose === "CONTENT") {
      const group = contentGroupOf(v);
      const card: ContentCard = { id: v.id, purpose: "CONTENT", group, title: v.title || v.id, narrationPreview: preview(v.narration), videoStatus: v.renderStatus };
      content.cards.push(card); content.groups[group].push(card); content.count++;
      continue;
    }
    // PROPOSAL
    const group = proposalGroupOf(v);
    const q = evaluateNarrationQuality({
      narration: v.narration,
      evidence: { businessName: v.businessName ?? "", findings: v.findings ?? [], hasScreenshot: v.hasScreenshot ?? false, hasApprovedRecommendation: v.hasApprovedRecommendation },
    });
    const card: ProposalCard = {
      id: v.id, leadId: v.businessId ?? (v.id.startsWith("client-") ? v.id.slice("client-".length) : null), purpose: "PROPOSAL", group,
      businessName: v.businessName ?? v.title ?? v.id, evidenceSummary: v.evidenceSummary ?? null,
      narrationPreview: preview(v.narration), wordCount: v.wordCount ?? wc(v.narration), estimatedSeconds: q.estimatedSeconds,
      quality: q.classification, qualityReasons: q.reasons, packageVersion: v.packageVersion ?? null, revision: v.revision ?? null,
      videoStatus: v.renderStatus, frozen: !!v.frozen, approved: !!v.approved, nextAction: proposalNextAction(v, group, q.classification),
    };
    proposal.cards.push(card); proposal.groups[group].push(card); proposal.count++;
  }
  return { proposal, content, unclassified };
}

/** Structural contamination guard (mandate 25 §B5): assert NO content/unclassified video reached the
 *  proposal workspace and NO proposal reached the content workspace. Returns the list of violations
 *  (empty = clean). The page/tests call this to prove zero cross-contamination. */
export function assertNoContentInOutreach(videos: WorkspaceVideo[]): string[] {
  const split = splitWorkspaces(videos);
  const violations: string[] = [];
  for (const c of split.proposal.cards) {
    const bar = outreachBarReason({ id: c.id, businessId: c.leadId ?? undefined });
    if (bar) violations.push(`proposal workspace contains non-proposal video ${c.id}: ${bar}`);
  }
  for (const c of split.content.cards) {
    if (outreachBarReason({ id: c.id }) === null) violations.push(`content workspace contains a proposal-eligible video ${c.id}`);
  }
  return violations;
}
