// Content Studio — the ONE place the two workflows are told apart (mandate I). A piece is either a social
// "Field Note" or a business-bound "Prospect Video Sales Package". Historically this was recomputed inline
// as `id.startsWith("client-")` at ~13 call sites; this replaces those with a single typed discriminator.
//
// Prefer the PERSISTED `workflow` field; fall back to the durable signals (a business binding, or the
// client- id prefix) so pre-existing pieces classify correctly with no backfill migration required.
export type StudioWorkflow = "social" | "prospect";

export function workflowOf(p: { workflow?: StudioWorkflow | null; businessId?: string | null; id?: string | null }): StudioWorkflow {
  if (p.workflow === "social" || p.workflow === "prospect") return p.workflow;
  if (p.businessId != null && p.businessId !== "") return "prospect";
  if (typeof p.id === "string" && p.id.startsWith("client-")) return "prospect";
  return "social";
}

export function isProspectVideo(p: { workflow?: StudioWorkflow | null; businessId?: string | null; id?: string | null }): boolean {
  return workflowOf(p) === "prospect";
}
export function isSocialFieldNote(p: { workflow?: StudioWorkflow | null; businessId?: string | null; id?: string | null }): boolean {
  return workflowOf(p) === "social";
}

// Human-facing section label per workflow (mandate I: "Prospect video packages" / direct language).
export const WORKFLOW_LABEL: Record<StudioWorkflow, string> = {
  social: "Field Note",
  prospect: "Prospect video package",
};
