// Outreach Experience v2 — public surface.
export * from "./types";
export { inferDecisionMakers, type EnrichmentSource } from "./decision-maker";
export { buildOutreachEmail, buildFollowUpEmail, buildSubjectLines, buildVideoScript, singular } from "./content";
export { buildPhoneGuide, buildDiscoveryPlan } from "./conversation";
export { buildOutreachConfidence } from "./confidence";
export { computeNextAction, freshState } from "./next-action";
export { buildOutreachKit, type OutreachKitInput } from "./kit";
