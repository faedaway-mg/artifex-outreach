import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getLead, getBusinessIntelligence } from "@/lib/repo";
import { buildQuickReview, cachedBrand } from "@/lib/outreach/quick-review";
import { quickReviewApproved } from "@/lib/outreach/review-approval";
import type { BusinessProfile } from "@/lib/business-intelligence/types";
import { loadTemplate, saveTemplate, clearApproval, listTemplateIds } from "@/lib/content-studio/store";
import { latestReadyShot } from "@/lib/content-studio/screenshot-jobs";
import { latestProspectPackage } from "@/lib/outreach/prospect-package-store";
import { workflowOf } from "@/lib/content-studio/workflow";
import { classifyVideoPurpose } from "@/lib/content-studio/video-classification";
import { evaluateNarrationQuality } from "@/lib/content-studio/narration-quality";
import { expandAndPersonalize, type EvidenceFinding } from "@/lib/content-studio/narration-expansion";
import { acceptNarrationRevision, canAcceptRevision, type PackageStateLike } from "@/lib/content-studio/narration-revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  if (isAuthenticated()) return true;
  const secret = (process.env.CS_CANARY_SECRET ?? "").trim();
  return secret.length > 0 && req.headers.get("x-cs-canary") === secret;
}
const pieceIdFor = (leadId: string) => `client-${leadId}`.replace(/[^0-9a-z_-]/gi, "-").slice(0, 40);

// Gather a lead's verified evidence (findings + screenshot readiness) — the ONLY basis a narration may be
// grounded in. Returns null-ish evidence when the business has no stored profile (→ insufficient evidence).
async function loadEvidence(leadId: string): Promise<{ businessName: string; findings: EvidenceFinding[]; observations: string[]; hasScreenshot: boolean; hasApprovedRecommendation: boolean }> {
  const lead = await getLead(leadId);
  const bi = await getBusinessIntelligence(leadId);
  const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
  const businessName = lead?.businessName ?? "";
  if (!lead || !profile) return { businessName, findings: [], observations: [], hasScreenshot: false, hasApprovedRecommendation: false };
  const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });
  const shot = await latestReadyShot(leadId, "mobile").catch(() => null);
  const findings: EvidenceFinding[] = (review.findings ?? []).map((f) => ({
    id: String(f.id), observation: f.observation, impact: f.whyItMatters ?? null, recommendation: (f as any).whatWedDo ?? null, benefit: null,
  }));
  return { businessName, findings, observations: findings.map((f) => f.observation), hasScreenshot: !!shot?.outputKey, hasApprovedRecommendation: await quickReviewApproved(leadId) };
}

// Every OTHER prospect narration — for cross-company similarity detection.
async function otherProposalScripts(exceptLeadId: string): Promise<Array<{ leadId: string; narration: string }>> {
  const ids = await listTemplateIds();
  const out: Array<{ leadId: string; narration: string }> = [];
  for (const id of ids) {
    if (id === pieceIdFor(exceptLeadId)) continue;
    const t = await loadTemplate(id);
    if (!t) continue;
    if (workflowOf({ workflow: t.workflow as any, businessId: (t as any).businessId, id }) !== "prospect") continue;
    out.push({ leadId: id, narration: (t.narration ?? []).join(" ") });
  }
  return out;
}

async function packageStateFor(leadId: string): Promise<PackageStateLike> {
  const pkg = await latestProspectPackage(leadId).catch(() => null);
  return (pkg?.state as PackageStateLike) ?? "NONE";
}

// POST { action: "analyze"|"expand"|"accept", leadId, narration? }
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body?.action ?? "").trim();
  const leadId = String(body?.leadId ?? "").trim();
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  const pieceId = pieceIdFor(leadId);
  const template = await loadTemplate(pieceId);
  // A CONTENT (or unclassified) piece can never use the outreach narration workflow.
  if (template && classifyVideoPurpose({ id: pieceId, businessId: (template as any).businessId, workflow: template.workflow as any }).purpose !== "PROPOSAL") {
    return NextResponse.json({ error: "not a proposal video — the narration workflow is outreach-only" }, { status: 422 });
  }

  if (action === "analyze") {
    const ev = await loadEvidence(leadId);
    const q = evaluateNarrationQuality({
      narration: (template?.narration ?? []).join(" "),
      evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation },
      otherScripts: await otherProposalScripts(leadId),
    });
    return NextResponse.json({ leadId, pieceId, quality: q }, { status: 200 });
  }

  if (action === "expand") {
    const ev = await loadEvidence(leadId);
    const result = expandAndPersonalize({ businessName: ev.businessName, findings: ev.findings, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation });
    if (!result.available) return NextResponse.json({ leadId, pieceId, available: false, blocker: result.blocker }, { status: 200 });
    // Grade the candidate + surface similarity vs other companies (advisory; nothing persisted).
    const graded = evaluateNarrationQuality({
      narration: result.narration,
      evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation },
      otherScripts: await otherProposalScripts(leadId),
    });
    return NextResponse.json({
      leadId, pieceId, available: true,
      original: (template?.narration ?? []).join(" "),
      candidate: result.narration,
      evidenceMap: result.evidenceMap, usedEvidenceIds: result.usedEvidenceIds,
      statementsRequiringReview: result.statementsRequiringReview,
      quality: graded, wordCount: result.wordCount, estimatedSeconds: result.estimatedSeconds,
    }, { status: 200 });
  }

  if (action === "accept") {
    const narration = String(body?.narration ?? "").trim();
    if (!narration) return NextResponse.json({ error: "narration required" }, { status: 400 });
    if (!template) return NextResponse.json({ error: "no template for this lead" }, { status: 404 });
    // Immutability guard: never mutate a frozen/scheduled/sent (or approved) package.
    const guard = canAcceptRevision(await packageStateFor(leadId), await quickReviewApproved(leadId));
    if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 409 });
    // Refuse to persist an unsupported/insufficient script (defense-in-depth; the UI also blocks it).
    const ev = await loadEvidence(leadId);
    const graded = evaluateNarrationQuality({ narration, evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation } });
    if (graded.classification === "UNSUPPORTED_CLAIMS") return NextResponse.json({ error: "narration contains unsupported claims", quality: graded }, { status: 422 });

    const now = new Date().toISOString();
    const { template: next, priorRevision, newRevision, scriptChanged } = acceptNarrationRevision(template, narration, now);
    (next as any).workflow = "prospect";
    await saveTemplate(next);
    // Accepting a new script invalidates any prior approval (the render must be regenerated).
    await clearApproval(pieceId).catch(() => {});
    return NextResponse.json({ leadId, pieceId, priorRevision, newRevision, scriptChanged, requiresNewAudioAndRender: scriptChanged, quality: graded }, { status: 200 });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
