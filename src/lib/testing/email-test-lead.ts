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
const PLACEHOLDER_DOMAINS = /@(example\.(com|org|net)|test\.com|email\.com)$/i;

/** The bare email from a "Name <email>" header — matches dispatch's addressOnly. */
function addressOnly(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** Every address that must never be a test recipient: the sender in all its forms. */
function blockedRecipients(): Set<string> {
  const out = new Set<string>([SENDER]);
  if (process.env.RESEND_FROM) out.add(addressOnly(process.env.RESEND_FROM));
  return out;
}

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
  if (!EMAIL_RE.test(to) || PLACEHOLDER_DOMAINS.test(to)) {
    throw new Error("Enter a real email address you personally control.");
  }
  if (blockedRecipients().has(to.toLowerCase())) {
    throw new Error("The test recipient must NOT be the sender (hello@artifexlabs.tech) — use a mailbox you can reply FROM.");
  }

  const tasks = await allTasks();
  const openTaskFor = (leadId: string) =>
    tasks.find((t) => t.leadId === leadId && t.status === "open" && t.type === "review_and_send");

  // Prefer a PENDING test lead (one that still has an open, not-yet-sent review task):
  // repeated button presses before sending just update it — never a duplicate. If the
  // only test lead has already been sent (its task is done), rotate to a FRESH lead so the
  // next controlled run has a clean send state; the prior lead's emailSends stay immutable.
  const candidates = (await listLeads()).filter((l) => l.source === TEST_LEAD_SOURCE);
  const pending = candidates.find((l) => openTaskFor(l.id));

  let lead: Lead;
  let reused = false;
  if (pending) {
    reused = true;
    await updateLead(pending.id, { publicEmail: to, pipelineStage: "Qualified" });
    lead = { ...pending, publicEmail: to };
  } else {
    lead = await insertLead(newTestLead(to));
  }

  // A Business Technology Review must exist for the email to compose + send.
  const bi = await analyzeBusiness({ lead, findings: [], contacts: [] });
  await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: new Date().toISOString() });

  // Exactly one open review_and_send task, high-priority so a full queue never starves it.
  const existingOpen = openTaskFor(lead.id);
  const taskId = existingOpen
    ? existingOpen.id
    : (await insertTask({
        leadId: lead.id,
        type: "review_and_send",
        title: `Send personalized review — ${TEST_LEAD_NAME}`,
        dueAt: new Date().toISOString(),
        status: "open",
        priority: 100,
        snoozedUntil: null,
      })).id;

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
