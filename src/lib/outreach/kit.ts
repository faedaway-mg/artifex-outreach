// ─────────────────────────────────────────────────────────────────────────────
// buildOutreachKit — one call, one lead, the complete relationship kit.
//
// This is the promise made real: the operator opens a lead and already knows
// exactly what to say — email, subject, phone guide, discovery, video, decision
// maker, and honest confidence. Deterministic. Grounded. Nothing is sent.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Contact, Settings } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import type { BusinessImprovementPotential } from "../improvement";
import type { OutreachKit, DecisionMaker, OutreachState } from "./types";
import { inferDecisionMakers } from "./decision-maker";
import { buildOutreachEmail, buildFollowUpEmail, buildVideoScript } from "./content";
import { buildPhoneGuide, buildDiscoveryPlan } from "./conversation";
import { buildOutreachConfidence } from "./confidence";
import { computeNextAction, freshState } from "./next-action";

export interface OutreachKitInput {
  lead: Lead;
  profile: BusinessProfile;
  settings: Settings;
  contacts?: Contact[];
  improvement?: BusinessImprovementPotential | null;
  /** Real, publicly-sourced decision-makers from a wired EnrichmentSource (optional). */
  enrichedDecisionMakers?: DecisionMaker[];
  /** Live outreach state (what's been sent/opened/replied). Omit for a fresh lead. */
  outreachState?: OutreachState;
}

export function buildOutreachKit(input: OutreachKitInput): OutreachKit {
  const { lead, profile, settings, contacts = [], improvement, enrichedDecisionMakers = [] } = input;

  const decisionMaker = inferDecisionMakers(lead, contacts, enrichedDecisionMakers);
  const email = buildOutreachEmail(lead, profile, decisionMaker, settings);
  const followUp = buildFollowUpEmail(lead, profile, decisionMaker, settings);
  const phone = buildPhoneGuide(lead, profile, decisionMaker);
  const discovery = buildDiscoveryPlan(lead, profile);
  const confidence = buildOutreachConfidence(lead, profile, decisionMaker, email);

  // A personal video is worth Jordan's time only for genuinely high-value fits.
  const value = lead.estimatedValueHigh ?? 0;
  const partnership = improvement?.relationship?.partnershipLikelihood ?? 0;
  const impScore = improvement?.score ?? 0;
  const videoRecommended = profile.opportunities.length > 0 && (value >= 12_000 || partnership >= 0.5 || impScore >= 65);
  const videoReason = videoRecommended
    ? "High-value fit — a 45-second personal video will meaningfully raise the response rate here."
    : profile.opportunities.length === 0
      ? "No concrete observation yet — a video would have nothing honest to show. Skip it."
      : "Lower-value or early-stage — the email alone is the right-sized first touch; save the video for warmer, higher-value leads.";
  const video = videoRecommended ? buildVideoScript(lead, profile) : null;

  // The single next best action — evolves as the operator completes work.
  const state = input.outreachState ?? freshState("", videoRecommended, confidence.overall >= 70);
  const nextAction = computeNextAction(state);

  // Readiness — plainly stated, with the single next best action.
  const blockers: string[] = [];
  const hasRoute = !!(decisionMaker.primary?.directEmail || decisionMaker.primary?.officeEmail || lead.publicEmail || lead.contactFormUrl || lead.phone);
  if (profile.opportunities.length === 0) blockers.push("No concrete observation yet — refresh the intelligence profile before reaching out.");
  if (!hasRoute) blockers.push("No public contact route (email, form, or phone) — this lead needs contact discovery first.");

  const ready = blockers.length === 0;
  const nextBestAction = !ready
    ? blockers[0]
    : !decisionMaker.identified
      ? "Send the email, then call the front desk to find who owns the customer experience — the phone guide handles that exact moment."
      : videoRecommended
        ? "Record the 45-second video, send it with the email, then plan the call for 3–4 days later so it continues the conversation."
        : "Send the email, then plan a follow-up call in 3–4 days — by then the call picks up a conversation the email already started.";

  return {
    leadId: lead.id,
    businessName: lead.businessName,
    generatedAt: null, // caller stamps on persist, for determinism
    nextAction,
    decisionMaker,
    email,
    followUp,
    video,
    videoRecommended,
    videoReason,
    phone,
    discovery,
    confidence,
    readiness: { ready, blockers, nextBestAction },
  };
}
