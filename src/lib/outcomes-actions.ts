"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Outcome Review actions.
//
// An outcome review is how the operator records whether a recommendation actually
// worked. It always begins "Awaiting Review" — nothing is ever marked successful on
// its own. The verdict (Supported / Mixed / Not Supported / Insufficient Evidence) is
// always the operator's, and only makes sense once an observation and evidence exist.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { insertOutcomeReview, updateOutcomeReview, outcomeReviewsForLead, snapshotsForLead, appendAudit } from "./repo";
import type { MemoryConfidence, OutcomeStatus } from "./types";
import { OUTCOME_STATUSES, MEMORY_CONFIDENCES } from "./types";
import { parseSnapshot, beforeStateFromSnapshot } from "./engagement";

function touch(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/outcomes`);
  revalidatePath(`/leads/${leadId}/roadmap`);
}
const asStatus = (v: unknown): OutcomeStatus | null => (OUTCOME_STATUSES as readonly string[]).includes(String(v)) ? (v as OutcomeStatus) : null;
const asConfidence = (v: unknown): MemoryConfidence => (MEMORY_CONFIDENCES as readonly string[]).includes(String(v)) ? (v as MemoryConfidence) : "Low";

/** Open an outcome review for a completed recommendation. Idempotent; starts Awaiting Review. */
export async function startOutcomeReviewAction(leadId: string, recommendationId: string, title: string, expectedOutcome: string): Promise<void> {
  if (!leadId || !recommendationId) return;
  const existing = (await outcomeReviewsForLead(leadId)).find((r) => r.recommendationId === recommendationId);
  if (existing) return;
  // Pull the immutable baseline captured at commitment as the "before" state.
  const snaps = (await snapshotsForLead(leadId)).filter((s) => s.recommendationId === recommendationId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const baseline = snaps[0] ? parseSnapshot(snaps[0].payload) : null;
  const beforeState = baseline ? beforeStateFromSnapshot(baseline) : "";
  const item = await insertOutcomeReview({
    leadId, recommendationId, title: title || recommendationId,
    status: "Awaiting Review",
    expectedOutcome: expectedOutcome || "",
    beforeState, observedOutcome: "", evidence: "", unexpectedConsequences: "", lessonsLearned: "",
    confidence: "Low", reviewedAt: null, operatorNotes: null,
  });
  await appendAudit({ action: "outcome.start", actor: "jordan", targetType: "outcome", targetId: item.id, meta: { recommendationId }, ip: null });
  touch(leadId);
}

/** Save the operator's observations. Does not change the verdict. */
export async function saveOutcomeReviewAction(id: string, leadId: string, formData: FormData): Promise<void> {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  await updateOutcomeReview(id, {
    expectedOutcome: get("expectedOutcome"),
    beforeState: get("beforeState"),
    observedOutcome: get("observedOutcome"),
    evidence: get("evidence"),
    unexpectedConsequences: get("unexpectedConsequences"),
    lessonsLearned: get("lessonsLearned"),
    confidence: asConfidence(formData.get("confidence")),
  });
  touch(leadId);
}

/** Record the verdict — the operator's call, never automatic. */
export async function setOutcomeStatusAction(id: string, leadId: string, statusRaw: string): Promise<void> {
  const status = asStatus(statusRaw);
  if (!status) return;
  await updateOutcomeReview(id, { status, reviewedAt: status === "Awaiting Review" ? null : new Date().toISOString() });
  await appendAudit({ action: "outcome.status", actor: "jordan", targetType: "outcome", targetId: id, meta: { status }, ip: null });
  touch(leadId);
}
