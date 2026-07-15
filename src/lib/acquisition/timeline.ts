// Builds one unified, chronological acquisition timeline for a lead from existing
// records (no new storage) — discovery → analysis → strategy → approval → reply →
// meeting → proposal → contract → won.
import type {
  Lead, Finding, Deliverable, Video, ConceptPreviewShare, Meeting, Proposal,
  AcquisitionPlan, Outreach, InboundMessage,
} from "../types";

export type TimelineKind =
  | "discovered" | "analyzed" | "brief" | "video" | "concept" | "plan" | "approved" | "stopped"
  | "outreach" | "reply" | "meeting" | "proposal" | "won" | "lost";

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  label: string;
}

export interface TimelineInput {
  lead: Lead;
  findings: Finding[];
  deliverables: Deliverable[];
  videos: Video[];
  shares: ConceptPreviewShare[];
  meetings: Meeting[];
  proposals: Proposal[];
  plans: AcquisitionPlan[];
  outreach: Outreach[];
  inbound: InboundMessage[];
}

export function collectTimeline(i: TimelineInput): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const push = (at: string | null | undefined, kind: TimelineKind, label: string) => { if (at) ev.push({ at, kind, label }); };

  push(i.lead.createdAt, "discovered", `Lead discovered (${i.lead.source})`);
  const analyzed = i.findings.map((f) => f.analyzedAt).filter(Boolean).sort()[0];
  push(analyzed, "analyzed", `Website analyzed — ${i.findings.length} finding(s)`);

  for (const d of i.deliverables) {
    push(d.createdAt, "brief", `${d.type} prepared`);
    push(d.approvedAt, "brief", `${d.type} approved`);
    push(d.sentAt, "brief", `${d.type} marked sent`);
  }
  for (const v of i.videos) {
    push(v.createdAt, "video", "Video script prepared");
    push(v.sentAt, "video", "Video marked sent");
  }
  for (const s of i.shares) {
    push(s.createdAt, "concept", "Concept preview link created");
    push(s.lastViewedAt, "concept", `Concept preview viewed (${s.viewCount})`);
  }
  for (const p of i.plans) {
    push(p.createdAt, "plan", `Acquisition plan prepared (${p.strategy})`);
    push(p.approvedAt, "approved", "Plan approved");
    if (p.stopReason) push(p.completedAt, "stopped", `Sequence stopped — ${p.stopReason}`);
  }
  for (const o of i.outreach) push(o.sentAt, "outreach", `Outreach sent (${o.channel})`);
  for (const m of i.inbound) push(m.receivedAt, "reply", `Reply received${m.classification ? ` — ${m.classification}` : ""}`);
  for (const m of i.meetings) push(m.scheduledAt, "meeting", "Meeting scheduled");
  for (const p of i.proposals) {
    push(p.sentAt, "proposal", `Proposal sent (${p.amount ? "$" + p.amount.toLocaleString() : "—"})`);
    push(p.acceptedAt, "won", "Proposal accepted");
  }
  if (i.lead.pipelineStage === "Won") push(i.lead.updatedAt, "won", "Marked Won");
  if (i.lead.pipelineStage === "Lost") push(i.lead.updatedAt, "lost", "Marked Lost");

  return ev.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}
