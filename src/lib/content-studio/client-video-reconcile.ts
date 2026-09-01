// Server-only reconciliation between a client video and its Today prepare_video task (section C).
// Kept separate from the pure counting logic (client-video-tasks.ts) so that module stays
// DB-free and unit-testable. Completing the video in Content Studio must remove the Today task.

import { allTasks, updateTask } from "@/lib/repo";
import { leadIdFromClientPiece } from "./client-video-routing";

/**
 * Mark any OPEN `prepare_video` task for a lead as done. Idempotent — a lead with no open
 * prepare_video task is a no-op. Returns the number of tasks completed (for reconciliation counts).
 */
export async function completeVideoTaskForLead(leadId: string): Promise<number> {
  const open = (await allTasks()).filter((t) => t.leadId === leadId && t.type === "prepare_video" && t.status === "open");
  for (const t of open) await updateTask(t.id, { status: "done" });
  return open.length;
}

/**
 * When a Content Studio piece is posted, if it is a client video (`client-<leadId>`), complete
 * the corresponding Today prepare_video task. Non-client pieces (Field Notes) are a no-op.
 */
export async function reconcileTaskOnClientVideoPosted(pieceId: string): Promise<number> {
  const leadId = leadIdFromClientPiece(pieceId);
  if (!leadId) return 0;
  return completeVideoTaskForLead(leadId);
}
