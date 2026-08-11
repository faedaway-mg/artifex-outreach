"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Public inbound: a Business Technology Review request → the EXISTING Acquisition OS.
//
// The /review front door normalizes an inbound request into the same lead/customer
// model outbound uses — no inbound CRM, no second pipeline. Provenance is preserved via
// the standardized `source` string so we can answer "did this come from Content #001?".
// Sends nothing: it queues an email-first review-and-send task the operator approves.
// Idempotent against duplicates so a double submit never forks a business.
// ─────────────────────────────────────────────────────────────────────────────
import { insertLead, findDuplicate, getLead, updateLead, insertTask, allTasks, appendAudit } from "@/lib/repo";
import { normalizeName, domainFromUrl } from "@/lib/store";
import { categoryMetaForIndustry } from "@/lib/categories";
import { isValidEmail } from "@/lib/outreach/contact-strategy";
import { reviewRequestSource, acquisitionChannelOf, contentIdOf } from "@/lib/acquisition/provenance";
import { assignNewLead } from "@/lib/operators/distribute";

export interface ReviewRequestInput {
  businessName: string;
  website?: string;
  contactName?: string;
  email: string;
  context?: string;
  /** Campaign/content ref from the URL (?ref=content-001). Optional. */
  ref?: string;
}

export interface ReviewRequestResult {
  ok: boolean;
  reason?: string;
  /** True when the request matched an existing business (recorded, not duplicated). */
  deduped?: boolean;
}

const cap = (s: string, n: number) => s.slice(0, n);
const INBOUND_TASK_PRIORITY = 80; // inbound intent tops the operator queue (above follow-ups/calls)

/**
 * Accept a Review request. Public + unauthenticated by design. Validates, dedupes against the
 * existing pipeline, creates (or annotates) a lead with inbound provenance, and queues the
 * email-first review-and-send work the operator approves. Never sends; never overwrites an
 * existing business's original provenance.
 */
export async function requestReviewAction(input: ReviewRequestInput): Promise<ReviewRequestResult> {
  const businessName = cap((input.businessName ?? "").trim(), 200);
  const email = cap((input.email ?? "").trim(), 200);
  const website = cap((input.website ?? "").trim(), 300) || null;
  const contactName = cap((input.contactName ?? "").trim(), 120) || null;
  const context = cap((input.context ?? "").trim(), 2000) || null;

  if (!businessName) return { ok: false, reason: "Please tell us your business name." };
  if (!isValidEmail(email)) return { ok: false, reason: "Please enter a valid email so we can send the review." };

  const source = reviewRequestSource(input.ref);
  const channel = acquisitionChannelOf(source);
  const contentId = contentIdOf(source);
  const stamp = new Date().toISOString();
  const requestNote = [
    `[${stamp.slice(0, 10)}] Inbound Business Technology Review request (${channel}${contentId ? `, ${contentId}` : ""}).`,
    contactName ? `Contact: ${contactName} <${email}>.` : `Contact email: ${email}.`,
    context ? `They said: "${context}"` : null,
  ].filter(Boolean).join("\n");

  // Idempotent: if this business is already in the pipeline, RECORD the inbound request on it
  // (note + audit + ensure review work is queued) rather than forking a duplicate lead.
  const dup = await findDuplicate({ googlePlaceId: null, website, phone: null, businessName });
  if (dup) {
    const fresh = (await getLead(dup.id)) ?? dup;
    const patch: Parameters<typeof updateLead>[1] = {
      note: fresh.note?.trim() ? `${requestNote}\n${fresh.note.trim()}` : requestNote,
    };
    // A verified email they typed themselves is a trustworthy send route — adopt it if missing.
    if (!isValidEmail(fresh.publicEmail)) patch.publicEmail = email;
    await updateLead(dup.id, patch);
    const hasSendTask = (await allTasks()).some((t) => t.leadId === dup.id && t.status === "open" && (t.type === "review_and_send" || t.type === "follow_up"));
    if (!hasSendTask) {
      await insertTask({ leadId: dup.id, type: "review_and_send", title: `Inbound Review request — ${dup.businessName}`, dueAt: stamp, status: "open", priority: INBOUND_TASK_PRIORITY, snoozedUntil: null });
    }
    await appendAudit({ action: "lead.inbound.review_requested", actor: "inbound", targetType: "lead", targetId: dup.id, meta: { channel, contentId, ref: input.ref ?? null, matchedExisting: true, hasWebsite: !!website }, ip: null });
    return { ok: true, deduped: true };
  }

  const meta = categoryMetaForIndustry("Professional consultant"); // refined by enrichment later
  const lead = await insertLead({
    googlePlaceId: null,
    businessName,
    normalizedName: normalizeName(businessName),
    industry: "Professional consultant",
    normalizedCategory: meta.normalizedCategory,
    categoryGroup: meta.group,
    address: "", city: "", state: "", postalCode: "",
    latitude: null, longitude: null,
    phone: null,
    website,
    websiteDomain: domainFromUrl(website),
    publicEmail: email, // they gave it to us directly — a trustworthy, consented send route
    contactFormUrl: null,
    socialLinks: [],
    locationsCount: null,
    rating: null, reviewCount: null,
    businessStatus: "OPERATIONAL",
    googleMapsUrl: null,
    hours: null,
    source, // inbound provenance (channel + content id) — no schema migration needed
    retrievedAt: stamp,
    tier: null, leadScore: null, scoreBreakdown: null,
    // Inbound intent = qualified interest; they asked us to look at their business.
    pipelineStage: "Qualified",
    estimatedValueLow: null, estimatedValueHigh: null,
    recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [],
    acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null,
    acquisitionOverride: false,
    assignedTo: null, assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null,
    note: requestNote,
    lastContactAt: null, nextFollowUpAt: null,
  });

  // Email-first by construction (they gave an email). Queue the review-and-send at inbound
  // priority so it tops the operator's queue. Operator approval / autosend gates unchanged.
  await insertTask({ leadId: lead.id, type: "review_and_send", title: `Inbound Review request — ${businessName}`, dueAt: stamp, status: "open", priority: INBOUND_TASK_PRIORITY, snoozedUntil: null });
  await appendAudit({ action: "lead.inbound.review_requested", actor: "inbound", targetType: "lead", targetId: lead.id, meta: { channel, contentId, ref: input.ref ?? null, matchedExisting: false, hasWebsite: !!website }, ip: null });
  await assignNewLead(lead.id, { actor: "system" });
  return { ok: true };
}
