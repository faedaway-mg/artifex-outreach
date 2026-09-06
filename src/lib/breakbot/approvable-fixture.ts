// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT APPROVABLE FIXTURE (mandate 20B). Seeds — via the REAL domain repositories/ops, not hand-written
// audit rows — a complete READY_TO_APPROVE video package that the canonical approveAndScheduleSelectedAction
// accepts: SENDABLE review (2 High/Observed findings) → frozen PDF bytes → verified render+video artifact →
// autoAssembleFromRender. Deterministic synthetic bytes. Isolated tenant only (fail-closed).
// ─────────────────────────────────────────────────────────────────────────────
import { assertIsolatedStore, BREAKBOT_PROVENANCE, RESERVED_TEST_DOMAIN, assertFakeRecipient } from "./isolation";
import { insertLead, upsertBusinessIntelligence } from "../repo";
import { getArtifactStore } from "../content-studio/storage-factory";
import { writeJob } from "../content-studio/store";
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
