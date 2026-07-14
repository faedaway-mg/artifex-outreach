/**
 * Concept Preview live acceptance test. Uses a clearly-marked INTERNAL DEMO lead
 * (never a real prospect). Exercises the real repo + renderer + validator + share
 * crypto against production Postgres, then hits the LIVE public share route.
 * Prints results only — never the raw token.
 */
import "./loadEnv";
import { insertLead, insertPreview, updatePreview, insertVersion, insertShare, getShareByHash, updateShare, outreachForLead, versionsOf } from "../src/lib/repo";
import { normalizeName } from "../src/lib/store";
import { generateConceptSpec } from "../src/lib/concept/generate";
import { renderConcept } from "../src/lib/concept/render";
import { validateConcept } from "../src/lib/concept/validate";
import { generateShareToken, hashToken } from "../src/lib/concept/share";
import type { ApprovedFact } from "../src/lib/types";

const BASE = "https://outreach.artifexlabs.tech";

async function main() {
  const name = "ZZ Internal Demo — Concept Test (delete me)";
  const lead = await insertLead({
    googlePlaceId: null, businessName: name, normalizedName: normalizeName(name), industry: "Dental practice",
    normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1 Demo St", city: "Los Angeles",
    state: "CA", postalCode: "90012", latitude: null, longitude: null, phone: "(213) 555-0123", website: "https://example.com",
    websiteDomain: "example.com", publicEmail: null, contactFormUrl: null, socialLinks: [], locationsCount: null, rating: 4.8,
    reviewCount: 214, businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "Internal demo", retrievedAt: new Date().toISOString(),
    tier: "A", leadScore: 82, scoreBreakdown: null, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000,
    recommendedService: "Business Website System", recommendedAction: "Prepare video", recommendationReason: "demo", opportunitySummary: null,
    strengths: [], assignedTo: "jordan", note: "INTERNAL DEMO", lastContactAt: null, nextFollowUpAt: null,
  });
  console.log("demo lead:", lead.id);

  const facts: ApprovedFact[] = [
    { key: "businessName", label: "Business", value: name, status: "confirmed" },
    { key: "category", label: "Category", value: "Dental practice", status: "confirmed" },
    { key: "phone", label: "Phone", value: "(213) 555-0123", status: "confirmed" },
    { key: "rating", label: "Rating", value: "4.8", status: "confirmed" },
    { key: "reviewCount", label: "Reviews", value: "214", status: "confirmed" },
  ];
  const preview = await insertPreview({
    leadId: lead.id, title: `${name} — Quick Direction`, previewType: "Quick Direction", status: "Preparing Facts",
    visualDirection: "Quiet Professional", targetAction: "Book a consultation", recommendedService: "Business Website System",
    eligibilityReason: "Tier A", sourceFacts: facts, approvedFacts: facts, selectedFindingIds: [], generatedSpecification: null,
    currentVersionId: null, generationCount: 0, totalGenerationCost: 0, createdBy: "jordan", approvedBy: null, approvedAt: null, archivedAt: null,
  });

  const { spec, cost, provider, model } = generateConceptSpec({ approvedFacts: facts, findings: [], previewType: "Quick Direction", visualDirection: "Quiet Professional", targetAction: "Book a consultation", recommendedService: "Business Website System" });
  const { html, css } = renderConcept(spec);
  const validation = validateConcept(spec, html, facts);
  console.log("validation.valid:", validation.valid, "| critical:", validation.criticalCount);
  const version = await insertVersion({ previewId: preview.id, versionNumber: 1, specification: spec, renderedHtml: html, renderedCss: css, desktopScreenshotPath: null, mobileScreenshotPath: null, tabletScreenshotPath: null, generationProvider: provider, generationModel: model, generationCost: cost, validationResults: validation });
  await updatePreview(preview.id, { status: "Approved", currentVersionId: version.id, generatedSpecification: spec, generationCount: 1, totalGenerationCost: cost, approvedBy: "jordan", approvedAt: new Date().toISOString() });

  // Create secure share
  const { token, tokenHash } = generateShareToken();
  const share = await insertShare({ previewId: preview.id, versionId: version.id, tokenHash, expiresAt: null, revokedAt: null, viewCount: 0, lastViewedAt: null });
  await updatePreview(preview.id, { status: "Shared" });
  console.log("share created (token hashed, len tokenHash:", tokenHash.length + ")");

  // Hit the LIVE public route
  const r1 = await fetch(`${BASE}/share/previews/${token}`);
  const body1 = await r1.text();
  console.log("LIVE share GET:", r1.status, "| X-Robots-Tag:", r1.headers.get("x-robots-tag"), "| CSP set:", !!r1.headers.get("content-security-policy"));
  console.log("  contains disclaimer:", /concept website preview/i.test(body1), "| attribution:", /artifex labs/i.test(body1), "| business name:", body1.includes(name));
  console.log("  NO private lead id:", !new RegExp(lead.id).test(body1), "| NO outreach nav:", !/href="\/pipeline"/.test(body1) && !/Priority queue/.test(body1));

  // View recorded?
  const afterView = await getShareByHash(tokenHash);
  console.log("view recorded:", afterView?.viewCount, "| lastViewedAt set:", !!afterView?.lastViewedAt);

  // No outreach auto-sent
  const outreach = await outreachForLead(lead.id);
  console.log("outreach records for demo lead (should be 0):", outreach.length);

  // Revoke → should 404
  await updateShare(share.id, { revokedAt: new Date().toISOString() });
  const r2 = await fetch(`${BASE}/share/previews/${token}`);
  console.log("after REVOKE, LIVE GET:", r2.status, "(expect 404)");

  // Bad token → 404
  const r3 = await fetch(`${BASE}/share/previews/${"z".repeat(43)}`);
  console.log("guessed token GET:", r3.status, "(expect 404)");

  console.log("PREVIEW_ID=" + preview.id, "VERSION_ID=" + version.id, "SHARE_ID=" + share.id, "LEAD_ID=" + lead.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
