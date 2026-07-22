// ─────────────────────────────────────────────────────────────────────────────
// Outreach Experience v2 — the operator's relationship kit.
//
// One lead → one complete kit. The operator never wonders "what do I say?"; the
// owner never feels sold. Everything here is deterministic and grounded in the
// business's real, observed signals. Nothing is fabricated. Nothing is sent.
// ─────────────────────────────────────────────────────────────────────────────
import type { Confidence } from "../types";

// ── Decision-Maker Intelligence ──────────────────────────────────────────────
export const DECISION_MAKER_ROLES = [
  "Owner",
  "Founder",
  "Practice Owner",
  "Managing Partner",
  "Office Manager",
  "General Manager",
  "Practice Administrator",
  "Operations Manager",
  "Executive Director",
  "Contact", // a real person whose exact authority is unclear
] as const;
export type DecisionMakerRole = (typeof DECISION_MAKER_ROLES)[number];

export type ContactChannel = "direct-email" | "office-email" | "linkedin" | "office-phone" | "contact-form";

export interface DecisionMaker {
  /** Null when a role is inferable but no real person is publicly identifiable. */
  name: string | null;
  role: DecisionMakerRole;
  /** Verified | Likely | Unknown — mirrors the Contact confidence vocabulary. */
  roleConfidence: Confidence;
  /** Where this came from, e.g. "Contact record", "Public listing". Never invented. */
  source: string;
  officeEmail: string | null;
  /** Only when a personal address is legitimately public. */
  directEmail: string | null;
  linkedinUrl: string | null;
  officePhone: string | null;
  /** The order to actually try, best-first, given what is reachable. */
  preferredContactOrder: ContactChannel[];
}

export interface DecisionMakerIntelligence {
  /** False → we say so plainly and never guess. */
  identified: boolean;
  primary: DecisionMaker | null;
  candidates: DecisionMaker[];
  /** 0..100 confidence that we can reach the right person. */
  confidence: number;
  /** Operator-facing line, e.g. "Decision maker could not be confidently identified." */
  note: string;
}

// ── Human outreach email ─────────────────────────────────────────────────────
export interface OutreachEmail {
  subject: string;
  /** 2–4 alternative subject lines, most natural first. */
  subjectAlternatives: string[];
  /** The full plaintext body (content + signature + unsubscribe). */
  body: string;
  /** Content paragraphs only (no footer) — for clean HTML + text rendering. */
  paragraphs: string[];
  wordCount: number;
}

// ── Real send result (from the existing dispatch pipeline) ───────────────────
export type IntroSendOutcome = "sent" | "queued" | "blocked" | "failed";
export interface IntroSendResult {
  outcome: IntroSendOutcome;
  reason?: string;
  providerMessageId?: string | null;
  stepId?: string;
}

// ── A personalized VEED video the operator attaches (never fabricated) ───────
export interface VeedVideo {
  url: string;
  thumbnailUrl: string | null;
  title: string | null;
  durationSeconds: number | null;
}

// ── Personalized video (a script for Jordan to record — never AI-generated) ──
export interface VideoScript {
  opening: string;
  /** Exactly three observations, grounded in real signals. */
  observations: string[];
  question: string;
  close: string;
  /** The short note the video rides in on, in an email. */
  emailVariant: string;
  /** How to reference the video on a follow-up call. */
  phoneVariant: string;
  estimatedSeconds: number;
  /** Assembled teleprompter script. */
  script: string;
}

// ── Adaptive phone conversation guides (guides, not scripts) ─────────────────
export interface GuideBranch {
  /** The situation, e.g. "If they ask what this is regarding". */
  when: string;
  /** What to say — a move, not a line to read verbatim. */
  say: string;
}
export interface GuideStep {
  label: string;
  say: string;
  branches: GuideBranch[];
}
export interface PhoneStage {
  audience: "receptionist" | "decision-maker" | "voicemail";
  title: string;
  goal: string;
  steps: GuideStep[];
  /** Never say these on this call (website / marketing / technology / automation). */
  avoid: string[];
}
export interface PhoneGuide {
  /** The canonical answer to "what is this about?" — about the business, not tech. */
  whatThisIsAbout: string;
  stages: PhoneStage[];
}

// ── Adaptive discovery ───────────────────────────────────────────────────────
export interface DiscoveryQuestion {
  question: string;
  /** Why we're curious — never "to qualify them". */
  intent: string;
  /** The real observation this flows from. */
  basis: string;
}
export interface DiscoveryPlan {
  /** How to frame discovery: curiosity, not interrogation. */
  opening: string;
  questions: DiscoveryQuestion[];
  /** What to listen for while they talk. */
  listenFor: string[];
}

// ── Operator confidence (seven honest scores) ────────────────────────────────
export const OUTREACH_CONFIDENCE_DIMENSIONS = [
  "Conversation Readiness",
  "Email Readiness",
  "Decision-Maker Confidence",
  "Observation Strength",
  "Relationship Warmth",
  "Risk of Sounding Salesy",
  "Trust Score",
] as const;
export type OutreachConfidenceDimension = (typeof OUTREACH_CONFIDENCE_DIMENSIONS)[number];

export interface ConfidenceScore {
  dimension: OutreachConfidenceDimension;
  /** 0..100. For "Risk of Sounding Salesy", lower is better (see betterIsLower). */
  score: number;
  band: "Strong" | "Adequate" | "Weak";
  why: string;
  /** Concrete way to raise it, or null when already strong. */
  howToImprove: string | null;
  betterIsLower?: boolean;
}
export interface OutreachConfidence {
  scores: ConfidenceScore[];
  /** 0..100 composite readiness (risk inverted before averaging). */
  overall: number;
  summary: string;
}

// ── Next Best Action — the progressive workflow ──────────────────────────────
// The Acquisition OS answers one question per lead: "what do I do next?" — with
// exactly one primary action that evolves as work is completed.
export const NEXT_ACTION_KINDS = [
  "prepare-review",
  "record-video",
  "send-intro",
  "wait",
  "send-followup",
  "call",
  "schedule-discovery",
  "prepare-discovery",
  "nurture",
  "blocked",
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export interface SecondaryAction {
  label: string;
  hint?: string;
}

export interface NextAction {
  kind: NextActionKind;
  /** The single imperative, shown large. "Record a 45-second personalized video." */
  title: string;
  /** One human line of why-this-now. */
  why: string;
  /** Button label — an invitation, never pressure. */
  ctaLabel: string;
  /** For wait/tracking states: "Sent 2 days ago · opened · 2 days left". */
  status: string | null;
  /** Supporting detail the operator may want but doesn't need to act. */
  detail: string | null;
  secondary: SecondaryAction[];
  /** 0..1 through the outreach journey, for a calm progress affordance. */
  progress: number;
}

/** What the caller knows about where this lead is. Times are ISO for determinism. */
export interface OutreachState {
  now: string;
  hasReview: boolean;
  videoRecommended: boolean;
  hasVideo: boolean;
  introSentAt: string | null;
  emailOpened: boolean;
  videoViewed: boolean;
  replied: boolean;
  positiveReply: boolean;
  followUpSentAt: string | null;
  callCompletedAt: string | null;
  meetingScheduledAt: string | null;
  discoveryCompleteAt: string | null;
  /** kit.confidence.overall >= 70, or a strong improvement fit. */
  confidenceHigh: boolean;
  /** Days to let a message breathe before the next nudge. Default 4. */
  waitDays?: number;
  suppressed?: boolean;
}

// ── The complete kit ─────────────────────────────────────────────────────────
export interface OutreachKit {
  leadId: string;
  businessName: string;
  generatedAt: string | null;
  /** The one thing to do now — the momentum spine of the whole experience. */
  nextAction: NextAction;
  decisionMaker: DecisionMakerIntelligence;
  email: OutreachEmail;
  /** The brief, human follow-up — never "just checking in". */
  followUp: OutreachEmail;
  /** Present only when a personal video is worth the operator's time. */
  video: VideoScript | null;
  videoRecommended: boolean;
  videoReason: string;
  phone: PhoneGuide;
  discovery: DiscoveryPlan;
  confidence: OutreachConfidence;
  readiness: {
    ready: boolean;
    blockers: string[];
    /** The single next best action, stated plainly. */
    nextBestAction: string;
  };
}
