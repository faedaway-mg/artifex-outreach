"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Server actions for the Quick Review operator editor (M2). Every action derives the ACTOR
// SERVER-SIDE from the session (never trusts a client-supplied identity), and approval requires a
// signed-in operator. These are thin, auditable wrappers over review-revisions.ts — the safety
// logic (version binding, evidence protection, artifact binding) lives there and is unit-tested.
// ─────────────────────────────────────────────────────────────────────────────
import { currentActor } from "../auth";
import {
  saveDraft, recordPreview, runEditorialCheck, approveRevision, deliveryReadiness,
  proposeRegeneration, acceptRegeneration, effectiveReviewFor, getEditorialState,
  type ReviewOverlay, type RegenField, type RegenProposal,
} from "./review-revisions";

/** A signed-in operator? currentActor() returns the real signer or "system" for background work. */
function signedInOperator(): string | null {
  const a = currentActor();
  return a && a !== "system" ? a : null;
}

export async function saveDraftAction(leadId: string, overlay: ReviewOverlay, expectedBaseRevisionId?: string | null) {
  const actor = signedInOperator();
  if (!actor) return { ok: false, reason: "Sign in to edit this review." };
  return saveDraft(leadId, overlay, { expectedBaseRevisionId, actor }); // actor is server-derived
}

export async function previewAction(leadId: string) {
  return recordPreview(leadId, { actor: currentActor() });
}

export async function runCheckAction(leadId: string) {
  return runEditorialCheck(leadId, { actor: currentActor() });
}

export async function approveAction(leadId: string, expectedRevisionId?: string) {
  const actor = signedInOperator();
  // Individual operator approval is REQUIRED — an unauthenticated/background caller can never approve.
  return approveRevision(leadId, { authorized: Boolean(actor), actor: actor ?? "system", expectedRevisionId });
}

export async function readinessAction(leadId: string) {
  return deliveryReadiness(leadId);
}

/** The editor's read model: the effective (overlay-applied) review + its editorial state + readiness. */
export async function editorStateAction(leadId: string) {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return null;
  const readiness = await deliveryReadiness(leadId);
  return { review: eff.review, state: await getEditorialState(leadId), readiness };
}

export async function proposeRegenAction(leadId: string, field: RegenField, direction?: string) {
  const actor = signedInOperator();
  if (!actor) return { ok: false, reason: "Sign in to use regeneration." };
  return proposeRegeneration(leadId, field, direction, { actor });
}

export async function acceptRegenAction(leadId: string, proposal: RegenProposal) {
  const actor = signedInOperator();
  if (!actor) return { ok: false, reason: "Sign in to accept a proposal." };
  return acceptRegeneration(leadId, proposal, { actor });
}

export async function skipAction(leadId: string, reason: string) {
  const actor = signedInOperator();
  if (!actor) return { ok: false, reason: "Sign in to hold a review." };
  const { skipReview } = await import("./review-revisions");
  return skipReview(leadId, reason, { actor });
}

export async function revisitAction(leadId: string) {
  const actor = signedInOperator();
  if (!actor) return { ok: false, reason: "Sign in to revisit a review." };
  const { revisitReview } = await import("./review-revisions");
  return revisitReview(leadId, { actor });
}
