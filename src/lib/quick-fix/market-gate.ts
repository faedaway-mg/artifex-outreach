// ─────────────────────────────────────────────────────────────────────────────
// TARGET-MARKET GATE (Problem-Reality amendment §10, §11, §37, §41, §43).
//
// ONE authoritative target-market registry — the approved Lead Sprint pods (Greenville,
// Huntsville, Chattanooga, Northwest Arkansas + any explicitly-enabled state). A lead
// OUTSIDE the registry is rejected BEFORE any deep analysis: no screenshots, no PDF, no
// TTS, no render. California must NOT qualify unless the registry explicitly enables it.
//
// This is the DISPLAY + GATE helper ("show market on every active card"); the full
// active/legacy/disqualified decision (enterprise / franchise / closed) stays in the
// Lead Sprint classifier (classifyLead) — this module never disagrees with it on geography.
// PURE.
// ─────────────────────────────────────────────────────────────────────────────
import { podForLocation, type PodPriority } from "../lead-sprint/pods";

export interface MarketGate {
  inMarket: boolean;
  /** Stable pod id (e.g. "greenville-sc") or null when out-of-market. */
  podId: string | null;
  /** Human market label for the card ("Greenville region", "Out of market · CA"). */
  label: string;
  priority: PodPriority | "none";
  /** Reason to reject before analysis, when out-of-market. */
  reason: string | null;
}

/**
 * Resolve a lead's market from city/state against the approved pod registry. Out-of-market
 * (e.g. California) fails the gate BEFORE deep analysis. Deterministic + pure.
 */
export function assessMarketGate(loc: { city?: string | null; state?: string | null }): MarketGate {
  const city = loc.city ?? "";
  const state = (loc.state ?? "").trim().toUpperCase();
  const match = podForLocation(city, state);
  if (match.pod) {
    return { inMarket: true, podId: match.pod.id, label: match.pod.label, priority: match.priority, reason: null };
  }
  return {
    inMarket: false,
    podId: null,
    label: state ? `Out of market · ${state}` : "Out of market",
    priority: "none",
    reason: `outside the approved target markets (${state || "unknown"}) — rejected before analysis`,
  };
}

/** Compact market label for a Quick Cash card (§41). */
export function marketLabel(loc: { city?: string | null; state?: string | null }): string {
  const g = assessMarketGate(loc);
  if (g.inMarket) {
    const city = (loc.city ?? "").trim();
    return city ? `${city}, ${(loc.state ?? "").toUpperCase()}` : g.label;
  }
  return g.label;
}
