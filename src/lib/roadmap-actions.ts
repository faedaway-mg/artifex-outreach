"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Implementation Journal actions.
//
// Every lifecycle transition is an explicit operator decision — this action IS the
// approval. Nothing advances on its own; the system never creates projects or moves
// work forward without a click. Status is validated against the known lifecycle.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { setRoadmapStatus, appendAudit } from "./repo";
import type { RoadmapStatus } from "./types";
import { ROADMAP_STATUSES } from "./types";

const asStatus = (v: unknown): RoadmapStatus | null =>
  (ROADMAP_STATUSES as readonly string[]).includes(String(v)) ? (v as RoadmapStatus) : null;

function touch(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/roadmap`);
  revalidatePath(`/leads/${leadId}/reasoning`);
}

/** Move one recommendation to a new lifecycle status — the operator's approval. */
export async function advanceRoadmapAction(leadId: string, recommendationId: string, title: string, statusRaw: string): Promise<void> {
  const status = asStatus(statusRaw);
  if (!status || !leadId || !recommendationId) return;
  const item = await setRoadmapStatus(leadId, recommendationId, title || recommendationId, status);
  await appendAudit({ action: "roadmap.status", actor: "jordan", targetType: "roadmap", targetId: item.id, meta: { recommendationId, status }, ip: null });
  touch(leadId);
}
