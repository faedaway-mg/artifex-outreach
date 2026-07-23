// ─────────────────────────────────────────────────────────────────────────────
// Drizzle / PostgreSQL schema — the production data model.
//
// Timestamps use { mode: "string" } so Drizzle reads/writes ISO strings, matching
// the domain types exactly (no Date<->string conversion at the boundary). Column
// JS keys are camelCase and identical to the domain object keys, so rows map 1:1.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { mode: "string" });

export const tierEnum = pgEnum("tier", ["A", "B", "C"]);
export const pipelineStageEnum = pgEnum("pipeline_stage", [
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
  // ── Agreement lifecycle (client-agreement system) ──────────────────────────
  // Coarse operator-facing gates only. Fine-grained agreement sub-status lives on
  // the agreements record (agreement_status), NOT here.
  "Proposal Accepted",
  "Agreement Signed",
  "Deposit Paid",
]);
export const confidenceEnum = pgEnum("confidence", ["Verified", "Likely", "Unknown"]);

// ── Client-agreement system ────────────────────────────────────────────────
export const agreementStatusEnum = pgEnum("agreement_status", [
  "draft",
  "generated",
  "approved",
  "sent",
  "viewed",
  "signed",
  "declined",
  "voided",
]);
export const paymentTypeEnum = pgEnum("payment_type", ["deposit", "balance", "monthly"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "link_sent", "paid", "failed", "void"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("operator"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    googlePlaceId: text("google_place_id"),
    businessName: text("business_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    industry: text("industry").notNull(),
    normalizedCategory: text("normalized_category"),
    categoryGroup: text("category_group"),
    address: text("address").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    phone: text("phone"),
    website: text("website"),
    websiteDomain: text("website_domain"),
    publicEmail: text("public_email"),
    contactFormUrl: text("contact_form_url"),
    socialLinks: jsonb("social_links").$type<string[]>().default([]).notNull(),
    locationsCount: integer("locations_count"),
    rating: doublePrecision("rating"),
    reviewCount: integer("review_count"),
    businessStatus: text("business_status"),
    googleMapsUrl: text("google_maps_url"),
    hours: text("hours"),
    source: text("source").notNull().default("manual"),
    retrievedAt: ts("retrieved_at"),
    tier: tierEnum("tier"),
    leadScore: integer("lead_score"),
    scoreBreakdown: jsonb("score_breakdown"),
    pipelineStage: pipelineStageEnum("pipeline_stage").notNull().default("Discovered"),
    estimatedValueLow: integer("estimated_value_low"),
    estimatedValueHigh: integer("estimated_value_high"),
    recommendedService: text("recommended_service"),
    recommendedAction: text("recommended_action"),
    recommendationReason: text("recommendation_reason"),
    opportunitySummary: text("opportunity_summary"),
    strengths: jsonb("strengths").$type<string[]>().default([]).notNull(),
    acquisitionStrategy: text("acquisition_strategy"),
    acquisitionScore: integer("acquisition_score"),
    acquisitionReason: text("acquisition_reason"),
    acquisitionScoreBreakdown: jsonb("acquisition_score_breakdown"),
    acquisitionOverride: boolean("acquisition_override").notNull().default(false),
    assignedTo: text("assigned_to").notNull().default("jordan"),
    note: text("note"),
    lastContactAt: ts("last_contact_at"),
    nextFollowUpAt: ts("next_follow_up_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    placeIdx: uniqueIndex("leads_place_id_idx").on(t.googlePlaceId),
    domainIdx: index("leads_domain_idx").on(t.websiteDomain),
    phoneIdx: index("leads_phone_idx").on(t.phone),
    nameIdx: index("leads_normalized_name_idx").on(t.normalizedName),
    stageIdx: index("leads_stage_idx").on(t.pipelineStage),
    followUpIdx: index("leads_follow_up_idx").on(t.nextFollowUpAt),
  }),
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    source: text("source").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("Unknown"),
    verified: boolean("verified").notNull().default(false),
    optedOut: boolean("opted_out").notNull().default(false),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("contacts_lead_idx").on(t.leadId),
    emailIdx: index("contacts_email_idx").on(t.email),
  }),
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    observation: text("observation").notNull(),
    evidence: text("evidence").notNull(),
    businessImpact: text("business_impact").notNull(),
    modernizationDirection: text("modernization_direction").notNull(),
    findingType: text("finding_type").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("Unknown"),
    sourceUrl: text("source_url"),
    analyzedAt: ts("analyzed_at"),
    deterministic: boolean("deterministic").notNull().default(false),
    approved: boolean("approved").notNull().default(false),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("findings_lead_idx").on(t.leadId) }),
);

export const screenshots = pgTable(
  "screenshots",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    pageUrl: text("page_url").notNull(),
    viewport: text("viewport").notNull(),
    storageUrl: text("storage_url").notNull(),
    storageKey: text("storage_key"),
    caption: text("caption").notNull().default(""),
    approved: boolean("approved").notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({ leadIdx: index("screenshots_lead_idx").on(t.leadId) }),
);

export const deliverables = pgTable(
  "deliverables",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    content: jsonb("content").notNull(),
    pdfUrl: text("pdf_url"),
    pdfKey: text("pdf_key"),
    approvedAt: ts("approved_at"),
    sentAt: ts("sent_at"),
    aiMeta: jsonb("ai_meta"),
    // Automated Quality Control report from the last generation/repair pass.
    qc: jsonb("qc"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("deliverables_lead_idx").on(t.leadId) }),
);

// Persisted Business Intelligence — the full engine profile per lead (jsonb) plus
// scalar columns for fast querying and the last enrichment delta. Additive only.
export const businessIntelligence = pgTable(
  "business_intelligence",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    profile: jsonb("profile").notNull(),
    enrichmentDelta: jsonb("enrichment_delta"),
    evidenceConfidence: integer("evidence_confidence").notNull().default(0),
    improvementScore: integer("improvement_score").notNull().default(0),
    treatment: text("treatment").notNull().default(""),
    generatedAt: ts("generated_at").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("business_intelligence_lead_idx").on(t.leadId) }),
);

export const videos = pgTable(
  "videos",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    title: text("title").notNull(),
    recommendedLength: text("recommended_length").notNull(),
    positiveOpening: text("positive_opening").notNull(),
    findings: jsonb("findings").$type<string[]>().default([]).notNull(),
    screenshotIds: jsonb("screenshot_ids").$type<string[]>().default([]).notNull(),
    script: text("script").notNull(),
    cta: text("cta").notNull(),
    accompanyingEmail: text("accompanying_email").notNull(),
    followUpDate: ts("follow_up_date"),
    videoUrl: text("video_url"),
    status: text("status").notNull().default("not_started"),
    sentAt: ts("sent_at"),
    aiMeta: jsonb("ai_meta"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("videos_lead_idx").on(t.leadId) }),
);

export const outreach = pgTable(
  "outreach",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    contactId: text("contact_id"),
    channel: text("channel").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    status: text("status").notNull().default("draft"),
    sentAt: ts("sent_at"),
    responseStatus: text("response_status").notNull().default("none"),
    aiMeta: jsonb("ai_meta"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("outreach_lead_idx").on(t.leadId) }),
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    dueAt: ts("due_at").notNull(),
    status: text("status").notNull().default("open"),
    priority: integer("priority").notNull().default(0),
    snoozedUntil: ts("snoozed_until"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("tasks_lead_idx").on(t.leadId),
    dueIdx: index("tasks_due_idx").on(t.dueAt),
    statusIdx: index("tasks_status_idx").on(t.status),
  }),
);

export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    contactId: text("contact_id"),
    scheduledAt: ts("scheduled_at").notNull(),
    meetingUrl: text("meeting_url"),
    discoveryQuestions: jsonb("discovery_questions").$type<string[]>().default([]).notNull(),
    likelyObjections: jsonb("likely_objections").$type<string[]>().default([]).notNull(),
    notes: text("notes").notNull().default(""),
    nextStep: text("next_step").notNull().default(""),
    outcome: text("outcome").notNull().default("pending"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("meetings_lead_idx").on(t.leadId) }),
);

export const proposals = pgTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    // Stable human-readable identifier, e.g. "AL-P-2026-001". Nullable for rows
    // written before the agreement system; assigned on creation going forward.
    number: text("number"),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    amount: integer("amount"),
    proposalUrl: text("proposal_url"),
    sentAt: ts("sent_at"),
    acceptedAt: ts("accepted_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("proposals_lead_idx").on(t.leadId) }),
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    domain: text("domain"),
    phone: text("phone"),
    reason: text("reason").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({
    emailIdx: index("suppressions_email_idx").on(t.email),
    domainIdx: index("suppressions_domain_idx").on(t.domain),
  }),
);

// Single-row app settings (id = "singleton").
export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ── Tiered acquisition automation ────────────────────────────────────────────
export const acquisitionPlans = pgTable(
  "acquisition_plans",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    strategy: text("strategy").notNull(),
    objective: text("objective").notNull().default(""),
    assetPackage: text("asset_package").notNull().default("None"),
    primaryChannel: text("primary_channel").notNull().default("none"),
    secondaryChannel: text("secondary_channel"),
    status: text("status").notNull().default("prepared"),
    approvalStatus: text("approval_status").notNull().default("draft"),
    currentStep: integer("current_step").notNull().default(0),
    maxTouches: integer("max_touches").notNull().default(0),
    nextScheduledAt: ts("next_scheduled_at"),
    replyState: text("reply_state"),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    startedAt: ts("started_at"),
    pausedAt: ts("paused_at"),
    completedAt: ts("completed_at"),
    pauseReason: text("pause_reason"),
    stopReason: text("stop_reason"),
    estimatedCost: doublePrecision("estimated_cost").notNull().default(0),
    estimatedValueSnapshot: text("estimated_value_snapshot"),
    assetReadinessSnapshot: boolean("asset_readiness_snapshot"),
    assetMissingSnapshot: jsonb("asset_missing_snapshot").$type<string[]>(),
    contactConfidenceSnapshot: text("contact_confidence_snapshot"),
    websiteHealthSnapshot: text("website_health_snapshot"),
    owner: text("owner").notNull().default("jordan"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("acquisition_plans_lead_idx").on(t.leadId), statusIdx: index("acquisition_plans_status_idx").on(t.approvalStatus) }),
);

export const acquisitionSteps = pgTable(
  "acquisition_steps",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull(),
    stepNumber: integer("step_number").notNull(),
    channel: text("channel").notNull(),
    delayDays: integer("delay_days").notNull().default(0),
    subject: text("subject").notNull().default(""),
    content: text("content").notNull().default(""),
    html: text("html"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    approvalStatus: text("approval_status").notNull().default("draft"),
    scheduledAt: ts("scheduled_at"),
    sentAt: ts("sent_at"),
    providerMessageId: text("provider_message_id"),
    deliveryStatus: text("delivery_status"),
    stoppedAt: ts("stopped_at"),
    stopReason: text("stop_reason"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({ planIdx: index("acquisition_steps_plan_idx").on(t.planId) }),
);

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    acquisitionPlanId: text("acquisition_plan_id"),
    provider: text("provider").notNull().default("resend"),
    providerMessageId: text("provider_message_id"),
    fromAddr: text("from_addr").notNull().default(""),
    subject: text("subject").notNull().default(""),
    bodyRef: text("body_ref").notNull().default(""),
    receivedAt: ts("received_at").notNull(),
    classification: text("classification"),
    confidence: doublePrecision("confidence"),
    reviewedAt: ts("reviewed_at"),
  },
  (t) => ({ leadIdx: index("inbound_messages_lead_idx").on(t.leadId) }),
);

export const acquisitionFeedback = pgTable(
  "acquisition_feedback",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    field: text("field").notNull(),
    original: text("original"),
    updated: text("updated").notNull(),
    reason: text("reason").notNull().default(""),
    user: text("user").notNull().default("jordan"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({ leadIdx: index("acquisition_feedback_lead_idx").on(t.leadId) }),
);

export const consentBases = pgTable(
  "consent_bases",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    contactId: text("contact_id"),
    channel: text("channel").notNull(),
    basis: text("basis").notNull(),
    source: text("source").notNull().default(""),
    capturedAt: ts("captured_at").notNull(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    notes: text("notes").notNull().default(""),
  },
  (t) => ({ leadIdx: index("consent_bases_lead_idx").on(t.leadId) }),
);

// ── Concept Website Preview ──────────────────────────────────────────────────
export const conceptPreviews = pgTable(
  "concept_previews",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    title: text("title").notNull(),
    previewType: text("preview_type").notNull(),
    status: text("status").notNull().default("Not Started"),
    visualDirection: text("visual_direction").notNull(),
    targetAction: text("target_action").notNull(),
    recommendedService: text("recommended_service"),
    eligibilityReason: text("eligibility_reason"),
    sourceFacts: jsonb("source_facts").default([]).notNull(),
    approvedFacts: jsonb("approved_facts").default([]).notNull(),
    selectedFindingIds: jsonb("selected_finding_ids").$type<string[]>().default([]).notNull(),
    generatedSpecification: jsonb("generated_specification"),
    currentVersionId: text("current_version_id"),
    generationCount: integer("generation_count").notNull().default(0),
    totalGenerationCost: doublePrecision("total_generation_cost").notNull().default(0),
    createdBy: text("created_by").notNull().default("jordan"),
    approvedBy: text("approved_by"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    approvedAt: ts("approved_at"),
    archivedAt: ts("archived_at"),
  },
  (t) => ({ leadIdx: index("concept_previews_lead_idx").on(t.leadId) }),
);

export const conceptPreviewVersions = pgTable(
  "concept_preview_versions",
  {
    id: text("id").primaryKey(),
    previewId: text("preview_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    specification: jsonb("specification").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    renderedCss: text("rendered_css").notNull(),
    desktopScreenshotPath: text("desktop_screenshot_path"),
    mobileScreenshotPath: text("mobile_screenshot_path"),
    tabletScreenshotPath: text("tablet_screenshot_path"),
    generationProvider: text("generation_provider").notNull(),
    generationModel: text("generation_model").notNull(),
    generationCost: doublePrecision("generation_cost").notNull().default(0),
    validationResults: jsonb("validation_results"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({ previewIdx: index("concept_preview_versions_preview_idx").on(t.previewId) }),
);

export const conceptPreviewShares = pgTable(
  "concept_preview_shares",
  {
    id: text("id").primaryKey(),
    previewId: text("preview_id").notNull(),
    versionId: text("version_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: ts("last_viewed_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("concept_preview_shares_token_idx").on(t.tokenHash),
    previewIdx: index("concept_preview_shares_preview_idx").on(t.previewId),
  }),
);

// Daily prospecting run reports (metrics; no secrets).
export const prospectingRuns = pgTable(
  "prospecting_runs",
  {
    id: text("id").primaryKey(),
    startedAt: ts("started_at").notNull(),
    completedAt: ts("completed_at"),
    trigger: text("trigger").notNull().default("scheduled"),
    providerMode: text("provider_mode").notNull().default("google"),
    searchesPerformed: integer("searches_performed").notNull().default(0),
    placesRequests: integer("places_requests").notNull().default(0),
    examined: integer("examined").notNull().default(0),
    duplicatesRemoved: integer("duplicates_removed").notNull().default(0),
    excluded: integer("excluded").notNull().default(0),
    qualified: integer("qualified").notNull().default(0),
    addedToToday: integer("added_to_today").notNull().default(0),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().default([]).notNull(),
    addedLeadIds: jsonb("added_lead_ids").$type<string[]>().default([]).notNull(),
    categoriesConsidered: jsonb("categories_considered").$type<string[]>().default([]).notNull(),
    categoriesSelected: jsonb("categories_selected").$type<string[]>().default([]).notNull(),
    selectionReasons: jsonb("selection_reasons").$type<Record<string, string>>().default({}).notNull(),
    byCategoryExamined: jsonb("by_category_examined").$type<Record<string, number>>().default({}).notNull(),
    byCategoryAdded: jsonb("by_category_added").$type<Record<string, number>>().default({}).notNull(),
    rejectedByCap: integer("rejected_by_cap").notNull().default(0),
    distinctCategoriesAdded: integer("distinct_categories_added").notNull().default(0),
    diversityTargetAchieved: boolean("diversity_target_achieved").notNull().default(false),
    stopReason: text("stop_reason"),
  },
  (tbl) => ({ startedIdx: index("prospecting_runs_started_idx").on(tbl.startedAt) }),
);

// Append-only audit trail for sensitive actions.
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    actor: text("actor").notNull().default("jordan"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    ip: text("ip"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({
    actionIdx: index("audit_action_idx").on(t.action),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  }),
);

// ── Communication layer (live sending) ───────────────────────────────────────
// Durable send ledger / outbox. One row per communication step, keyed by a unique
// idempotencyKey so a step can never produce two successful provider sends — even
// across browser refresh, retry, Railway restart, duplicate webhook, or duplicate
// scheduler run. Also the source of truth for conversation state, the retry queue,
// and monitoring aggregates. Contains no message body — only routing + lifecycle.
export const emailSends = pgTable(
  "email_sends",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    stepId: text("step_id"),
    planId: text("plan_id"),
    leadId: text("lead_id"),
    toAddr: text("to_addr").notNull().default(""),
    fromAddr: text("from_addr").notNull().default(""),
    subject: text("subject").notNull().default(""),
    // queued|sending|sent|delivered|opened|clicked|bounced|complained|unsubscribed|failed
    status: text("status").notNull().default("queued"),
    provider: text("provider").notNull().default("resend"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    nextAttemptAt: ts("next_attempt_at"),
    queuedAt: ts("queued_at"),
    sendingAt: ts("sending_at"),
    sentAt: ts("sent_at"),
    deliveredAt: ts("delivered_at"),
    openedAt: ts("opened_at"),
    clickedAt: ts("clicked_at"),
    bouncedAt: ts("bounced_at"),
    complainedAt: ts("complained_at"),
    unsubscribedAt: ts("unsubscribed_at"),
    failedAt: ts("failed_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex("email_sends_key_idx").on(t.idempotencyKey),
    statusIdx: index("email_sends_status_idx").on(t.status),
    providerMsgIdx: index("email_sends_provider_msg_idx").on(t.providerMessageId),
    planIdx: index("email_sends_plan_idx").on(t.planId),
    leadIdx: index("email_sends_lead_idx").on(t.leadId),
  }),
);

// Raw provider webhook events (deliveries/opens/clicks/bounces/complaints). Keyed
// by a unique providerEventId so duplicate webhook deliveries are idempotent — the
// second arrival is recorded as a no-op. Append-only audit of what the provider
// told us + how we applied it.
export const emailEvents = pgTable(
  "email_events",
  {
    id: text("id").primaryKey(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    providerMessageId: text("provider_message_id"),
    sendId: text("send_id"),
    payload: jsonb("payload"),
    receivedAt: ts("received_at").notNull(),
    processedAt: ts("processed_at"),
    result: text("result"), // applied | duplicate | unmatched | ignored
  },
  (t) => ({
    eventIdx: uniqueIndex("email_events_event_idx").on(t.providerEventId),
    msgIdx: index("email_events_msg_idx").on(t.providerMessageId),
  }),
);

// ── Client-agreement system ──────────────────────────────────────────────────
// One master Professional Services Agreement, generated per accepted proposal.
// contentSnapshot is the IMMUTABLE resolved field set frozen at approval — editing
// the lead/proposal/price afterward must never mutate an approved/signed agreement
// (a material change creates a NEW version, a new row). E-sign is delegated to
// SignWell; we only store its identifiers + the returned signed artifacts.
export const agreements = pgTable(
  "agreements",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    proposalId: text("proposal_id").notNull(),
    // Stable human-readable identifier, e.g. "AL-A-2026-001".
    agreementNumber: text("agreement_number").notNull(),
    // Which revision of the master PSA template produced this agreement.
    templateVersion: text("template_version").notNull(),
    // Monotonic version of THIS agreement (a material post-approval change bumps it).
    version: integer("version").notNull().default(1),
    // Points at the agreement this one supersedes (new-version chain), if any.
    supersedesId: text("supersedes_id"),
    supersededById: text("superseded_by_id"),
    status: agreementStatusEnum("status").notNull().default("draft"),
    contentSnapshot: jsonb("content_snapshot").notNull(),
    effectiveDate: text("effective_date"),
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    signerCompany: text("signer_company"),
    pdfKey: text("pdf_key"),
    pdfUrl: text("pdf_url"),
    // Final signed PDF + completion certificate (from SignWell, when available).
    signedPdfKey: text("signed_pdf_key"),
    signedPdfUrl: text("signed_pdf_url"),
    certificateUrl: text("certificate_url"),
    esignProvider: text("esign_provider"),
    esignRequestId: text("esign_request_id"),
    esignUrl: text("esign_url"),
    approvedAt: ts("approved_at"),
    sentAt: ts("sent_at"),
    viewedAt: ts("viewed_at"),
    signedAt: ts("signed_at"),
    declinedAt: ts("declined_at"),
    voidedAt: ts("voided_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("agreements_lead_idx").on(t.leadId),
    proposalIdx: index("agreements_proposal_idx").on(t.proposalId),
    statusIdx: index("agreements_status_idx").on(t.status),
    numberIdx: uniqueIndex("agreements_number_idx").on(t.agreementNumber),
    esignIdx: index("agreements_esign_idx").on(t.esignRequestId),
  }),
);

// Raw e-sign provider webhook events. Keyed by a unique dedupeKey so duplicate
// deliveries are idempotent — the second arrival is a recorded no-op. Append-only.
export const agreementEvents = pgTable(
  "agreement_events",
  {
    id: text("id").primaryKey(),
    agreementId: text("agreement_id").notNull(),
    provider: text("provider").notNull().default("signwell"),
    eventType: text("event_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload"),
    occurredAt: ts("occurred_at").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({
    dedupeIdx: uniqueIndex("agreement_events_dedupe_idx").on(t.dedupeKey),
    agreementIdx: index("agreement_events_agreement_idx").on(t.agreementId),
  }),
);

// Lightweight payment records — deposit collection only (NOT invoicing/accounting).
// The Stripe payment LINK is stored as a URL, mirroring the external-link pattern
// used by proposals. A deposit row is created only when its agreement is signed.
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    agreementId: text("agreement_id").notNull(),
    type: paymentTypeEnum("type").notNull().default("deposit"),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    stripePaymentLinkUrl: text("stripe_payment_link_url"),
    stripeSessionId: text("stripe_session_id"),
    sentAt: ts("sent_at"),
    paidAt: ts("paid_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("payments_lead_idx").on(t.leadId),
    agreementIdx: index("payments_agreement_idx").on(t.agreementId),
    statusIdx: index("payments_status_idx").on(t.status),
  }),
);

// ── Relationship Memory — persistent, provenance-carrying business knowledge ──
export const relationshipMemory = pgTable(
  "relationship_memory",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    value: text("value").notNull(),
    status: text("status").notNull().default("Proposed"),
    confidence: text("confidence").notNull().default("Medium"),
    source: text("source").notNull(),
    supportingContext: text("supporting_context"),
    operatorNotes: text("operator_notes"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("relationship_memory_lead_idx").on(t.leadId),
    categoryIdx: index("relationship_memory_category_idx").on(t.category),
  }),
);

// ── Implementation Journal — operator-approved lifecycle of a recommendation ──
export const roadmapProgress = pgTable(
  "roadmap_progress",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    recommendationId: text("recommendation_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("Recommended"),
    operatorNotes: text("operator_notes"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("roadmap_progress_lead_idx").on(t.leadId),
    recIdx: index("roadmap_progress_rec_idx").on(t.recommendationId),
  }),
);

// ── Outcome Reviews — evidence-grounded record of whether work actually helped ─
export const outcomeReviews = pgTable(
  "outcome_reviews",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    recommendationId: text("recommendation_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("Awaiting Review"),
    expectedOutcome: text("expected_outcome").notNull().default(""),
    beforeState: text("before_state").notNull().default(""),
    observedOutcome: text("observed_outcome").notNull().default(""),
    evidence: text("evidence").notNull().default(""),
    unexpectedConsequences: text("unexpected_consequences").notNull().default(""),
    lessonsLearned: text("lessons_learned").notNull().default(""),
    confidence: text("confidence").notNull().default("Low"),
    reviewedAt: ts("reviewed_at"),
    operatorNotes: text("operator_notes"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    leadIdx: index("outcome_reviews_lead_idx").on(t.leadId),
    recIdx: index("outcome_reviews_rec_idx").on(t.recommendationId),
    statusIdx: index("outcome_reviews_status_idx").on(t.status),
  }),
);

// ── Engagement Snapshots — immutable "before" state (write-once) ──────────────
export const engagementSnapshots = pgTable(
  "engagement_snapshots",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull(),
    recommendationId: text("recommendation_id").notNull(),
    trigger: text("trigger").notNull(),
    payload: text("payload").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => ({
    leadIdx: index("engagement_snapshots_lead_idx").on(t.leadId),
    recIdx: index("engagement_snapshots_rec_idx").on(t.recommendationId),
  }),
);
