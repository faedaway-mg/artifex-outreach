// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT ARCHITECTURE VIEW — the non-secret, presentation-ready shape that answers
// "which mail system does which job" for the operator. It composes the Google Workspace
// prospect-lanes read-model with a Resend transactional presence flag and the constant
// Microsoft 365 business mailbox, then exposes PURE helpers that map each of those to a
// single display status string. Keeping the mapping pure makes it deterministically
// testable without a DOM (the repo has no @testing-library/react).
//
// SECRET SAFETY: this file only ever handles booleans, non-secret addresses, and
// counters. It never reads or returns an API key, token, or client secret value.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProspectLaneView, ProspectLanesView } from "@/lib/comms/google-workspace/prospect-lanes";

/** The constant Microsoft 365 business mailbox — Acquisition OS never sends prospect outreach from it. */
export const BUSINESS_MAILBOX = {
  address: "hello@artifexlabs.tech",
  provider: "Microsoft 365 / Outlook",
} as const;

/** The full non-secret payload the /api/prospect-transport route returns and the dashboard renders. */
export interface ProspectTransportView {
  prospect: ProspectLanesView;
  transactional: { provider: "resend"; configured: boolean };
  businessMailbox: { address: string; provider: string };
}

/** A single, unambiguous health word for one outbound lane. Precedence: most-specific first. */
export type LaneDisplayStatus = "Healthy" | "Cooling down" | "At cap" | "Disabled" | "Unconfigured";

/**
 * Map one lane to its operator-facing status word. Pure + deterministic so it can be unit-tested.
 * Precedence (most-specific first): unconfigured → disabled → cooling → at-cap → healthy.
 */
export function laneDisplayStatus(
  lane: Pick<ProspectLaneView, "configured" | "authenticated" | "enabled" | "healthy" | "sentToday" | "cap" | "cooldownUntil">,
  now: Date = new Date(),
): LaneDisplayStatus {
  if (!lane.configured || !lane.authenticated) return "Unconfigured";
  if (!lane.enabled) return "Disabled";
  const cooling = !!lane.cooldownUntil && lane.cooldownUntil > now.toISOString();
  if (cooling) return "Cooling down";
  if (lane.sentToday >= lane.cap) return "At cap";
  return "Healthy";
}

/** Human title for one lane, e.g. "Google Workspace Lane A". */
export function laneTitle(lane: Pick<ProspectLaneView, "label">): string {
  return `Google Workspace Lane ${lane.label}`;
}

/** "N / cap sent today" for one lane. */
export function laneSentSummary(lane: Pick<ProspectLaneView, "sentToday" | "cap">): string {
  return `${lane.sentToday} / ${lane.cap} sent today`;
}

/** Resend transactional status word. */
export function transactionalDisplayStatus(t: { configured: boolean }): "Healthy" | "Not configured" {
  return t.configured ? "Healthy" : "Not configured";
}
