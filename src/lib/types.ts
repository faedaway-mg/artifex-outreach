// ─────────────────────────────────────────────────────────────────────────────
// Domain types & enums for Artifex Outreach.
// Single source of truth shared by the store, adapters, UI, and Zod schemas.
// ─────────────────────────────────────────────────────────────────────────────
// Type-only imports (erased at runtime — no import cycle) for the persisted
// Business Intelligence record.
import type { BusinessIntelligence } from "./intelligence/engine";
import type { EnrichmentDelta } from "./intelligence/enrichment-delta";

export const PIPELINE_STAGES = [
  "Discovered",
  "Qualified",
  "Analysis Ready",
  "Deliverable Ready",
  "Contacted",
  "Follow-Up",
  "Meeting Booked",
  "Discovery Complete",
  "Proposal Sent",
  "Won",
  "Lost",
  "Nurture",
  "Disqualified",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const TIERS = ["A", "B", "C"] as const;
export type Tier = (typeof TIERS)[number];

export const ARTIFEX_SERVICES = [
  "Launch Website",
  "Business Website System",
  "Automation Sprint",
  "AI Operations System",
  "Product or MVP Build",
  "Visual Asset System",
  "Product Strategy Engagement",
] as const;
export type ArtifexService = (typeof ARTIFEX_SERVICES)[number];

export const NEXT_ACTIONS = [
  "Prepare video",
  "Send personalized email",
  "Call",
  "Visit",
  "Nurture",
  "Skip",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const FINDING_TYPES = [
  "Verified fact",
  "Automated technical finding",
  "AI inference",
  "Jordan-approved recommendation",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const CONFIDENCE = ["Verified", "Likely", "Unknown"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const DELIVERABLE_TYPES = ["Quick Snapshot", "Modernization Brief"] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const DELIVERABLE_STATUS = ["draft", "approved", "sent"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUS)[number];

export const VIDEO_STATUS = ["not_started", "script_ready", "recorded", "ready", "sent"] as const;
export type VideoStatus = (typeof VIDEO_STATUS)[number];

export const OUTREACH_STATUS = ["draft", "approved", "sent"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUS)[number];

export const OUTREACH_CHANNELS = ["email", "call", "visit", "linkedin"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const RESPONSE_STATUS = ["none", "replied", "opted_out", "bounced"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUS)[number];

export const TASK_TYPES = [
  "review",
  "prepare_video",
  "review_and_send",
  "call",
  "follow_up",
  "prepare_meeting",
  "prepare_proposal",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUS = ["open", "done", "snoozed", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const MEETING_OUTCOME = [
  "pending",
  "completed",
  "follow_up_required",
  "proposal_required",
  "not_a_fit",
  "nurture",
] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOME)[number];

export const PROPOSAL_STATUS = ["draft", "sent", "accepted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

// ── Score breakdown ──────────────────────────────────────────────────────────
export interface ScoreBreakdown {
  businessFit: number; // /20
  websiteOpportunity: number; // /20
  automationOpportunity: number; // /20
  abilityToPay: number; // /15
  publicReputation: number; // /10
  contactability: number; // /10
  triggerUrgency: number; // /5
}

export const SCORE_MAX: ScoreBreakdown = {
  businessFit: 20,
  websiteOpportunity: 20,
  automationOpportunity: 20,
  abilityToPay: 15,
  publicReputation: 10,
  contactability: 10,
  triggerUrgency: 5,
};

export const SCORE_LABELS: Record<keyof ScoreBreakdown, string> = {
  businessFit: "Business fit",
  websiteOpportunity: "Website opportunity",
  automationOpportunity: "Automation opportunity",
  abilityToPay: "Ability to pay",
  publicReputation: "Public reputation",
  contactability: "Contactability",
  triggerUrgency: "Trigger / urgency",
};

// ── Entities ─────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  googlePlaceId: string | null;
  businessName: string;
  normalizedName: string;
  industry: string;
  normalizedCategory: string | null;
  categoryGroup: string | null;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  websiteDomain: string | null;
  publicEmail: string | null;
  contactFormUrl: string | null;
  socialLinks: string[];
  locationsCount: number | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string | null;
  googleMapsUrl: string | null;
  hours: string | null;
  source: string;
  retrievedAt: string | null;
  tier: Tier | null;
  leadScore: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  pipelineStage: PipelineStage;
  estimatedValueLow: number | null;
  estimatedValueHigh: number | null;
  recommendedService: ArtifexService | null;
  recommendedAction: NextAction | null;
  recommendationReason: string | null;
  opportunitySummary: string | null;
  strengths: string[];
  acquisitionStrategy: AcquisitionStrategy | null;
  acquisitionScore: number | null;
  acquisitionReason: string | null;
  acquisitionScoreBreakdown: AcquisitionScoreBreakdown | null;
  acquisitionOverride: boolean;
  assignedTo: string;
  note: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  leadId: string;
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
  confidence: Confidence;
  verified: boolean;
  optedOut: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  id: string;
  leadId: string;
  category: string;
  title: string;
  observation: string;
  evidence: string;
  businessImpact: string;
  modernizationDirection: string;
  findingType: FindingType;
  confidence: Confidence;
  sourceUrl: string | null;
  analyzedAt: string | null;
  deterministic: boolean;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Screenshot {
  id: string;
  leadId: string;
  pageUrl: string;
  viewport: "mobile" | "desktop";
  storageUrl: string;
  storageKey: string | null;
  caption: string;
  approved: boolean;
  createdAt: string;
}

export interface DeliverableContent {
  cover: { subtitle: string; confidentialityNote: string };
  executiveSnapshot: {
    overview: string;
    whatIsWorking: string;
    primaryOpportunity: string;
    potentialImpact: string;
    recommendedFirstConversation: string;
  };
  strengths: string[];
  opportunities: Array<{
    observation: string;
    evidence: string;
    businessConsequence: string;
    modernizationDirection: string;
  }>;
  customerJourney: { currentState: string[]; futureState: string[] };
  modernizationPath: {
    primaryEngagement: ArtifexService;
    components: string[];
    secondaryOpportunity: string;
    investmentRange: string | null; // null until Jordan approves sharing
    disclaimer: string;
  };
  cta: { headline: string; body: string };
}

export interface Deliverable {
  id: string;
  leadId: string;
  type: DeliverableType;
  status: DeliverableStatus;
  content: DeliverableContent;
  pdfUrl: string | null;
  pdfKey: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  aiMeta: AiMeta | null;
  createdAt: string;
  updatedAt: string;
}

export interface Video {
  id: string;
  leadId: string;
  title: string;
  recommendedLength: string;
  positiveOpening: string;
  findings: string[];
  screenshotIds: string[];
  script: string;
  cta: string;
  accompanyingEmail: string;
  followUpDate: string | null;
  videoUrl: string | null;
  status: VideoStatus;
  sentAt: string | null;
  aiMeta: AiMeta | null;
  createdAt: string;
  updatedAt: string;
}

export interface Outreach {
  id: string;
  leadId: string;
  contactId: string | null;
  channel: OutreachChannel;
  subject: string;
  body: string;
  status: OutreachStatus;
  sentAt: string | null;
  responseStatus: ResponseStatus;
  aiMeta: AiMeta | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  leadId: string;
  type: TaskType;
  title: string;
  dueAt: string;
  status: TaskStatus;
  priority: number; // higher = more urgent
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  leadId: string;
  contactId: string | null;
  scheduledAt: string;
  meetingUrl: string | null;
  discoveryQuestions: string[];
  likelyObjections: string[];
  notes: string;
  nextStep: string;
  outcome: MeetingOutcome;
  createdAt: string;
  updatedAt: string;
}

export interface Proposal {
  id: string;
  leadId: string;
  status: ProposalStatus;
  amount: number | null;
  proposalUrl: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Suppression {
  id: string;
  email: string | null;
  domain: string | null;
  phone: string | null;
  reason: string;
  createdAt: string;
}

// ── Concept Website Preview ──────────────────────────────────────────────────
export const PREVIEW_TYPES = ["Quick Direction", "Homepage Concept", "Focused Conversion Page", "Modernization Story"] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

export const PREVIEW_STATUSES = [
  "Not Started", "Preparing Facts", "Drafting", "Generated", "Internal Review",
  "Approved", "Shared", "Viewed", "Conversation Started", "Archived", "Revoked",
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const VISUAL_DIRECTIONS = [
  "Quiet Professional", "Warm Modern", "Premium Editorial", "Local Trust", "Clear Utility",
  "Refined Hospitality", "Contemporary Wellness", "Confident Trade", "Boutique Retail", "Founder-Led",
] as const;
export type VisualDirection = (typeof VISUAL_DIRECTIONS)[number];

export const TARGET_ACTIONS = [
  "Book a consultation", "Request a quote", "Schedule service", "Explore membership",
  "View a venue", "Start intake", "Contact us",
] as const;
export type TargetAction = (typeof TARGET_ACTIONS)[number];

export type FactStatus = "confirmed" | "jordan" | "inference" | "placeholder" | "omitted";
export interface ApprovedFact {
  key: string;
  label: string;
  value: string;
  status: FactStatus;
}

export interface ConceptPreview {
  id: string;
  leadId: string;
  title: string;
  previewType: PreviewType;
  status: PreviewStatus;
  visualDirection: VisualDirection;
  targetAction: TargetAction;
  recommendedService: string | null;
  eligibilityReason: string | null;
  sourceFacts: ApprovedFact[];
  approvedFacts: ApprovedFact[];
  selectedFindingIds: string[];
  generatedSpecification: unknown | null;
  currentVersionId: string | null;
  generationCount: number;
  totalGenerationCost: number;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
}

export interface ConceptPreviewVersion {
  id: string;
  previewId: string;
  versionNumber: number;
  specification: unknown;
  renderedHtml: string;
  renderedCss: string;
  desktopScreenshotPath: string | null;
  mobileScreenshotPath: string | null;
  tabletScreenshotPath: string | null;
  generationProvider: string;
  generationModel: string;
  generationCost: number;
  validationResults: unknown;
  createdAt: string;
}

export interface ConceptPreviewShare {
  id: string;
  previewId: string;
  versionId: string;
  tokenHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

// ── Tiered acquisition automation ────────────────────────────────────────────
export const ACQUISITION_STRATEGIES = ["Personal", "Assisted", "Light", "Nurture", "Manual Review", "Do Not Contact"] as const;
export type AcquisitionStrategy = (typeof ACQUISITION_STRATEGIES)[number];

export const ASSET_PACKAGES = ["Premium", "Focused", "Essential", "Nurture", "None"] as const;
export type AssetPackage = (typeof ASSET_PACKAGES)[number];

export const ACQ_CHANNELS = ["email", "call", "social-manual", "referral", "none"] as const;
export type AcqChannel = (typeof ACQ_CHANNELS)[number];

export const PLAN_APPROVAL = ["draft", "pending", "approved", "held", "rejected"] as const;
export type PlanApproval = (typeof PLAN_APPROVAL)[number];

export const PLAN_STATUS = ["prepared", "active", "paused", "completed", "stopped"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

export interface AcquisitionScoreBreakdown {
  opportunityValue: number; // /25
  need: number; // /20
  contactability: number; // /20
  trustStability: number; // /15
  personalization: number; // /10
  costToPursue: number; // /10 (higher = cheaper to pursue)
}

export interface AcquisitionPlan {
  id: string;
  leadId: string;
  strategy: AcquisitionStrategy;
  objective: string;
  assetPackage: AssetPackage;
  primaryChannel: AcqChannel;
  secondaryChannel: AcqChannel | null;
  status: PlanStatus;
  approvalStatus: PlanApproval;
  currentStep: number;
  maxTouches: number;
  nextScheduledAt: string | null;
  replyState: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  pauseReason: string | null;
  stopReason: string | null;
  estimatedCost: number;
  // Immutable context frozen at approval time (null until approved / if unavailable).
  estimatedValueSnapshot: string | null;
  assetReadinessSnapshot: boolean | null;
  assetMissingSnapshot: string[] | null;
  contactConfidenceSnapshot: string | null;
  websiteHealthSnapshot: string | null;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcquisitionStep {
  id: string;
  planId: string;
  stepNumber: number;
  channel: AcqChannel;
  delayDays: number;
  subject: string;
  content: string;
  approvalRequired: boolean;
  approvalStatus: PlanApproval;
  scheduledAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  deliveryStatus: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  createdAt: string;
}

export interface InboundMessage {
  id: string;
  leadId: string;
  acquisitionPlanId: string | null;
  provider: string;
  providerMessageId: string | null;
  fromAddr: string;
  subject: string;
  bodyRef: string;
  receivedAt: string;
  classification: string | null;
  confidence: number | null;
  reviewedAt: string | null;
}

// ── Communication layer ──────────────────────────────────────────────────────
export const EMAIL_SEND_STATES = ["queued", "sending", "sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed", "failed"] as const;
export type EmailSendStatus = (typeof EMAIL_SEND_STATES)[number];

export interface EmailSend {
  id: string;
  idempotencyKey: string; // "step:<stepId>" — the unit of send-once
  stepId: string | null;
  planId: string | null;
  leadId: string | null;
  toAddr: string;
  fromAddr: string;
  subject: string;
  status: EmailSendStatus;
  provider: string;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  nextAttemptAt: string | null; // set when queued for a retry
  queuedAt: string | null;
  sendingAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  unsubscribedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailEvent {
  id: string;
  providerEventId: string; // unique — dedupes duplicate webhook deliveries
  type: string; // delivered | opened | clicked | bounced | complained | unsubscribed | ...
  providerMessageId: string | null;
  sendId: string | null;
  payload: unknown;
  receivedAt: string;
  processedAt: string | null;
  result: string | null; // applied | duplicate | unmatched | ignored
}

export interface AcquisitionFeedback {
  id: string;
  leadId: string;
  field: string; // "strategy" | "estimatedValue" | "assetPackage" | "priority"
  original: string | null;
  updated: string;
  reason: string;
  user: string;
  createdAt: string;
}

export interface ConsentBasis {
  id: string;
  leadId: string;
  contactId: string | null;
  channel: string;
  basis: string; // e.g. "legitimate-interest", "client", "opt-in"
  source: string;
  capturedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  notes: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface ServiceOffering {
  name: string;
  description: string;
  priceLow: number;
  priceHigh: number;
}

export interface Territory {
  city: string;
  state: string;
}

export const CATEGORY_GROUPS = [
  "Professional Services",
  "Health and Wellness",
  "Home and Property Services",
  "Hospitality and Experiences",
  "Specialty Retail and Local Commerce",
  "Automotive Services",
  "Education and Training",
  "Growth-Stage Businesses",
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORY_PRIORITIES = ["high", "medium", "low"] as const;
export type CategoryPriority = (typeof CATEGORY_PRIORITIES)[number];

// A structured, editable prospecting target. Replaces the flat industries[] while
// staying backward compatible (industries[] is derived from enabled categories).
export interface ProspectCategoryTarget {
  id: string;
  label: string;
  normalizedCategory: string;
  group: CategoryGroup;
  enabled: boolean;
  priority: CategoryPriority;
  dailyNewLeadCap: number;
  weeklyNewLeadCap: number;
  pausedUntil: string | null;
  searchQueries: string[]; // Google text queries (default: [label])
  excludedKeywords: string[];
  minRatingOverride: number | null;
  minReviewsOverride: number | null;
  requireWebsiteOverride: boolean | null;
  requirePhoneOverride: boolean | null;
  lastSearchedAt: string | null;
  searchesThisWeek: number;
  leadsFoundThisWeek: number;
  leadsQualifiedThisWeek: number;
  weekAnchor: string | null; // ISO date the weekly counters reset from
  notes: string;
}

export const CATEGORY_PRESETS = [
  "Balanced Portfolio",
  "Professional Services",
  "Home Services",
  "Health and Wellness",
  "Retail and Hospitality",
  "High-Ticket Local Services",
  "Custom Mix",
] as const;
export type CategoryPreset = (typeof CATEGORY_PRESETS)[number];

// The persistent "who Artifex targets and how" configuration that drives the
// automatic daily lead engine. Stored inside Settings (jsonb) → editable + durable.
export interface ProspectingProfile {
  enabled: boolean; // automatic daily discovery on/off
  positioning: string;
  services: ServiceOffering[];
  industries: string[];
  excludedIndustries: string[];
  territories: Territory[];
  radiusMiles: number;
  minRating: number;
  minReviews: number;
  requireWebsite: boolean;
  requirePhone: boolean;
  dailyQueueSize: number; // Today target (default 8)
  runTime: string; // "05:30" America/Los_Angeles
  weekdays: number[]; // 0=Sun … 6=Sat
  tierTargetA: number; // max new Tier A per run
  tierTargetB: number; // max new Tier B per run
  exclusionKeywords: string[];
  coolingOffDays: number; // don't re-contact within N days
  lastRunAt: string | null;
  // ── Category portfolio + diversification ────────────────────────────────────
  categories: ProspectCategoryTarget[];
  preset: CategoryPreset;
  maxPerCategoryPerRun: number; // default 2 new leads / category / Today
  minDistinctCategories: number; // default 4
  // ── Cost control ────────────────────────────────────────────────────────────
  dailyRequestBudget: number;
  weeklyRequestBudget: number;
  maxDailyCostUsd: number;
  maxCategoriesPerRun: number;
  maxTerritoriesPerCategory: number;
  maxExaminedPerRun: number;
  maxNewLeadsPerRun: number;
  // ── Scheduler duplicate guard ───────────────────────────────────────────────
  lastScheduledRunDate: string | null; // America/LA YYYY-MM-DD
}

export interface SendingWindow {
  timezone: string; // IANA tz, e.g. "America/Los_Angeles"
  startHour: number; // 0-23 inclusive
  endHour: number; // 0-23 exclusive
  weekdays: number[]; // 0=Sun … 6=Sat
}

export interface Settings {
  businessAddress: string;
  signature: string;
  calendarLink: string;
  website: string;
  contactEmail: string;
  defaultReportLanguage: string;
  defaultPricing: Record<ArtifexService, { low: number; high: number }>;
  followUpTiming: number[]; // days offsets, e.g. [0,3,7,14]
  prospecting: ProspectingProfile;
  // Business-hours window during which the scheduler is allowed to send.
  sendingWindow?: SendingWindow;
  // ── Launch readiness sign-off ───────────────────────────────────────────────
  // The explicit human "would I send this to a real business owner today?"
  // confirmation. Stored so the checklist / validation stay green after sign-off.
  launchReviewConfirmedAt?: string | null;
  launchReviewConfirmedBy?: string | null;
}

export interface ProspectingRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  trigger: string; // "scheduled" | "manual" | "refill" | "find-more" | "replace"
  providerMode: string; // "google" | "mock" | "disabled"
  searchesPerformed: number;
  placesRequests: number;
  examined: number;
  duplicatesRemoved: number;
  excluded: number;
  qualified: number;
  addedToToday: number;
  estimatedCostUsd: number;
  errors: string[];
  addedLeadIds: string[];
  // Category diversification metrics
  categoriesConsidered: string[];
  categoriesSelected: string[];
  selectionReasons: Record<string, string>;
  byCategoryExamined: Record<string, number>;
  byCategoryAdded: Record<string, number>;
  rejectedByCap: number;
  distinctCategoriesAdded: number;
  diversityTargetAchieved: boolean;
  stopReason: string | null;
}

export interface AiMeta {
  provider: string;
  model: string;
  promptVersion: string;
  timestamp: string;
  inputSourceRefs: string[];
}

// ── Follow-up sequence template ──────────────────────────────────────────────
export interface FollowUpStep {
  dayOffset: number;
  label: string;
  message: string;
}

// ── Persisted Business Intelligence ──────────────────────────────────────────
// The full engine output stored per lead, plus scalar columns for fast querying
// and the most recent enrichment delta (what changed on the last regeneration).
export interface StoredBusinessIntelligence {
  id: string;
  leadId: string;
  profile: BusinessIntelligence;
  enrichmentDelta: EnrichmentDelta | null;
  evidenceConfidence: number;
  improvementScore: number;
  treatment: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}
