"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Concept Website Preview — server actions. Nothing is shared or sent without
// explicit approval; every state change is audited. Generation is cost-capped.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  getLead, findingsForLead, previewsForLead, getPreview, insertPreview, updatePreview,
  insertVersion, versionsOf, insertShare, getShare, updateShare, sharesForPreview, appendAudit,
} from "./repo";
import type { ApprovedFact, PreviewType, VisualDirection, TargetAction, ConceptPreview } from "./types";
import { generateConceptSpec, GEN_COST, MAX_GENERATIONS, MAX_COST_PER_PREVIEW } from "./concept/generate";
import { renderConcept } from "./concept/render";
import { validateConcept } from "./concept/validate";
import { formatLocation } from "./utils";
import { conceptSpecSchema } from "./concept/spec";
import { generateShareToken } from "./concept/share";
import { captureConceptScreenshots } from "./concept/screenshots";
import { eligibilityFor } from "./concept/eligibility";
import { currentActor } from "@/lib/auth";

async function audit(action: string, targetId: string, meta?: Record<string, unknown>) {
  let ip: string | null = null;
  try { ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null; } catch {}
  await appendAudit({ action, actor: currentActor(), targetType: "concept_preview", targetId, meta: meta ?? null, ip });
}
const touch = (leadId: string) => revalidatePath(`/leads/${leadId}`);

// Explicit approval to CREATE (first step). Builds source facts from public lead data.
export async function createConceptPreviewAction(leadId: string, formData: FormData): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const previewType = String(formData.get("previewType") ?? "Quick Direction") as PreviewType;
  const visualDirection = String(formData.get("visualDirection") ?? "Quiet Professional") as VisualDirection;
  const targetAction = String(formData.get("targetAction") ?? "Contact us") as TargetAction;
  const override = formData.get("override") === "true";

  const elig = eligibilityFor(lead.tier);
  if (!elig.eligible && !override) return;

  const facts: ApprovedFact[] = [
    { key: "businessName", label: "Business name", value: lead.businessName, status: "confirmed" },
    { key: "category", label: "Category", value: lead.industry, status: "confirmed" },
    ...(lead.phone ? [{ key: "phone", label: "Phone", value: lead.phone, status: "confirmed" as const }] : []),
    ...(lead.address ? [{ key: "address", label: "Address", value: [lead.address, formatLocation(lead.city, lead.state)].filter(Boolean).join(", "), status: "confirmed" as const }] : []),
    ...(lead.website ? [{ key: "website", label: "Website", value: lead.website, status: "confirmed" as const }] : []),
    ...(lead.rating != null ? [{ key: "rating", label: "Rating", value: String(lead.rating), status: "confirmed" as const }] : []),
    ...(lead.reviewCount != null ? [{ key: "reviewCount", label: "Reviews", value: String(lead.reviewCount), status: "confirmed" as const }] : []),
    { key: "services", label: "Services", value: "", status: "placeholder" },
  ];

  const preview = await insertPreview({
    leadId, title: `${lead.businessName} — ${previewType}`, previewType, status: "Preparing Facts",
    visualDirection, targetAction, recommendedService: lead.recommendedService,
    eligibilityReason: override && !elig.eligible ? `Override: ${elig.reason}` : elig.reason,
    sourceFacts: facts, approvedFacts: [], selectedFindingIds: [], generatedSpecification: null,
    currentVersionId: null, generationCount: 0, totalGenerationCost: 0, createdBy: "jordan",
    approvedBy: null, approvedAt: null, archivedAt: null,
  });
  await audit("concept.create", preview.id, { leadId, previewType, override });
  touch(leadId);
}

// Approve the facts (Jordan confirms/edits before generation).
export async function approveFactsAction(previewId: string, formData: FormData): Promise<void> {
  const preview = await getPreview(previewId);
  if (!preview) return;
  const approved: ApprovedFact[] = preview.sourceFacts.map((f) => {
    const status = String(formData.get(`status_${f.key}`) ?? f.status) as ApprovedFact["status"];
    const value = String(formData.get(`value_${f.key}`) ?? f.value);
    return { ...f, value, status };
  });
  const findingIds = formData.getAll("finding").map(String);
  await updatePreview(previewId, { approvedFacts: approved, selectedFindingIds: findingIds, status: "Drafting" });
  await audit("concept.approve_facts", previewId);
  touch(preview.leadId);
}

// Generate (cost-capped). Requires approved facts.
export async function generateConceptAction(previewId: string): Promise<void> {
  const preview = await getPreview(previewId);
  if (!preview) return;
  if (preview.generationCount >= MAX_GENERATIONS) return; // hard limit
  if (preview.totalGenerationCost + GEN_COST > MAX_COST_PER_PREVIEW) return; // hard cost cap
  const approved = preview.approvedFacts.length ? preview.approvedFacts : preview.sourceFacts;
  const lead = await getLead(preview.leadId);
  const findings = (await findingsForLead(preview.leadId))
    .filter((f) => preview.selectedFindingIds.includes(f.id))
    .map((f) => f.modernizationDirection);

  const { spec, cost, provider, model } = generateConceptSpec({
    approvedFacts: approved, findings, previewType: preview.previewType,
    visualDirection: preview.visualDirection, targetAction: preview.targetAction,
    recommendedService: preview.recommendedService,
  });
  const { html, css } = renderConcept(spec);
  const validation = validateConcept(spec, html, approved);
  const versionNumber = (await versionsOf(previewId)).length + 1;
  const shots = await captureConceptScreenshots(previewId, versionNumber, html);

  const version = await insertVersion({
    previewId, versionNumber, specification: spec, renderedHtml: html, renderedCss: css,
    desktopScreenshotPath: shots.desktop, mobileScreenshotPath: shots.mobile, tabletScreenshotPath: shots.tablet,
    generationProvider: provider, generationModel: model, generationCost: cost, validationResults: validation,
  });
  await updatePreview(previewId, {
    status: "Generated", currentVersionId: version.id, generatedSpecification: spec,
    generationCount: preview.generationCount + 1, totalGenerationCost: preview.totalGenerationCost + cost,
  });
  await audit("concept.generate", previewId, { versionNumber, cost, valid: validation.valid });
  touch(preview.leadId);
}

export async function approveConceptAction(previewId: string): Promise<void> {
  const preview = await getPreview(previewId);
  if (!preview || !preview.currentVersionId) return;
  const versions = await versionsOf(previewId);
  const current = versions.find((v) => v.id === preview.currentVersionId);
  const validation = current?.validationResults as { valid?: boolean } | undefined;
  if (!validation?.valid) return; // block approval when critical validation fails
  await updatePreview(previewId, { status: "Approved", approvedBy: "jordan", approvedAt: new Date().toISOString() });
  await audit("concept.approve", previewId);
  touch(preview.leadId);
}

// Create a secure share link (separate approval). Returns the raw token ONCE.
export async function createShareAction(previewId: string, expiresInDays: number): Promise<{ token: string } | { error: string }> {
  const preview = await getPreview(previewId);
  if (!preview) return { error: "not found" };
  if (preview.status !== "Approved" && preview.status !== "Shared" && preview.status !== "Viewed") return { error: "preview must be approved before sharing" };
  if (!preview.currentVersionId) return { error: "no version" };
  const { token, tokenHash } = generateShareToken();
  const expiresAt = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;
  await insertShare({ previewId, versionId: preview.currentVersionId, tokenHash, expiresAt, revokedAt: null, viewCount: 0, lastViewedAt: null });
  await updatePreview(previewId, { status: "Shared" });
  await audit("concept.share_created", previewId, { expiresInDays });
  touch(preview.leadId);
  return { token }; // shown once; only the hash is stored
}

export async function revokeShareAction(shareId: string, leadId: string): Promise<void> {
  const share = await getShare(shareId);
  if (!share) return;
  await updateShare(shareId, { revokedAt: new Date().toISOString() });
  await audit("concept.share_revoked", share.previewId);
  touch(leadId);
}

export async function archivePreviewAction(previewId: string): Promise<void> {
  const preview = await getPreview(previewId);
  if (!preview) return;
  // Revoke all active shares on archive.
  for (const s of await sharesForPreview(previewId)) if (!s.revokedAt) await updateShare(s.id, { revokedAt: new Date().toISOString() });
  await updatePreview(previewId, { status: "Archived", archivedAt: new Date().toISOString() });
  await audit("concept.archive", previewId);
  touch(preview.leadId);
}
