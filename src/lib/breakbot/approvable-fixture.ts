// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT APPROVABLE FIXTURE (mandate 20B). Seeds — via the REAL domain repositories/ops, not hand-written
// audit rows — a complete READY_TO_APPROVE video package that the canonical approveAndScheduleSelectedAction
// accepts: SENDABLE review (2 High/Observed findings) → frozen PDF bytes → verified render+video artifact →
// autoAssembleFromRender. Deterministic synthetic bytes. Isolated tenant only (fail-closed).
// ─────────────────────────────────────────────────────────────────────────────
import { assertIsolatedStore, BREAKBOT_PROVENANCE, RESERVED_TEST_DOMAIN, assertFakeRecipient } from "./isolation";
import { insertLead, upsertBusinessIntelligence, insertEmailSendIfAbsent } from "../repo";
import { getArtifactStore } from "../content-studio/storage-factory";
import { writeJob, listJobs } from "../content-studio/store";
import { approveAndFreezeQuickReview } from "../outreach/quick-review-freeze";
import { autoAssembleFromRender, latestProspectPackage } from "../outreach/prospect-package-store";
import type { Lead } from "../types";
import type { RenderJob } from "../content-studio/types";

function fixtureLead(businessName: string, slug: string): any {
  const recipient = `ops+${slug}@${RESERVED_TEST_DOMAIN}`;
  assertFakeRecipient(recipient);
  return {
    googlePlaceId: null, businessName, normalizedName: slug, industry: "Home services",
    normalizedCategory: "home", categoryGroup: "Home", address: "1 Test St", city: "Testville", state: "CA", postalCode: "90000",
    latitude: null, longitude: null, phone: "(000) 000-0000", website: `https://${slug}.${RESERVED_TEST_DOMAIN}`, websiteDomain: `${slug}.${RESERVED_TEST_DOMAIN}`,
    publicEmail: recipient, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.6, reviewCount: 40,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: BREAKBOT_PROVENANCE, retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 2000, estimatedValueHigh: 4000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "breakbot", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
    test_only: true,
  };
}

/** A SENDABLE BI profile: 2 High/Observed opportunities → buildQuickReview status SENDABLE. */
function sendableProfile(name: string): any {
  const opp = (i: number, observation: string, whyItMatters: string, rationale: string) => ({
    id: `bb_o${i}`, category: ["Customer Acquisition", "Communication"][i % 2], observation, whyItMatters,
    estimatedImpact: { level: "High", rationale }, confidence: { label: "Observed", score: 0.9 }, basis: ["public website HTML"],
  });
  return {
    businessProfile: {
      businessName: name, executiveSummary: `${name} has strong reviews but no owned booking path.`,
      opportunities: [
        opp(0, "No owned website — a Google listing is doing the work.", "New customers can't book on a site you control.", "A simple booking page could capture direct reservations."),
        opp(1, "Reviews are strong but live on Google.", "That reputation isn't reinforcing your own brand.", "Surfacing reviews on-site builds trust at the decision moment."),
      ],
    },
    evidenceConfidence: 80,
    improvement: { score: 70, treatment: "standard" },
    evidence: [{ field: "primaryCTA", value: "Book a consultation" }],
  };
}

function readyRenderJob(pieceId: string, videoKey: string, sha: string): RenderJob {
  const now = new Date("2026-01-01T00:00:00Z").toISOString();
  return {
    id: `bb_job_${pieceId}`, pieceId, inputVersion: `bb_iv_${pieceId}`, status: "ready", progress: 1, stage: "done",
    mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: `bb_audio_${pieceId}`, audioSha: sha, audioLabel: "vo",
    outputFile: null, outputRel: null, outputKey: videoKey, posterKey: `${videoKey}.poster`, screenshotKey: null, screenshotSha: null,
    storyboard: null, thumbRel: null, error: null, attempt: 1, pid: null, createdAt: now, updatedAt: now, startedAt: now, finishedAt: now,
  } as RenderJob;
}

/** Seed one complete, APPROVABLE READY_EMAIL_VIDEO fixture via the real ops. Returns its lead id. */
export async function seedApprovableVideoFixture(businessName = "Vertex Roofing", slug = "approvable-video"): Promise<{ leadId: string; pieceId: string; packageVersion: number }> {
  assertIsolatedStore();
  const lead: Lead = await insertLead(fixtureLead(businessName, slug));
  const leadId = lead.id;
  const pieceId = `client-${leadId}`;
  await upsertBusinessIntelligence({ leadId, profile: sendableProfile(businessName), enrichmentDelta: null, generatedAt: new Date("2026-01-01T00:00:00Z").toISOString() });
  // Verified render + video artifact (deterministic synthetic bytes).
  const videoKey = `content-studio/breakbot/${leadId}/video.mp4`;
  const put = await getArtifactStore().put(videoKey, Buffer.from(`bb-video-${leadId}`), { artifactClass: "render-output", contentType: "video/mp4" });
  await writeJob(readyRenderJob(pieceId, videoKey, put.sha256));
  // Real frozen PDF + real package assembly.
  const froze = await approveAndFreezeQuickReview({ leadId });
  if (!froze.ok) throw new Error(`freeze failed: ${froze.reason}`);
  const asm = await autoAssembleFromRender(leadId);
  if (!asm.ok) throw new Error(`assemble failed: ${asm.reason} ${JSON.stringify(asm.blockers ?? [])}`);
  const pkg = await latestProspectPackage(leadId);
  return { leadId, pieceId, packageVersion: pkg?.packageVersion ?? 1 };
}

/** Seed a scheduled EMAIL_PDF item (real ops): SENDABLE review → frozen Quick Review PDF → scheduleBatch.
 *  No video package — proves the Scheduled detail must render email + PDF, never a "no video" warning. */
export async function seedScheduledEmailPdfFixture(businessName = "Circle City Bargains", slug = "email-pdf"): Promise<{ leadId: string; scheduledAt: string | null }> {
  assertIsolatedStore();
  const lead: Lead = await insertLead(fixtureLead(businessName, slug));
  await upsertBusinessIntelligence({ leadId: lead.id, profile: sendableProfile(businessName), enrichmentDelta: null, generatedAt: new Date("2026-01-01T00:00:00Z").toISOString() });
  const froze = await approveAndFreezeQuickReview({ leadId: lead.id });
  if (!froze.ok) throw new Error(`freeze failed: ${froze.reason}`);
  const { scheduleBatch } = await import("../outreach/scheduled-batch");
  const { resolveSendingWindow, nextSendingDateKey } = await import("../outreach/sending-window");
  const { getSettings } = await import("../repo");
  const window = resolveSendingWindow(await getSettings());
  const dateKey = nextSendingDateKey(new Date(), window);
  const res = await scheduleBatch([lead.id], { dateKey, by: "breakbot", batchId: "bb_pdf", window: { tz: window.timezone, startHour: window.startHour, endHour: window.endHour } });
  return { leadId: lead.id, scheduledAt: res.scheduled[0]?.scheduledAt ?? null };
}

// ── Content Studio media fixtures + FAKE render worker (mandate 23; isolated tenant only) ──────────────
/** A "needs narration" client fixture: SENDABLE review + frozen PDF, but NO voiceover upload and NO render
 *  yet. resolveCurrentVideo → not available; the operator must upload narration to start a render. */
export async function seedNeedsNarrationFixture(businessName = "Harbor Point Fitness", slug = "needs-narration"): Promise<{ leadId: string; pieceId: string }> {
  assertIsolatedStore();
  const lead: Lead = await insertLead(fixtureLead(businessName, slug));
  await upsertBusinessIntelligence({ leadId: lead.id, profile: sendableProfile(businessName), enrichmentDelta: null, generatedAt: new Date("2026-01-01T00:00:00Z").toISOString() });
  const froze = await approveAndFreezeQuickReview({ leadId: lead.id });
  if (!froze.ok) throw new Error(`freeze failed: ${froze.reason}`);
  return { leadId: lead.id, pieceId: `client-${lead.id}` };
}

function bbJob(pieceId: string, over: Partial<RenderJob>): RenderJob {
  const now = new Date("2026-02-01T00:00:00Z").toISOString();
  return { id: `bb_job_${pieceId}_${Math.abs(hash(JSON.stringify(over)))}`, pieceId, inputVersion: `bb_iv_${pieceId}`, status: "queued", progress: 0, stage: "queued", mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: `bb_audio_${pieceId}`, audioSha: "upsha", audioLabel: "vo", outputFile: null, outputRel: null, outputKey: null, posterKey: null, screenshotKey: null, screenshotSha: null, storyboard: null, thumbRel: null, error: null, attempt: 1, pid: null, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, ...over } as RenderJob;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; } return h; }

/** FAKE-WORKER: simulate a voiceover upload → a QUEUED render job for the piece (no real render service). */
export async function studioUpload(leadId: string): Promise<{ jobId: string }> {
  assertIsolatedStore();
  const pieceId = `client-${leadId}`;
  const job = bbJob(pieceId, { id: `bb_job_up_${leadId}`, status: "queued" });
  await writeJob(job);
  return { jobId: job.id };
}

/** FAKE-WORKER: complete the piece's active render — write a deterministic output artifact, mark READY, and
 *  assemble the package so resolveCurrentVideo resolves the finished canonical video. No real render service. */
export async function studioAdvanceRender(leadId: string): Promise<{ ready: boolean; sha256: string | null }> {
  assertIsolatedStore();
  const pieceId = `client-${leadId}`;
  const j = (await listJobs()).find((x) => x.pieceId === pieceId && (x.status === "queued" || x.status === "rendering"));
  if (!j) return { ready: false, sha256: null };
  const videoKey = `content-studio/breakbot/${leadId}/render.mp4`;
  const put = await getArtifactStore().put(videoKey, Buffer.from(`bb-render-${leadId}`), { artifactClass: "render-output", contentType: "video/mp4" });
  const done = new Date("2026-02-01T00:05:00Z").toISOString();
  await writeJob({ ...j, status: "ready", progress: 1, stage: "done", outputKey: videoKey, posterKey: `${videoKey}.poster`, finishedAt: done, updatedAt: done });
  await autoAssembleFromRender(leadId).catch(() => {});
  return { ready: true, sha256: put.sha256 };
}

/** FAKE-WORKER: mark the piece's render FAILED (terminal) so the UI shows an honest failure + retry. */
export async function studioFailRender(leadId: string): Promise<void> {
  assertIsolatedStore();
  const pieceId = `client-${leadId}`;
  await writeJob(bbJob(pieceId, { id: `bb_job_fail_${leadId}`, status: "failed", stage: "error", error: "synthetic render failure (fake worker)", attempt: 1, startedAt: new Date("2026-02-01T00:00:00Z").toISOString(), finishedAt: new Date("2026-02-01T00:01:00Z").toISOString() }));
}

/** Delete a lead's current video artifact (to prove missing-artifact handling). */
export async function deleteVideoArtifact(leadId: string): Promise<boolean> {
  assertIsolatedStore();
  const { resolveCurrentVideo } = await import("../outreach/prospect-package-store");
  const cur = await resolveCurrentVideo(leadId);
  if (!cur.artifactKey) return false;
  await getArtifactStore().del(cur.artifactKey);
  return true;
}

/** Morris-style Needs Attention fixture (mandate 24): a completed video package + a PRIOR SENT intro email
 *  (contacted, video not delivered) — eligible for exactly one VIDEO_FOLLOW_UP. */
export async function seedMorrisLikeFixture(businessName = "Morris Automotive", slug = "morris-like"): Promise<{ leadId: string; recipient: string }> {
  assertIsolatedStore();
  const { leadId } = await seedApprovableVideoFixture(businessName, slug);
  const recipient = `ops+${slug}@${RESERVED_TEST_DOMAIN}`;
  assertFakeRecipient(recipient);
  await insertEmailSendIfAbsent({
    idempotencyKey: `intro:${leadId}`, stepId: "step_intro", planId: "plan_1", leadId, toAddr: recipient, fromAddr: `ops@${RESERVED_TEST_DOMAIN}`,
    subject: `Quick Review — ${businessName}`, status: "sent" as any, provider: "breakbot", providerMessageId: `pm_intro_${slug}`, attempts: 1,
    lastError: null, lastErrorCode: null, nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    deliveredAt: new Date("2026-01-01T00:01:00Z").toISOString(), openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  } as any);
  return { leadId, recipient };
}

/** Seed a full isolated SCHEDULED queue (mandate 22): EMAIL_VIDEO, EMAIL_PDF (first/middle/last coverage),
 *  and an INVALID missing-artifact video binding — via the real ops + scheduler. Returns the ordered items. */
export async function seedScheduledQueueFixtures(): Promise<{ ordered: Array<{ leadId: string; type: string; business: string }> }> {
  assertIsolatedStore();
  const { approveAndScheduleSelectedAction } = await import("../outreach/batch-actions");
  const out: Array<{ leadId: string; type: string; business: string }> = [];

  const v1 = await seedApprovableVideoFixture("Northstar Hospitality", "sched-video-1");
  await approveAndScheduleSelectedAction([v1.leadId]);
  out.push({ leadId: v1.leadId, type: "EMAIL_VIDEO", business: "Northstar Hospitality" });

  const p1 = await seedScheduledEmailPdfFixture("Circle City Bargains", "sched-pdf-1");
  out.push({ leadId: p1.leadId, type: "EMAIL_PDF", business: "Circle City Bargains" });
  const p2 = await seedScheduledEmailPdfFixture("Cobalt Clean", "sched-pdf-2");
  out.push({ leadId: p2.leadId, type: "EMAIL_PDF", business: "Cobalt Clean" });

  // INVALID: a video package scheduled, then its video artifact removed → declares video but it's missing.
  const inv = await seedApprovableVideoFixture("Vertex Roofing", "sched-invalid");
  await approveAndScheduleSelectedAction([inv.leadId]);
  await getArtifactStore().del(`content-studio/breakbot/${inv.leadId}/video.mp4`);
  out.push({ leadId: inv.leadId, type: "INVALID_VIDEO", business: "Vertex Roofing" });

  return { ordered: out };
}

/** Seed a PREVIOUSLY-CONTACTED fixture with a fake DELIVERED receipt (isolated tenant only). Used to prove
 *  "Stop future outreach" preserves the delivered email + receipt and writes no unsubscribe. */
export async function seedContactedWithReceipt(businessName = "Copperline Cafe", slug = "contacted-receipt"): Promise<{ leadId: string; recipient: string }> {
  assertIsolatedStore();
  const recipient = `ops+${slug}@${RESERVED_TEST_DOMAIN}`;
  assertFakeRecipient(recipient);
  const lead: Lead = await insertLead({ ...fixtureLead(businessName, slug), pipelineStage: "Contacted", lastContactAt: new Date("2026-01-01T00:00:00Z").toISOString() });
  await insertEmailSendIfAbsent({
    idempotencyKey: `breakbot:${lead.id}`, stepId: null, planId: null, leadId: lead.id, toAddr: recipient, fromAddr: `ops@${RESERVED_TEST_DOMAIN}`,
    subject: `Quick Review — ${businessName}`, status: "sent" as any, provider: "breakbot", providerMessageId: "bb_pm_1", attempts: 1, lastError: null, lastErrorCode: null,
    nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: new Date("2026-01-01T00:05:00Z").toISOString(), deliveredAt: new Date("2026-01-01T00:06:00Z").toISOString(),
    openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  } as any);
  return { leadId: lead.id, recipient };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mandate 25 — Content Studio TWO-TAB + expand-and-personalize fixtures (isolated tenant only). Seed real
// content-studio templates (via saveTemplate) + leads/BI so the seeded videos appear in the workspaces with
// deterministic narration-quality scenarios. Proposal templates carry workflow=prospect + businessId; content
// templates carry workflow=social; the ambiguous one carries neither (NEEDS_CLASSIFICATION).
// ─────────────────────────────────────────────────────────────────────────────
import { saveTemplate } from "../content-studio/store";
import type { ContentTemplate } from "../content-studio/template-schema";

function narrationTemplate(id: string, businessName: string, narration: string[], opts: { workflow?: "social" | "prospect"; businessId?: string }): ContentTemplate {
  const lines = narration.length >= 2 ? narration.slice(0, 12) : [...narration, "A focused review from Artifex Labs."];
  return {
    id, title: businessName, concept: "review", businessName,
    narration: lines,
    beats: [
      { type: "title", lines: [0], mood: "problem", eyebrow: "REVIEW", headline: businessName, sub: "A focused review" },
      { type: "brand", lines: [lines.length - 1], mood: "resolve", tagline: "A focused review from Artifex Labs." },
    ],
    ...(opts.workflow ? { workflow: opts.workflow } : {}),
    ...(opts.businessId ? { businessId: opts.businessId } : {}),
    revision: 1,
  } as unknown as ContentTemplate;
}

// A narration finding-less BI (no opportunities) → INSUFFICIENT_EVIDENCE for expand.
function evidencelessProfile(name: string): any {
  return { businessProfile: { businessName: name, executiveSummary: `${name} — no verified findings yet.`, opportunities: [] }, evidenceConfidence: 10, improvement: { score: 10, treatment: "standard" }, evidence: [] };
}

async function seedProposalTemplate(slug: string, businessName: string, narration: string[], withEvidence: boolean): Promise<string> {
  const lead: Lead = await insertLead(fixtureLead(businessName, slug));
  await upsertBusinessIntelligence({ leadId: lead.id, profile: (withEvidence ? sendableProfile(businessName) : evidencelessProfile(businessName)), enrichmentDelta: null, generatedAt: new Date("2026-01-01T00:00:00Z").toISOString() });
  await saveTemplate(narrationTemplate(`client-${lead.id}`, businessName, narration, { workflow: "prospect", businessId: lead.id }));
  return lead.id;
}

const GENERIC_LONG = ["Hi there, I wanted to reach out today because we help businesses like yours grow and reach more people every single day.", "We have a great deal of experience across many different industries and we genuinely think we could really help you succeed.", "So many companies just like yours have seen wonderful results when they decide to work with our talented team.", "Please let me know if you might be interested in learning more about everything our services can offer you."];
const SHORT_GENERIC = ["Hi, I made a quick video for you.", "Take a look and let me know."];
const GOOD_SPECIFIC = ["Hi — I spent a few minutes on your website and one thing stood out.", "Right now there's no online booking, so a customer who searches for you can't schedule a job without calling.", "A lot of people won't make that call after hours, so those jobs quietly slip away.", "A simple booking page on the site you already have could capture those requests directly.", "No pressure — if it's useful, just reply and I'll walk you through it."];
const SHARED_SIMILAR = ["Right now there's no online booking on the website so customers who search can't schedule a job without calling.", "A simple booking page could capture those requests directly and put them in front of you.", "If it's useful, just reply."];
const UNSUPPORTED = ["Hi — I looked at your website and noticed there's no online booking.", "This will increase your revenue by 30% within a month, guaranteed.", "Reply if useful."];

/** Seed the full isolated set of two-tab / narration fixtures. Returns every seeded id by scenario. */
export async function seedVideoWorkspaceFixtures(): Promise<Record<string, string>> {
  assertIsolatedStore();
  const ids: Record<string, string> = {};
  ids.shortGeneric = await seedProposalTemplate("bb-short-generic", "短 Short Generic Co", SHORT_GENERIC, true);
  ids.shortSpecific = await seedProposalTemplate("bb-short-specific", "Cedar Dental", ["Quick note — your site has no online booking, so searchers can't schedule without calling.", "A simple booking page could capture those. Reply if useful."], true);
  ids.longGeneric = await seedProposalTemplate("bb-long-generic", "Global Mega Corp", GENERIC_LONG, true);
  ids.good = await seedProposalTemplate("bb-good", "Vertex Roofing", GOOD_SPECIFIC, true);
  ids.similarA = await seedProposalTemplate("bb-similar-a", "Summit Plumbing", ["Hi — about Summit Plumbing.", ...SHARED_SIMILAR], true);
  ids.similarB = await seedProposalTemplate("bb-similar-b", "Harbor Electric", ["Hi — about Harbor Electric.", ...SHARED_SIMILAR], true);
  ids.insufficient = await seedProposalTemplate("bb-insufficient", "Riverside Bakery", SHORT_GENERIC, false); // no findings → expand blocked
  ids.unsupported = await seedProposalTemplate("bb-unsupported", "Lakeside Cleaners", UNSUPPORTED, true);

  // Proposal with EXISTING audio + ready render (accepting a revision must outdate it).
  const withAudio = await seedNeedsNarrationFixture("Northstar Fitness", "bb-with-audio");
  await saveTemplate(narrationTemplate(withAudio.pieceId, "Northstar Fitness", GOOD_SPECIFIC, { workflow: "prospect", businessId: withAudio.leadId }));
  await studioUpload(withAudio.leadId); await studioAdvanceRender(withAudio.leadId);
  ids.withAudio = withAudio.leadId;

  // Frozen approved proposal (immutable — accept must be refused).
  const frozen = await seedApprovableVideoFixture("Meridian Auto", "bb-frozen");
  ids.frozen = frozen.leadId;

  // Genuine CONTENT video (Artifex field note — must live ONLY in the Content tab).
  await saveTemplate(narrationTemplate("bb-content-note", "Artifex Field Note", ["A quick field note about small-business websites.", "A focused review from Artifex Labs."], { workflow: "social" }));
  ids.content = "bb-content-note";

  // Ambiguous classification (no lineage → NEEDS_CLASSIFICATION → in neither tab until resolved).
  await saveTemplate(narrationTemplate("BB_LEGACY_9", "Legacy Mystery", ["An unclassified legacy video.", "A focused review from Artifex Labs."], {}));
  ids.ambiguous = "BB_LEGACY_9";

  return ids;
}
