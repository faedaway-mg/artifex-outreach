import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { getLead, getBusinessIntelligence } from "@/lib/repo";
import { buildQuickReview, cachedBrand } from "@/lib/outreach/quick-review";
import { quickReviewApproved } from "@/lib/outreach/review-approval";
import type { BusinessProfile } from "@/lib/business-intelligence/types";
import { buildBusinessTemplate } from "@/lib/content-studio/client-video";
import { saveTemplate, REPO_ROOT } from "@/lib/content-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { leadId, allowOverride? } → build an evidence-backed review video template for a business, BOUND
// to it. Uses the REAL Quick Review + readiness gate; an ineligible business returns its blockers and NO
// template (the gate is never weakened). On success the template is registered as a Content Studio piece
// (id "client-<leadId>") and its cover is rendered — then it uses the same upload→render→download flow.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const leadId = String(body?.leadId ?? "").trim();
  const allowOverride = Boolean(body?.allowOverride);
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "unknown business" }, { status: 404 });
  const bi = await getBusinessIntelligence(leadId);
  const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
  if (!profile) return NextResponse.json({ error: "This business has no stored evidence yet — nothing to review." }, { status: 422 });

  const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });
  const { template, readiness, narrationNote } = buildBusinessTemplate(review, { leadId, allowOverride });
  if (!template) {
    return NextResponse.json({ error: "Not eligible for a review video.", readiness, blockers: readiness.blockers }, { status: 422 });
  }

  await saveTemplate(template);
  const worker = path.join(REPO_ROOT, "scripts", "render-template-thumbnail.mjs");
  const child = spawn(process.execPath, [worker, template.id], { cwd: REPO_ROOT, detached: true, stdio: "ignore", env: process.env });
  child.unref();

  return NextResponse.json({
    pieceId: template.id, businessId: leadId, businessName: template.businessName,
    readiness: readiness.readiness, narrationNote,
    narration: template.narration,
    note: "Evidence-backed review video prepared. Cover rendering; upload your voiceover, then Generate. Bound to this business.",
  }, { status: 201 });
}
