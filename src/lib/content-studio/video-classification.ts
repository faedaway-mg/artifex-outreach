// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL VIDEO PURPOSE (mandate 25). One classification for every video, derived from STRONG LINEAGE
// (never a filename). Builds on the existing persisted `workflow` field (social|prospect) + the client-<lead>
// pieceId + businessId binding. A record with no business binding, no explicit workflow, and no recognisable
// field-note id is NEEDS_CLASSIFICATION — we never guess an ambiguous record into an outreach product.
// ─────────────────────────────────────────────────────────────────────────────
import type { StudioWorkflow } from "./workflow";

export type VideoPurpose = "PROPOSAL" | "CONTENT" | "NEEDS_CLASSIFICATION";

export interface PurposeLineage {
  id?: string | null;
  businessId?: string | null;          // lead id ⇒ PROPOSAL (strongest signal)
  workflow?: StudioWorkflow | null;    // explicit persisted purpose
}

export interface PurposeVerdict { purpose: VideoPurpose; basis: string }

export function classifyVideoPurpose(p: PurposeLineage): PurposeVerdict {
  // ── PROPOSAL (prospect) — strong lineage first ──
  if (p.businessId != null && p.businessId !== "") return { purpose: "PROPOSAL", basis: "lead/business lineage (businessId)" };
  if (typeof p.id === "string" && p.id.startsWith("client-")) return { purpose: "PROPOSAL", basis: "client-<leadId> pieceId" };
  if (p.workflow === "prospect") return { purpose: "PROPOSAL", basis: "explicit workflow=prospect" };
  // ── CONTENT (Artifex marketing/field-note) ──
  if (p.workflow === "social") return { purpose: "CONTENT", basis: "explicit workflow=social" };
  if (typeof p.id === "string" && /^0*\d+$/.test(p.id)) return { purpose: "CONTENT", basis: "catalog field-note id" };
  if (typeof p.id === "string" && /^[a-z][a-z0-9_-]+$/.test(p.id) && !p.id.startsWith("client-")) return { purpose: "CONTENT", basis: "authored field-note/topic id" };
  // ── Ambiguous — never guessed into an outreach product ──
  return { purpose: "NEEDS_CLASSIFICATION", basis: "ambiguous — no business binding, no workflow, no field-note id" };
}

export const isProposalPurpose = (p: PurposeLineage): boolean => classifyVideoPurpose(p).purpose === "PROPOSAL";
export const isContentPurpose = (p: PurposeLineage): boolean => classifyVideoPurpose(p).purpose === "CONTENT";

/** Structural outreach boundary (mandate 25): a CONTENT (or unclassified) video may NEVER enter a prospect
 *  package, Ready-to-Approve, scheduling, the allocator, or dispatch. Returns the reason it's barred, or null
 *  if it is a legitimate PROPOSAL video. Outreach code should call this before treating a piece as sendable. */
export function outreachBarReason(p: PurposeLineage): string | null {
  const { purpose } = classifyVideoPurpose(p);
  if (purpose === "PROPOSAL") return null;
  return purpose === "CONTENT" ? "content video — never enters outreach" : "unclassified video — must be classified before outreach";
}
