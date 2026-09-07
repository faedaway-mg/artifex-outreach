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
import { acceptNarrationRevision, canAcceptRevision, forkImprovedVersion, narrationPermissions, sameNarration, type PackageStateLike } from "@/lib/content-studio/narration-revision";

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
    return NextResponse.json({ error: "not a proposal video — the narration workflow is outreach-only", code: "NOT_PROPOSAL" }, { status: 422 });
  }

  if (action === "analyze") {
    const ev = await loadEvidence(leadId);
    const q = evaluateNarrationQuality({
      narration: (template?.narration ?? []).join(" "),
      evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation },
      otherScripts: await otherProposalScripts(leadId),
    });
    // Truthful, state-specific permissions: the UI shows Accept/Regenerate/Create-improved-version ONLY when
    // the canonical backend would honour them — never a control that predictably errors (mandate 26 §1).
    const state = await packageStateFor(leadId);
    const approved = await quickReviewApproved(leadId);
    const permissions = narrationPermissions(state, approved);
    return NextResponse.json({ leadId, pieceId, quality: q, state, approved, permissions }, { status: 200 });
  }

  if (action === "expand") {
    // `variant` rotates the grounded draft so "Regenerate" yields a genuinely different candidate (§1A).
    const variant = Math.max(0, Math.floor(Number(body?.variant ?? 0)) || 0);
    const ev = await loadEvidence(leadId);
    const result = expandAndPersonalize({ businessName: ev.businessName, findings: ev.findings, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation }, { variant });
    if (!result.available) return NextResponse.json({ leadId, pieceId, available: false, blocker: result.blocker, code: "INSUFFICIENT_EVIDENCE" }, { status: 200 });
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
      variant: result.variant, variantCount: result.variantCount,
      noSafeAlternative: result.noSafeAlternative, regenerationNote: result.regenerationNote,
      code: result.noSafeAlternative ? "NO_SAFE_ALTERNATIVE" : "OK",
    }, { status: 200 });
  }

  if (action === "accept") {
    const narration = String(body?.narration ?? "").trim();
    if (!narration) return NextResponse.json({ error: "narration required", code: "NARRATION_REQUIRED" }, { status: 400 });
    if (!template) return NextResponse.json({ error: "no template for this lead", code: "NO_TEMPLATE" }, { status: 404 });
    // Immutability guard: never mutate a frozen/scheduled/sent package (approval alone does NOT block — an
    // approved-but-not-frozen draft may be re-opened, which invalidates that approval).
    const state = await packageStateFor(leadId);
    const guard = canAcceptRevision(state, await quickReviewApproved(leadId));
    if (!guard.ok) return NextResponse.json({ error: guard.reason, code: guard.code, permissions: narrationPermissions(state, await quickReviewApproved(leadId)) }, { status: 409 });
    // Refuse to persist an unsupported/insufficient script (defense-in-depth; the UI also blocks it).
    const ev = await loadEvidence(leadId);
    const graded = evaluateNarrationQuality({ narration, evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation } });
    if (graded.classification === "UNSUPPORTED_CLAIMS") return NextResponse.json({ error: "narration contains unsupported claims", code: "UNSUPPORTED_CLAIMS", quality: graded }, { status: 422 });

    // Idempotency: a double-tap that re-accepts the identical script must not create a duplicate revision.
    if (sameNarration(template, narration)) {
      return NextResponse.json({ leadId, pieceId, idempotent: true, code: "IDEMPOTENT_NOOP", priorRevision: template.revision ?? 0, newRevision: template.revision ?? 0, scriptChanged: false, requiresNewAudioAndRender: false, quality: graded }, { status: 200 });
    }
    const now = new Date().toISOString();
    const { template: next, priorRevision, newRevision, scriptChanged } = acceptNarrationRevision(template, narration, now);
    (next as any).workflow = "prospect";
    await saveTemplate(next);
    // Accepting a new script invalidates any prior approval (the render must be regenerated).
    await clearApproval(pieceId).catch(() => {});
    return NextResponse.json({ leadId, pieceId, priorRevision, newRevision, scriptChanged, requiresNewAudioAndRender: scriptChanged, code: "OK", quality: graded }, { status: 200 });
  }

  if (action === "fork" || action === "create-improved-version") {
    // Committed-state secondary workflow: fork a NEW unapproved draft WITHOUT mutating the frozen package or
    // its scheduled binding (mandate 26 §1C). Only offered for FROZEN/SCHEDULED/SENT.
    const narration = String(body?.narration ?? "").trim();
    if (!narration) return NextResponse.json({ error: "narration required", code: "NARRATION_REQUIRED" }, { status: 400 });
    if (!template) return NextResponse.json({ error: "no template for this lead", code: "NO_TEMPLATE" }, { status: 404 });
    const state = await packageStateFor(leadId);
    const perms = narrationPermissions(state, await quickReviewApproved(leadId));
    if (!perms.canCreateImprovedVersion) {
      // Not a committed package — there is nothing to fork FROM; the operator should accept in place instead.
      return NextResponse.json({ error: "this proposal is an editable draft — accept a revision in place instead of forking", code: "OK", permissions: perms }, { status: 409 });
    }
    const ev = await loadEvidence(leadId);
    const graded = evaluateNarrationQuality({ narration, evidence: { businessName: ev.businessName, findings: ev.observations, hasScreenshot: ev.hasScreenshot, hasApprovedRecommendation: ev.hasApprovedRecommendation } });
    if (graded.classification === "UNSUPPORTED_CLAIMS") return NextResponse.json({ error: "narration contains unsupported claims", code: "UNSUPPORTED_CLAIMS", quality: graded }, { status: 422 });

    // Idempotency: if the draft already holds this candidate, do not fork again (no duplicate revisions).
    if (sameNarration(template, narration)) {
      return NextResponse.json({ leadId, pieceId, idempotent: true, code: "IDEMPOTENT_NOOP", forkedFromState: state, priorRevision: template.revision ?? 0, newRevision: template.revision ?? 0, requiresNewApprovalAudioRender: true, quality: graded }, { status: 200 });
    }
    const now = new Date().toISOString();
    const { template: next, priorRevision, newRevision, forkedFromState } = forkImprovedVersion(template, narration, state, now);
    (next as any).workflow = "prospect";
    // Save the new DRAFT revision. The frozen package snapshot + its scheduled binding are separate, immutable
    // records — untouched here. Clearing the approval marks the fork as unapproved (needs fresh approval).
    await saveTemplate(next);
    await clearApproval(pieceId).catch(() => {});
    return NextResponse.json({ leadId, pieceId, forkedFromState, priorRevision, newRevision, requiresNewApprovalAudioRender: true, code: "OK", quality: graded }, { status: 200 });
  }

  return NextResponse.json({ error: `unknown action '${action}'`, code: "OK" }, { status: 400 });
}
