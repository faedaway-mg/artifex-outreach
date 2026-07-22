"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Relationship Memory actions.
//
// Knowledge is earned. Nothing is auto-promoted: a new item starts as "Proposed"
// unless the operator explicitly confirms it. Every item keeps its provenance
// (source) and confidence, and can be verified, superseded, or resolved by hand.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { insertMemoryItem, updateMemoryItem, deleteMemoryItem, appendAudit } from "./repo";
import type { MemoryCategory, MemoryConfidence, MemorySource, MemoryStatus } from "./types";
import { MEMORY_CATEGORIES, MEMORY_CONFIDENCES, MEMORY_SOURCES, MEMORY_STATUSES } from "./types";

function touch(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/relationship`);
  revalidatePath(`/leads/${leadId}/discovery`);
}
const asCategory = (v: unknown): MemoryCategory => (MEMORY_CATEGORIES as readonly string[]).includes(String(v)) ? (v as MemoryCategory) : "Open Questions";
const asConfidence = (v: unknown): MemoryConfidence => (MEMORY_CONFIDENCES as readonly string[]).includes(String(v)) ? (v as MemoryConfidence) : "Medium";
const asSource = (v: unknown): MemorySource => (MEMORY_SOURCES as readonly string[]).includes(String(v)) ? (v as MemorySource) : "Discovery Meeting";
const asStatus = (v: unknown): MemoryStatus | null => ((MEMORY_STATUSES as readonly string[]).includes(String(v)) ? (v as MemoryStatus) : null);

/** Promote a discovery / note into structured memory. Starts Proposed unless the
 * operator explicitly used Manual Confirmation. */
export async function addMemoryAction(leadId: string, formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  if (!title || !value) return;
  const source = asSource(formData.get("source"));
  const status: MemoryStatus = source === "Manual Confirmation" ? "Verified" : "Proposed";
  const item = await insertMemoryItem({
    leadId,
    category: asCategory(formData.get("category")),
    title,
    value,
    status,
    confidence: asConfidence(formData.get("confidence")),
    source,
    supportingContext: String(formData.get("supportingContext") ?? "").trim() || null,
    operatorNotes: null,
  });
  await appendAudit({ action: "memory.add", actor: "jordan", targetType: "memory", targetId: item.id, meta: { category: item.category, source, status }, ip: null });
  touch(leadId);
}

/** Approve a memory the detection layer surfaced during a live meeting.
 * The operator has read it (and possibly edited it) — but nothing is auto-verified:
 * it lands as "Proposed", carrying the exact words that produced it as provenance. */
export async function saveDetectedMemoryAction(
  leadId: string,
  input: { category: string; title: string; value: string; confidence: string; quote: string },
): Promise<void> {
  const title = input.title.trim();
  const value = input.value.trim();
  if (!title || !value) return;
  const item = await insertMemoryItem({
    leadId,
    category: asCategory(input.category),
    title,
    value,
    status: "Proposed", // earned — the operator verifies later, never automatic
    confidence: asConfidence(input.confidence),
    source: "Discovery Meeting",
    supportingContext: input.quote.trim() || null,
    operatorNotes: null,
  });
  await appendAudit({ action: "memory.detect", actor: "jordan", targetType: "memory", targetId: item.id, meta: { category: item.category, source: "Discovery Meeting", status: "Proposed" }, ip: null });
  touch(leadId);
}

/** Verify / supersede / resolve — the operator earns the status change. */
export async function setMemoryStatusAction(id: string, leadId: string, statusRaw: string): Promise<void> {
  const status = asStatus(statusRaw);
  if (!status) return;
  await updateMemoryItem(id, { status });
  await appendAudit({ action: "memory.status", actor: "jordan", targetType: "memory", targetId: id, meta: { status }, ip: null });
  touch(leadId);
}

export async function updateMemoryAction(id: string, leadId: string, formData: FormData): Promise<void> {
  const value = String(formData.get("value") ?? "").trim();
  const operatorNotes = String(formData.get("operatorNotes") ?? "").trim() || null;
  await updateMemoryItem(id, { ...(value ? { value } : {}), operatorNotes });
  touch(leadId);
}

export async function deleteMemoryAction(id: string, leadId: string): Promise<void> {
  await deleteMemoryItem(id);
  await appendAudit({ action: "memory.delete", actor: "jordan", targetType: "memory", targetId: id, meta: {}, ip: null });
  touch(leadId);
}
