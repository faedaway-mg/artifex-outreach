// ─────────────────────────────────────────────────────────────────────────────
// A single, unmistakable INTERNAL TEST business that flows through the REAL email
// pipeline (Today → Emails to send → EmailDecision → Approve & Send → Resend →
// emailSends ledger), so the operator can prove the production send/reply loop
// without ever emailing a real prospect.
//
// It is NOT a provider shortcut: it creates an ordinary email-first lead + a Business
// Technology Review + a review_and_send task, exactly like a real lead. It is marked
// source="internal-test" and never reaches "Won", so it does not contaminate metrics,
// and it carries no acquisition plan, so no unattended/sequenced send can fire.
//
// The recipient is REQUIRED and operator-supplied — never guessed — and can never be
// hello@artifexlabs.tech (the sender) or a malformed address.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import { insertLead, updateLead, listLeads, upsertBusinessIntelligence, allTasks, insertTask } from "../repo";
import { analyzeBusiness } from "../intelligence/engine";

export const TEST_LEAD_NAME = "TEST — Acquisition OS Email";
export const TEST_LEAD_SOURCE = "internal-test";
const SENDER = "hello@artifexlabs.tech";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface SeedResult {
  leadId: string;
  businessName: string;
  recipient: string;
  taskId: string;
  reused: boolean;
}

/**
 * Create (or reuse) the internal email-test lead pointed at an operator-controlled
 * recipient. Idempotent: re-running updates the recipient and guarantees exactly one
 * open review_and_send task — it never spawns duplicates.
 */
export async function createEmailTestLead(recipient: string): Promise<SeedResult> {
  const to = (recipient ?? "").trim();
  if (!EMAIL_RE.test(to)) throw new Error("A valid operator-controlled recipient email is required.");
  if (to.toLowerCase() === SENDER) throw new Error("The test recipient must NOT be the sender (hello@artifexlabs.tech) — use a mailbox you can reply FROM.");

  // Reuse an existing internal-test lead if one is already present.
  const existing = (await listLeads()).find((l) => l.source === TEST_LEAD_SOURCE && l.businessName === TEST_LEAD_NAME);
  let lead: Lead;
  let reused = false;
  if (existing) {
    reused = true;
    await updateLead(existing.id, { publicEmail: to, pipelineStage: "Qualified" });
    lead = { ...existing, publicEmail: to };
  } else {
    lead = await insertLead(newTestLead(to));
  }

  // A Business Technology Review must exist for the email to compose + send.
  const bi = await analyzeBusiness({ lead, findings: [], contacts: [] });
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: new Date().toISOString() });

  // Exactly one open review_and_send task, surfaced ahead of the pack so a full queue
  // never starves the test item. Deduped so re-running does not pile up tasks.
  const open = (await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open" && t.type === "review_and_send");
  let taskId: string;
  if (open.length > 0) {
    taskId = open[0].id;
  } else {
    const task = await insertTask({
      leadId: lead.id,
      type: "review_and_send",
      title: `Send personalized review — ${TEST_LEAD_NAME}`,
      dueAt: new Date().toISOString(),
      status: "open",
      priority: 100, // high, so it appears first in "Emails to send"
      snoozedUntil: null,
    });
    taskId = task.id;
  }

  return { leadId: lead.id, businessName: lead.businessName, recipient: to, taskId, reused };
}

function newTestLead(recipient: string): Omit<Lead, "id" | "createdAt" | "updatedAt"> {
  const now = new Date().toISOString();
  return {
    googlePlaceId: null,
    businessName: TEST_LEAD_NAME,
    normalizedName: "test acquisition os email",
    industry: "Internal test",
    normalizedCategory: "internal-test",
    categoryGroup: "Internal",
    address: "Artifex Labs, Los Angeles, CA",
    city: "Los Angeles",
    state: "CA",
    postalCode: "90012",
    latitude: null,
    longitude: null,
    phone: null, // no phone → email-first strategy → lands in "Emails to send"
    website: null,
    websiteDomain: null,
    publicEmail: recipient,
    contactFormUrl: null,
    socialLinks: [],
    locationsCount: 1,
    rating: 5,
    reviewCount: 25,
    businessStatus: "OPERATIONAL",
    googleMapsUrl: "",
    hours: null,
    source: TEST_LEAD_SOURCE,
    retrievedAt: now,
    tier: "A",
    leadScore: 80,
    scoreBreakdown: {} as Lead["scoreBreakdown"],
    pipelineStage: "Qualified",
    estimatedValueLow: 0,
    estimatedValueHigh: 0,
    recommendedService: "Business Website System",
    recommendedAction: "Send personalized email",
    recommendationReason: "Internal test lead (not a real prospect).",
    opportunitySummary: "Internal test lead.",
    strengths: [],
    acquisitionStrategy: "Assisted",
    acquisitionScore: 60,
    acquisitionReason: "Internal test.",
    acquisitionScoreBreakdown: null,
    acquisitionOverride: false,
    assignedTo: "jordan",
    assignedAt: now,
    assignmentReason: "Internal test lead.",
    lastOperatorActivityAt: null,
    note: "INTERNAL TEST LEAD — created to verify the Acquisition OS email send/reply loop. Safe to archive after the controlled test.",
    lastContactAt: null,
    nextFollowUpAt: null,
  };
}
