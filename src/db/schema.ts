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
]);
export const confidenceEnum = pgEnum("confidence", ["Verified", "Likely", "Unknown"]);

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
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ leadIdx: index("deliverables_lead_idx").on(t.leadId) }),
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
