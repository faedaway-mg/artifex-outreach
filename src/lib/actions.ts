"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Server actions — every mutation the UI performs. Async throughout (Postgres in
// production). Nothing is sent externally without explicit approval; AI outputs
// are schema-validated in the providers. Sensitive actions write an audit record.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  getLead,
  updateLead,
  insertLead,
  findDuplicate,
  contactsForLead,
  findingsForLead,
  insertFinding,
  updateFinding,
  deleteFinding,
  getFinding,
  screenshotsForLead,
  insertScreenshot,
  deleteScreenshot,
  deliverablesForLead,
  getDeliverable,
  insertDeliverable,
  updateDeliverable,
  videosForLead,
  insertVideo,
  updateVideo,
  outreachForLead,
  insertOutreach,
  updateOutreach,
  getTask,
  updateTask,
  insertMeeting,
  updateMeeting,
  insertProposal,
  updateProposal,
  proposalsForLead,
  getSettings,
  updateSettings,
  addSuppression,
  appendAudit,
} from "./repo";
import { normalizeName, domainFromUrl, reseed } from "./store";
import { hasDb } from "@/db/client";
import {
  qualifyLead,
  summarizeOpportunity,
  recommendService,
  recommendAction,
  generateBrief,
  generateVideoScript,
  generateOutreach,
  generateDiscoveryQuestions,
} from "./providers/ai";
import { analyzeWebsite } from "./providers/website";
import { scheduleFollowUps, stopFollowUps } from "./followups";
import type {
  PipelineStage,
  Tier,
  NextAction,
  DeliverableType,
  DeliverableContent,
  ArtifexService,
  Confidence,
  FindingType,
  OutreachChannel,
  MeetingOutcome,
} from "./types";
import { searchPlaces, placesMode, type PlaceResult, type PlacesSearchResult } from "./providers/places";
import { discoverInputSchema } from "./schemas";

function touch(leadId: string) {
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/discover");
  revalidatePath("/performance");
  revalidatePath(`/leads/${leadId}`);
}

async function audit(action: string, targetType: string | null, targetId: string | null, meta?: Record<string, unknown>) {
  let ip: string | null = null;
  try {
    const h = headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    /* headers() unavailable outside request scope */
  }
  await appendAudit({ action, actor: "jordan", targetType, targetId, meta: meta ?? null, ip });
}

// ── Discover: search ─────────────────────────────────────────────────────────
export async function searchPlacesAction(raw: Record<string, unknown>): Promise<PlacesSearchResult> {
  const parsed = discoverInputSchema.safeParse(raw);
  const timestamp = new Date().toISOString();
  if (!parsed.success) {
    return {
      provider: "none",
      mode: placesMode(),
      success: false,
      results: [],
      count: 0,
      attribution: "",
      timestamp,
      filtersApplied: false,
      pagination: false,
      error: {
        provider: "none",
        success: false,
        httpStatus: null,
        googleStatus: null,
        message: parsed.error.issues[0]?.message ?? "Invalid search input.",
        timestamp,
      },
    };
  }
  return searchPlaces(parsed.data);
}

// ── Discover → save lead ─────────────────────────────────────────────────────
export async function saveLeadFromPlace(place: PlaceResult): Promise<{ id: string; duplicate: boolean }> {
  const dup = await findDuplicate({
    googlePlaceId: place.googlePlaceId,
    website: place.website,
    phone: place.phone,
    businessName: place.businessName,
  });
  if (dup) return { id: dup.id, duplicate: true };

  const lead = await insertLead({
    googlePlaceId: place.googlePlaceId,
    businessName: place.businessName,
    normalizedName: normalizeName(place.businessName),
    industry: place.category,
    address: place.address,
    city: place.city,
    state: place.state,
    postalCode: place.postalCode,
    latitude: place.latitude,
    longitude: place.longitude,
    phone: place.phone,
    website: place.website,
    websiteDomain: domainFromUrl(place.website),
    publicEmail: null,
    contactFormUrl: null,
    socialLinks: [],
    locationsCount: null,
    rating: place.rating,
    reviewCount: place.reviewCount,
    businessStatus: place.businessStatus,
    googleMapsUrl: place.googleMapsUrl,
    hours: place.hours,
    source: place.googlePlaceId.startsWith("MOCK_") ? "Mock (dev)" : "Google Places",
    retrievedAt: new Date().toISOString(),
    tier: null,
    leadScore: null,
    scoreBreakdown: null,
    pipelineStage: "Discovered",
    estimatedValueLow: null,
    estimatedValueHigh: null,
    recommendedService: null,
    recommendedAction: null,
    recommendationReason: null,
    opportunitySummary: null,
    strengths: [],
    assignedTo: "jordan",
    note: null,
    lastContactAt: null,
    nextFollowUpAt: null,
  });
  await audit("lead.create", "lead", lead.id, { businessName: lead.businessName, source: lead.source });
  touch(lead.id);
  return { id: lead.id, duplicate: false };
}

// Manual lead creation (production-safe way to add a real test business).
export async function createManualLeadAction(formData: FormData): Promise<void> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) return;
  const website = String(formData.get("website") ?? "").trim() || null;
  const lead = await insertLead({
    googlePlaceId: null,
    businessName,
    normalizedName: normalizeName(businessName),
    industry: String(formData.get("industry") ?? "Professional consultant"),
    address: String(formData.get("address") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    latitude: null,
    longitude: null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    website,
    websiteDomain: domainFromUrl(website),
    publicEmail: String(formData.get("publicEmail") ?? "").trim() || null,
    contactFormUrl: null,
    socialLinks: [],
    locationsCount: null,
    rating: Number(formData.get("rating")) || null,
    reviewCount: Number(formData.get("reviewCount")) || null,
    businessStatus: "OPERATIONAL",
    googleMapsUrl: null,
    hours: null,
    source: "Manual",
    retrievedAt: new Date().toISOString(),
    tier: null,
    leadScore: null,
    scoreBreakdown: null,
    pipelineStage: "Discovered",
    estimatedValueLow: null,
    estimatedValueHigh: null,
    recommendedService: null,
    recommendedAction: null,
    recommendationReason: null,
    opportunitySummary: null,
    strengths: [],
    assignedTo: "jordan",
    note: null,
    lastContactAt: null,
    nextFollowUpAt: null,
  });
  await audit("lead.create", "lead", lead.id, { businessName, manual: true });
  redirect(`/leads/${lead.id}`);
}

// ── Qualification ────────────────────────────────────────────────────────────
export async function qualifyLeadAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const q = (await qualifyLead(lead)).data;
  const settings = await getSettings();
  const svc = (await recommendService(lead, settings)).data;
  const act = (await recommendAction(lead)).data;
  await updateLead(leadId, {
    leadScore: q.total,
    scoreBreakdown: q.breakdown,
    tier: q.tier,
    recommendedService: svc.service,
    estimatedValueLow: svc.estimatedValueLow,
    estimatedValueHigh: svc.estimatedValueHigh,
    recommendedAction: act.action,
    recommendationReason: act.reason,
    pipelineStage: lead.pipelineStage === "Discovered" ? "Qualified" : lead.pipelineStage,
  });
  touch(leadId);
}

export async function overrideScoreAction(leadId: string, formData: FormData): Promise<void> {
  const score = Number(formData.get("leadScore"));
  const tier = String(formData.get("tier")) as Tier;
  if (!Number.isNaN(score)) await updateLead(leadId, { leadScore: score, tier });
  await audit("lead.score_override", "lead", leadId, { score, tier });
  touch(leadId);
}

export async function overrideActionAction(leadId: string, action: NextAction): Promise<void> {
  await updateLead(leadId, { recommendedAction: action, recommendationReason: `Manually set to "${action}" by Jordan.` });
  touch(leadId);
}

export async function overrideServiceAction(leadId: string, service: ArtifexService): Promise<void> {
  const settings = await getSettings();
  const p = settings.defaultPricing[service];
  await updateLead(leadId, { recommendedService: service, estimatedValueLow: p.low, estimatedValueHigh: p.high });
  touch(leadId);
}

// ── Website analysis ─────────────────────────────────────────────────────────
export async function runWebsiteAnalysisAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const analysis = await analyzeWebsite(lead);

  // Replace previously auto-generated screenshots and unapproved findings on re-run.
  for (const s of await screenshotsForLead(leadId)) await deleteScreenshot(s.id);
  for (const f of (await findingsForLead(leadId)).filter((f) => !f.approved)) await deleteFinding(f.id);

  const analyzedAt = new Date().toISOString();
  for (const s of analysis.screenshots) {
    await insertScreenshot({ leadId, pageUrl: s.pageUrl, viewport: s.viewport, storageUrl: s.storageUrl, storageKey: s.storageKey ?? null, caption: s.caption, approved: true });
  }
  for (const f of analysis.findings) {
    await insertFinding({
      leadId,
      category: f.category,
      title: f.title,
      observation: f.observation,
      evidence: f.evidence,
      businessImpact: f.businessImpact,
      modernizationDirection: f.modernizationDirection,
      findingType: f.findingType,
      confidence: f.confidence,
      sourceUrl: f.sourceUrl ?? lead.website,
      analyzedAt,
      deterministic: f.findingType !== "AI inference",
      approved: false,
    });
  }

  const q = (await qualifyLead(lead, analysis.signals)).data;
  const findings = await findingsForLead(leadId);
  const summary = (await summarizeOpportunity(lead, findings)).data;
  const act = (await recommendAction(lead, analysis.signals)).data;
  await updateLead(leadId, {
    leadScore: q.total,
    scoreBreakdown: q.breakdown,
    tier: q.tier,
    opportunitySummary: summary.summary,
    strengths: summary.strengths,
    recommendedAction: act.action,
    recommendationReason: act.reason,
    pipelineStage: ["Discovered", "Qualified"].includes(lead.pipelineStage) ? "Analysis Ready" : lead.pipelineStage,
  });
  await audit("lead.analyze", "lead", leadId, { performedWith: analysis.performedWith, findings: analysis.findings.length });
  touch(leadId);
}

// ── Findings editor ──────────────────────────────────────────────────────────
export async function toggleFindingApproval(findingId: string, leadId: string): Promise<void> {
  const f = await getFinding(findingId);
  if (f) await updateFinding(findingId, { approved: !f.approved });
  touch(leadId);
}
export async function removeFindingAction(findingId: string, leadId: string): Promise<void> {
  await deleteFinding(findingId);
  touch(leadId);
}
export async function updateFindingAction(findingId: string, leadId: string, formData: FormData): Promise<void> {
  await updateFinding(findingId, {
    title: String(formData.get("title") ?? ""),
    observation: String(formData.get("observation") ?? ""),
    evidence: String(formData.get("evidence") ?? ""),
    businessImpact: String(formData.get("businessImpact") ?? ""),
    modernizationDirection: String(formData.get("modernizationDirection") ?? ""),
    findingType: String(formData.get("findingType") ?? "Jordan-approved recommendation") as FindingType,
    confidence: String(formData.get("confidence") ?? "Likely") as Confidence,
    approved: true,
  });
  touch(leadId);
}
export async function removeScreenshotAction(screenshotId: string, leadId: string): Promise<void> {
  await deleteScreenshot(screenshotId);
  touch(leadId);
}

// ── Deliverable (Modernization Brief) ────────────────────────────────────────
export async function generateBriefAction(leadId: string, type: DeliverableType): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const settings = await getSettings();
  const service = lead.recommendedService ?? "Launch Website";
  const findings = await findingsForLead(leadId);
  const { content, meta } = await generateBrief(lead, findings, settings, type, service, false);
  const deliv = await insertDeliverable({ leadId, type, status: "draft", content, pdfUrl: null, pdfKey: null, approvedAt: null, sentAt: null, aiMeta: meta });
  await updateLead(leadId, {
    pipelineStage: ["Discovered", "Qualified", "Analysis Ready"].includes(lead.pipelineStage) ? "Deliverable Ready" : lead.pipelineStage,
  });
  await audit("deliverable.generate", "deliverable", deliv.id, { type });
  touch(leadId);
}

export async function updateDeliverableAction(deliverableId: string, leadId: string, content: DeliverableContent): Promise<void> {
  await updateDeliverable(deliverableId, { content });
  touch(leadId);
}

export async function setDeliverableRangeAction(deliverableId: string, leadId: string, share: boolean): Promise<void> {
  const d = await getDeliverable(deliverableId);
  if (!d) return;
  const lead = await getLead(leadId);
  const range =
    lead && lead.estimatedValueLow != null && lead.estimatedValueHigh != null
      ? `$${lead.estimatedValueLow.toLocaleString()}–$${lead.estimatedValueHigh.toLocaleString()}`
      : null;
  const content: DeliverableContent = { ...d.content, modernizationPath: { ...d.content.modernizationPath, investmentRange: share ? range : null } };
  await updateDeliverable(deliverableId, { content });
  touch(leadId);
}

export async function approveDeliverableAction(deliverableId: string, leadId: string): Promise<void> {
  // Approval marks the brief ready. The PDF is rendered + persisted to durable
  // storage by the /api/deliverable/[id]/pdf route (Node runtime; keeps the
  // react-pdf renderer out of the server-action bundle).
  await updateDeliverable(deliverableId, { status: "approved", approvedAt: new Date().toISOString() });
  await audit("deliverable.approve", "deliverable", deliverableId);
  touch(leadId);
}
export async function markDeliverableSentAction(deliverableId: string, leadId: string): Promise<void> {
  await updateDeliverable(deliverableId, { status: "sent", sentAt: new Date().toISOString() });
  await audit("deliverable.sent", "deliverable", deliverableId);
  touch(leadId);
}

// ── Video preparation ────────────────────────────────────────────────────────
export async function generateVideoAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const settings = await getSettings();
  const contact = (await contactsForLead(leadId))[0];
  const findings = (await findingsForLead(leadId)).filter((f) => f.approved);
  const used = findings.length ? findings : await findingsForLead(leadId);
  const { data, meta } = await generateVideoScript(lead, used, settings, contact);
  const shots = (await screenshotsForLead(leadId)).map((s) => s.id);
  const followUp = new Date();
  followUp.setDate(followUp.getDate() + 3);
  await insertVideo({
    leadId,
    title: data.title,
    recommendedLength: data.recommendedLength,
    positiveOpening: data.positiveOpening,
    findings: data.findings,
    screenshotIds: shots,
    script: data.script,
    cta: data.cta,
    accompanyingEmail: data.accompanyingEmail,
    followUpDate: followUp.toISOString(),
    videoUrl: null,
    status: "script_ready",
    sentAt: null,
    aiMeta: meta,
  });
  touch(leadId);
}

export async function updateVideoScriptAction(videoId: string, leadId: string, formData: FormData): Promise<void> {
  await updateVideo(videoId, {
    title: String(formData.get("title") ?? ""),
    script: String(formData.get("script") ?? ""),
    cta: String(formData.get("cta") ?? ""),
    accompanyingEmail: String(formData.get("accompanyingEmail") ?? ""),
  });
  touch(leadId);
}
export async function setVideoUrlAction(videoId: string, leadId: string, formData: FormData): Promise<void> {
  const url = String(formData.get("videoUrl") ?? "").trim();
  await updateVideo(videoId, { videoUrl: url || null, status: url ? "recorded" : "script_ready" });
  touch(leadId);
}
export async function markVideoReadyAction(videoId: string, leadId: string): Promise<void> {
  await updateVideo(videoId, { status: "ready" });
  touch(leadId);
}

// ── Outreach ─────────────────────────────────────────────────────────────────
export async function generateOutreachAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const settings = await getSettings();
  const contact = (await contactsForLead(leadId))[0];
  const hasVideo = (await videosForLead(leadId)).some((v) => v.videoUrl);
  const hasBrief = (await deliverablesForLead(leadId)).some((d) => d.status !== "draft");
  const { data, meta } = await generateOutreach(lead, settings, { contact, hasVideo, hasBrief });
  await insertOutreach({
    leadId,
    contactId: contact?.id ?? null,
    channel: "email",
    subject: data.subject,
    body: data.body,
    status: "draft",
    sentAt: null,
    responseStatus: "none",
    aiMeta: meta,
  });
  touch(leadId);
}
export async function updateOutreachAction(outreachId: string, leadId: string, formData: FormData): Promise<void> {
  await updateOutreach(outreachId, { subject: String(formData.get("subject") ?? ""), body: String(formData.get("body") ?? "") });
  touch(leadId);
}
export async function approveOutreachAction(outreachId: string, leadId: string): Promise<void> {
  await updateOutreach(outreachId, { status: "approved" });
  await audit("outreach.approve", "outreach", outreachId);
  touch(leadId);
}
export async function markOutreachSentAction(outreachId: string, leadId: string, channel: OutreachChannel): Promise<void> {
  const lead = await getLead(leadId);
  await updateOutreach(outreachId, { status: "sent", channel, sentAt: new Date().toISOString() });
  await updateLead(leadId, {
    lastContactAt: new Date().toISOString(),
    pipelineStage: lead && ["Deliverable Ready", "Analysis Ready", "Qualified", "Discovered"].includes(lead.pipelineStage) ? "Contacted" : lead?.pipelineStage,
  });
  if (lead) await scheduleFollowUps(lead);
  await audit("outreach.sent", "outreach", outreachId, { channel });
  touch(leadId);
}

export async function markRepliedAction(leadId: string): Promise<void> {
  await stopFollowUps(leadId);
  const lead = await getLead(leadId);
  const latest = (await outreachForLead(leadId)).at(-1);
  if (latest) await updateOutreach(latest.id, { responseStatus: "replied" });
  await updateLead(leadId, { pipelineStage: lead?.pipelineStage === "Contacted" || lead?.pipelineStage === "Follow-Up" ? "Follow-Up" : lead?.pipelineStage });
  touch(leadId);
}

export async function optOutAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  await stopFollowUps(leadId);
  await addSuppression({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone, reason: "Opted out" });
  await updateLead(leadId, { pipelineStage: "Disqualified", recommendedAction: "Skip" });
  const latest = (await outreachForLead(leadId)).at(-1);
  if (latest) await updateOutreach(latest.id, { responseStatus: "opted_out" });
  await audit("contact.opt_out", "lead", leadId);
  touch(leadId);
}

// ── Tasks (Today queue) ──────────────────────────────────────────────────────
export async function completeTaskAction(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  await updateTask(taskId, { status: "done" });
  if (task) touch(task.leadId);
}
export async function snoozeTaskAction(taskId: string, days = 1): Promise<void> {
  const task = await getTask(taskId);
  const until = new Date();
  until.setDate(until.getDate() + days);
  await updateTask(taskId, { snoozedUntil: until.toISOString() });
  if (task) touch(task.leadId);
}
export async function skipTaskAction(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  await updateTask(taskId, { status: "skipped" });
  if (task) touch(task.leadId);
}
export async function markUnqualifiedAction(leadId: string, taskId?: string): Promise<void> {
  await updateLead(leadId, { pipelineStage: "Disqualified", recommendedAction: "Skip" });
  if (taskId) await updateTask(taskId, { status: "skipped" });
  await audit("lead.disqualify", "lead", leadId);
  touch(leadId);
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
export async function changeStageAction(leadId: string, stage: PipelineStage): Promise<void> {
  const lead = await getLead(leadId);
  await updateLead(leadId, { pipelineStage: stage });
  await audit("lead.stage_change", "lead", leadId, { from: lead?.pipelineStage, to: stage });
  touch(leadId);
}

export async function addNoteAction(leadId: string, formData: FormData): Promise<void> {
  await updateLead(leadId, { note: String(formData.get("note") ?? "") });
  touch(leadId);
}

// ── Meetings ─────────────────────────────────────────────────────────────────
export async function bookMeetingAction(leadId: string, formData: FormData): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const scheduledAt = String(formData.get("scheduledAt") || "");
  const meetingUrl = String(formData.get("meetingUrl") || "") || null;
  const contact = (await contactsForLead(leadId))[0];
  const disc = (await generateDiscoveryQuestions(lead)).data;
  const meeting = await insertMeeting({
    leadId,
    contactId: contact?.id ?? null,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(),
    meetingUrl,
    discoveryQuestions: disc.questions,
    likelyObjections: disc.likelyObjections,
    notes: "",
    nextStep: "",
    outcome: "pending",
  });
  await updateLead(leadId, { pipelineStage: "Meeting Booked" });
  await audit("meeting.book", "meeting", meeting.id);
  touch(leadId);
}
export async function updateMeetingNotesAction(meetingId: string, leadId: string, formData: FormData): Promise<void> {
  await updateMeeting(meetingId, { notes: String(formData.get("notes") ?? ""), nextStep: String(formData.get("nextStep") ?? "") });
  touch(leadId);
}
export async function setMeetingOutcomeAction(meetingId: string, leadId: string, outcome: MeetingOutcome): Promise<void> {
  await updateMeeting(meetingId, { outcome });
  const stageMap: Partial<Record<MeetingOutcome, PipelineStage>> = {
    completed: "Discovery Complete",
    proposal_required: "Discovery Complete",
    follow_up_required: "Follow-Up",
    not_a_fit: "Lost",
    nurture: "Nurture",
  };
  const stage = stageMap[outcome];
  if (stage) await updateLead(leadId, { pipelineStage: stage });
  touch(leadId);
}

// ── Proposals ────────────────────────────────────────────────────────────────
export async function createProposalAction(leadId: string, formData: FormData): Promise<void> {
  const amount = Number(formData.get("amount")) || null;
  await insertProposal({
    leadId,
    status: "sent",
    amount,
    proposalUrl: String(formData.get("proposalUrl") || "") || null,
    sentAt: new Date().toISOString(),
    acceptedAt: null,
  });
  await updateLead(leadId, { pipelineStage: "Proposal Sent" });
  touch(leadId);
}
export async function markWonAction(leadId: string): Promise<void> {
  const latest = (await proposalsForLead(leadId)).at(-1);
  if (latest) await updateProposal(latest.id, { status: "accepted", acceptedAt: new Date().toISOString() });
  await updateLead(leadId, { pipelineStage: "Won" });
  await audit("lead.won", "lead", leadId);
  touch(leadId);
}
export async function markLostAction(leadId: string): Promise<void> {
  await updateLead(leadId, { pipelineStage: "Lost" });
  touch(leadId);
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function updateSettingsAction(formData: FormData): Promise<void> {
  await updateSettings({
    businessAddress: String(formData.get("businessAddress") ?? ""),
    signature: String(formData.get("signature") ?? ""),
    calendarLink: String(formData.get("calendarLink") ?? ""),
    website: String(formData.get("website") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    defaultReportLanguage: String(formData.get("defaultReportLanguage") ?? "English"),
  });
  revalidatePath("/settings");
}

export async function resetDemoDataAction(): Promise<void> {
  // Dev only. Never wipes a production database.
  if (!hasDb()) reseed();
  revalidatePath("/");
  redirect("/");
}
