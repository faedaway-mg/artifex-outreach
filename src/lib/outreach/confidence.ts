// ─────────────────────────────────────────────────────────────────────────────
// Operator confidence — seven honest scores, each with a plain "why" and a
// concrete way to raise it. If confidence is low, we say exactly why. We never
// dress up a weak signal as a strong one.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import type { OutreachConfidence, ConfidenceScore, DecisionMakerIntelligence, OutreachEmail } from "./types";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const band = (score: number): ConfidenceScore["band"] => (score >= 70 ? "Strong" : score >= 45 ? "Adequate" : "Weak");
// For risk, low is good — invert the banding.
const riskBand = (score: number): ConfidenceScore["band"] => (score <= 30 ? "Strong" : score <= 55 ? "Adequate" : "Weak");

function emailRoute(lead: Lead, dm: DecisionMakerIntelligence): boolean {
  return !!(dm.primary?.directEmail || dm.primary?.officeEmail || lead.publicEmail || lead.contactFormUrl);
}

export function buildOutreachConfidence(
  lead: Lead,
  profile: BusinessProfile,
  dm: DecisionMakerIntelligence,
  email: OutreachEmail,
): OutreachConfidence {
  const scores: ConfidenceScore[] = [];
  const opps = profile.opportunities;
  const hasObservation = opps.length > 0;
  const hasStrength = profile.strengths.length > 0;
  const topOppScore = opps[0] ? Math.round(opps[0].confidence.score * 100) : 0;

  // 1 ── Conversation Readiness
  {
    let s = profile.evidenceConfidence * 0.7;
    if (profile.conversationInput.observedFriction) s += 15;
    if (opps.length >= 2) s += 12;
    if (profile.presence.profile !== "invisible") s += 5;
    s = clamp(s);
    scores.push({
      dimension: "Conversation Readiness",
      score: s,
      band: band(s),
      why:
        s >= 70
          ? "You have a concrete, honest observation and enough context to open a real conversation."
          : "There isn't yet a specific-enough observation to anchor a natural opening.",
      howToImprove: s >= 70 ? null : "Refresh the intelligence profile so it surfaces at least one concrete, observed friction to open with.",
    });
  }

  // 2 ── Email Readiness
  {
    let s = 0;
    if (opps.length >= 1) s += 55;
    if (hasStrength) s += 15;
    if (emailRoute(lead, dm)) s += 30;
    s = clamp(s);
    scores.push({
      dimension: "Email Readiness",
      score: s,
      band: band(s),
      why: emailRoute(lead, dm)
        ? "There's a real observation to lead with, a strength to acknowledge, and a way to reach them."
        : "The email is written, but there's no confirmed way to reach the business by email.",
      howToImprove: !emailRoute(lead, dm)
        ? "Find a public email or plan to use the contact form / a first call instead."
        : !hasStrength
          ? "Refresh the profile so there's a genuine strength to acknowledge before observing."
          : null,
    });
  }

  // 3 ── Decision-Maker Confidence
  {
    const s = clamp(dm.confidence);
    scores.push({
      dimension: "Decision-Maker Confidence",
      score: s,
      band: band(s),
      why: dm.note,
      howToImprove: dm.identified ? null : "Use the receptionist call to ask who owns the customer experience, or confirm the owner from a public listing before emailing a named person.",
    });
  }

  // 4 ── Observation Strength
  {
    let s = topOppScore * 0.6 + profile.evidenceConfidence * 0.3;
    if (opps.length >= 3) s += 10;
    s = clamp(s);
    scores.push({
      dimension: "Observation Strength",
      score: s,
      band: band(s),
      why:
        s >= 70
          ? "The observations are grounded in directly-observed public signals, not guesses."
          : "The observations lean on inference more than direct evidence.",
      howToImprove: s >= 70 ? null : "Capture screenshots or add a public data source so the top observations are directly-observed rather than inferred.",
    });
  }

  // 5 ── Relationship Warmth (honestly cold at first touch — that's expected)
  {
    const contacted = !!lead.lastContactAt || ["Contacted", "Follow-Up", "Meeting Booked", "Discovery Complete"].includes(lead.pipelineStage);
    const s = clamp(contacted ? 55 : 15);
    scores.push({
      dimension: "Relationship Warmth",
      score: s,
      band: band(s),
      why: contacted
        ? "There's prior contact to build on — the call can pick up an existing thread."
        : "This is a genuine first touch, so warmth is low by nature. That's expected, not a problem.",
      howToImprove: contacted ? null : "Warmth builds after the email (and optional video) land and the first call happens — send those before calling cold.",
    });
  }

  // 6 ── Risk of Sounding Salesy (lower is better)
  {
    // Our copy is curiosity-first by construction; risk rises when it can't be grounded.
    let risk = 22;
    if (!hasObservation) risk += 30; // generic-sounding without a real observation
    if (!hasStrength) risk += 12; // no genuine acknowledgement to anchor
    if (profile.evidenceConfidence < 40) risk += 12;
    risk = clamp(risk);
    scores.push({
      dimension: "Risk of Sounding Salesy",
      score: risk,
      band: riskBand(risk),
      betterIsLower: true,
      why:
        risk <= 30
          ? "The message leads with a genuine observation and a real strength — it reads as curiosity, not a pitch."
          : "Without a concrete observation to lead with, the message risks reading generic — which reads as selling.",
      howToImprove: risk <= 30 ? null : "Ground the opening in one specific, observed detail so it clearly reads as 'I actually looked at your business.'",
    });
  }

  // 7 ── Trust Score (composite: grounded + acknowledges strength + honest)
  {
    let s = topOppScore * 0.35 + profile.evidenceConfidence * 0.4 + (hasStrength ? 15 : 0) + (hasObservation ? 10 : 0);
    s = clamp(s);
    scores.push({
      dimension: "Trust Score",
      score: s,
      band: band(s),
      why:
        s >= 70
          ? "It acknowledges what's working, states observations honestly, and admits it might be wrong — the ingredients of trust."
          : "There isn't yet enough grounded, acknowledged detail for the message to feel unmistakably trustworthy.",
      howToImprove: s >= 70 ? null : "Strengthen the underlying observations and make sure a real strength is acknowledged before any friction is named.",
    });
  }

  // Composite readiness: average the six 'higher-is-better' scores plus inverted risk.
  const higher = scores.filter((x) => !x.betterIsLower).reduce((a, x) => a + x.score, 0);
  const riskInverted = 100 - (scores.find((x) => x.betterIsLower)?.score ?? 50);
  const overall = clamp((higher + riskInverted) / 7);

  const weakest = [...scores].sort((a, b) => (a.betterIsLower ? 100 - a.score : a.score) - (b.betterIsLower ? 100 - b.score : b.score))[0];
  const summary =
    overall >= 70
      ? "Ready. This reads like someone who genuinely looked — send with confidence."
      : `Send-able, but ${weakest.dimension.toLowerCase()} is the weak link. ${weakest.howToImprove ?? ""}`.trim();

  return { scores, overall, summary };
}
