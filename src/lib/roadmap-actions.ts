"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Implementation Journal actions.
//
// Every lifecycle transition is an explicit operator decision — this action IS the
// approval. Nothing advances on its own; the system never creates projects or moves
// work forward without a click. Status is validated against the known lifecycle.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import {
  setRoadmapStatus, appendAudit,
  getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead,
  roadmapProgressForLead, outcomeReviewsForLead, outreachForLead, inboundForLead,
  snapshotsForLead, insertEngagementSnapshot,
} from "./repo";
import type { RoadmapStatus } from "./types";
import { ROADMAP_STATUSES } from "./types";
import { assembleEngagementContext, composeSnapshot } from "./engagement";
import { currentActor } from "@/lib/auth";

const asStatus = (v: unknown): RoadmapStatus | null =>
  (ROADMAP_STATUSES as readonly string[]).includes(String(v)) ? (v as RoadmapStatus) : null;

// Committing to work — Approved or In Progress — freezes an immutable "before".
const CAPTURE_TRIGGERS = new Set<RoadmapStatus>(["Approved", "In Progress"]);

function touch(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/roadmap`);
  revalidatePath(`/leads/${leadId}/reasoning`);
  revalidatePath(`/leads/${leadId}/command`);
  revalidatePath(`/leads/${leadId}/outcomes`);
}

/** Capture the immutable baseline for a recommendation, once per (rec, trigger). */
async function captureBaseline(leadId: string, recommendationId: string, trigger: RoadmapStatus): Promise<void> {
  const existing = await snapshotsForLead(leadId);
  if (existing.some((s) => s.recommendationId === recommendationId && s.trigger === trigger)) return; // never overwrite history
  const lead = await getLead(leadId);
  if (!lead) return;
  const [memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots] = await Promise.all([
    memoryForLead(leadId), meetingsForLead(leadId), proposalsForLead(leadId), plansForLead(leadId),
    roadmapProgressForLead(leadId), outcomeReviewsForLead(leadId), outreachForLead(leadId), inboundForLead(leadId), snapshotsForLead(leadId),
  ]);
  const ctx = assembleEngagementContext({ lead, memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, now: Date.now() });
  const payload = composeSnapshot(ctx, recommendationId, trigger);
  const snap = await insertEngagementSnapshot({ leadId, recommendationId, trigger, payload: JSON.stringify(payload) });
  await appendAudit({ action: "snapshot.capture", actor: currentActor(), targetType: "snapshot", targetId: snap.id, meta: { recommendationId, trigger }, ip: null });
}

/** Move one recommendation to a new lifecycle status — the operator's approval. */
export async function advanceRoadmapAction(leadId: string, recommendationId: string, title: string, statusRaw: string): Promise<void> {
  const status = asStatus(statusRaw);
  if (!status || !leadId || !recommendationId) return;
  const item = await setRoadmapStatus(leadId, recommendationId, title || recommendationId, status);
  await appendAudit({ action: "roadmap.status", actor: currentActor(), targetType: "roadmap", targetId: item.id, meta: { recommendationId, status }, ip: null });
  if (CAPTURE_TRIGGERS.has(status)) await captureBaseline(leadId, recommendationId, status);
  touch(leadId);
}
