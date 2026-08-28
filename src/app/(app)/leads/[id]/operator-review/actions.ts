"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Thin REVALIDATING wrappers for the lightweight operator-review UI (Gate 3).
// These add NO business logic — they call the audited, version-bound server actions in
// review-editor-actions.ts and then revalidatePath so the server component re-fetches the
// fresh editor state after each mutation. Reads (editorStateAction) don't need a wrapper.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import {
  previewAction,
  approveAction,
  proposeRegenAction,
  acceptRegenAction,
  skipAction,
  revisitAction,
} from "@/lib/outreach/review-editor-actions";
import type { RegenProposal } from "@/lib/outreach/review-revisions";

function revalidate(leadId: string) {
  revalidatePath(`/leads/${leadId}/operator-review`);
}

export async function previewRevalidate(leadId: string) {
  const res = await previewAction(leadId);
  revalidate(leadId);
  return res;
}

export async function approveRevalidate(leadId: string, expectedRevisionId?: string) {
  const res = await approveAction(leadId, expectedRevisionId);
  revalidate(leadId);
  return res;
}

export async function proposeRegenHookRevalidate(leadId: string) {
  // The simplified milestone regenerates exactly the opening hook — a single, honest control.
  return proposeRegenAction(leadId, { part: "openingHook" });
}

export async function acceptRegenRevalidate(leadId: string, proposal: RegenProposal) {
  const res = await acceptRegenAction(leadId, proposal);
  revalidate(leadId);
  return res;
}

export async function skipRevalidate(leadId: string, reason: string) {
  const res = await skipAction(leadId, reason);
  revalidate(leadId);
  return res;
}

export async function revisitRevalidate(leadId: string) {
  const res = await revisitAction(leadId);
  revalidate(leadId);
  return res;
}
