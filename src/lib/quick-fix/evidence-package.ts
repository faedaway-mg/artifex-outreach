// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PACKAGE — ONE EVIDENCE TRUTH, MANY PRESENTATIONS.
//
// A single read-only assembly of everything we ACTUALLY have for an offer:
//   • the real captured website screenshots (from content_studio_screenshot_jobs),
//   • the evidence-graded findings that anchored the offer (re-derived the SAME way
//     the offer engine derives them — the lead's BI opportunities → OfferFindings),
//   • asset refs for the personalized video, the diagnostic PDF, and the evergreen
//     trust video.
//
// Every downstream surface (operator evidence view, the customer "here's what you
// receive" manifest, the PDF vertical) reads from THIS one object. An asset is only
// ever READY when a real stored artifact backs it — a missing/stale/unverified asset
// can NEVER be presented as READY, and we NEVER fabricate a screenshot or silently
// substitute one asset for another (the personalized video is ALWAYS MISSING today —
// no generation pipeline exists — and is never replaced by the evergreen video).
//
// buildEvidencePackage performs NO sends, NO charges, NO writes — it only reads.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer, OfferFinding } from "./types";
import { gradedProblemStatement } from "./evidence-gate";
import { toOfferFindings } from "./adapter";
import { trustVideoForOffer } from "./trust-videos";
import { getLead, getBusinessIntelligence } from "../repo";
import { latestReadyShot, type Viewport } from "../content-studio/screenshot-jobs";

export type AssetStatus = "READY" | "MISSING" | "STALE" | "UNVERIFIED" | "NOT_APPLICABLE";

export interface EvidenceScreenshot {
  id: string;                       // stable, e.g. `${leadId}:${viewport}`
  imageRoute: string;               // always-usable app route to the PNG (operator-auth)
  publicUrl: string | null;         // public storage URL if one exists, else null
  viewport: "mobile" | "desktop";
  pageLabel: string;                // plain-language human page name
  sourceUrl: string | null;         // the inspected page URL
  capturedAt: string | null;
  sha256: string | null;
  status: AssetStatus;              // READY only if a ready stored image exists
}

export interface EvidenceFinding {
  id: string;
  observation: string;              // evidence-graded ("While reviewing your site, we noticed …")
  plain: string;                    // plain-language restatement for a non-technical owner
  whyItMatters: string;
  confidenceLabel: string;
  confidenceScore: number;
  screenshotId: string | null;      // link finding → screenshot when determinable, else null
}

export interface EvidenceAssetRef { status: AssetStatus; url: string | null; detail: string; }

export interface EvidencePackage {
  offerId: string; leadId: string; company: string; websiteUrl: string | null;
  screenshots: EvidenceScreenshot[];
  screenshotStatus: AssetStatus;    // roll-up: READY if ≥1 ready screenshot, else MISSING
  findings: EvidenceFinding[];
  personalizedVideo: EvidenceAssetRef;  // NO generator exists → status MISSING, url null
  diagnosticPdf: EvidenceAssetRef;      // MISSING until a PDF is persisted for this offer
  evergreenVideo: EvidenceAssetRef;     // from trust-videos trustVideoForOffer()
  confidence: number;
  evidenceGrade: string;
  generatedAt: string | null;
}

export interface ManifestRow { key: string; label: string; status: AssetStatus; detail: string; }

// ── Plain-language restatement ───────────────────────────────────────────────
// Translate the evidence-graded observation into language a non-technical owner
// reads without adding ANY new fact — no metric, no outcome, no impact number. We
// take the raw observation (not the "we noticed …" wrapper) and normalize a couple
// of jargon nouns to everyday words. Nothing quantitative is ever introduced.
const PLAIN_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\bcalls?[- ]to[- ]actions?\b/gi, "buttons"],
  [/\bcall[- ]to[- ]action\b/gi, "button"],
  [/\bCTAs?\b/g, "buttons"],
  [/\bmetadata\b/gi, "page titles and descriptions"],
  [/\bviewport\b/gi, "screen"],
  [/\bresponsive layout\b/gi, "mobile layout"],
];

function plainRestate(observation: string): string {
  let t = (observation ?? "").trim();
  if (!t) return "";
  for (const [re, to] of PLAIN_SUBSTITUTIONS) t = t.replace(re, to);
  // Capitalize the first letter for a clean sentence; keep the exact facts.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

// ── Screenshot → plain page label ────────────────────────────────────────────
function pageLabelFor(viewport: Viewport): string {
  return viewport === "mobile" ? "Your homepage on a phone" : "Your homepage on a computer";
}

function imageRouteFor(leadId: string, viewport: Viewport): string {
  return `/api/content-studio/screenshot-image?business=${encodeURIComponent(leadId)}&viewport=${viewport}`;
}

// The set of viewports we surface as evidence, most-relevant first.
const VIEWPORTS: Viewport[] = ["desktop", "mobile"];

// ── Link a finding to a screenshot when determinable ─────────────────────────
// A finding that names the mobile/phone experience links to the mobile shot; any
// other finding links to the desktop shot when one is ready. Never invents a link:
// if the relevant viewport has no READY screenshot, screenshotId is null.
function screenshotIdForFinding(f: Pick<OfferFinding, "observation" | "whyItMatters">, readyByViewport: Map<Viewport, EvidenceScreenshot>): string | null {
  const hay = `${f.observation} ${f.whyItMatters ?? ""}`.toLowerCase();
  const wantsMobile = /\bmobile\b|\bphone\b|\bsmall screen\b|\bresponsive\b/.test(hay);
  const preferred: Viewport = wantsMobile ? "mobile" : "desktop";
  const hit = readyByViewport.get(preferred) ?? readyByViewport.get(wantsMobile ? "desktop" : "mobile");
  return hit ? hit.id : null;
}

/**
 * Assemble the canonical evidence package for an offer. Read-only: it derives, it
 * never mutates, sends, or charges. Findings are re-derived the SAME way the offer
 * engine derives them (lead BI opportunities → OfferFindings), then narrowed to the
 * findings this offer actually anchored on (offer.findingIds).
 */
export async function buildEvidencePackage(offer: QuickFixOffer): Promise<EvidencePackage> {
  const leadId = offer.leadId;

  // Website URL (best-effort, read-only).
  const lead = await getLead(leadId).catch(() => null);
  const websiteUrl = (lead as any)?.website ?? null;

  // 1) SCREENSHOTS — only a READY stored capture counts. Never fabricated.
  const readyByViewport = new Map<Viewport, EvidenceScreenshot>();
  const screenshots: EvidenceScreenshot[] = [];
  for (const viewport of VIEWPORTS) {
    const shot = await latestReadyShot(leadId, viewport).catch(() => null);
    const ready = !!shot && shot.status === "ready" && !!shot.outputKey;
    const ev: EvidenceScreenshot = {
      id: `${leadId}:${viewport}`,
      imageRoute: imageRouteFor(leadId, viewport),
      publicUrl: null, // screenshots are served ONLY via the authenticated app route
      viewport,
      pageLabel: pageLabelFor(viewport),
      sourceUrl: ready ? (shot!.finalUrl ?? shot!.requestedUrl ?? websiteUrl) : websiteUrl,
      capturedAt: ready ? shot!.capturedAt : null,
      sha256: ready ? shot!.sha256 : null,
      status: ready ? "READY" : "MISSING",
    };
    if (ready) readyByViewport.set(viewport, ev);
    screenshots.push(ev);
  }
  const screenshotStatus: AssetStatus = readyByViewport.size > 0 ? "READY" : "MISSING";

  // 2) FINDINGS — re-derive from the lead's BI the SAME way the offer engine does,
  //    then narrow to the findings this offer anchored on (one evidence truth).
  const bi = await getBusinessIntelligence(leadId).catch(() => null);
  const profile = (bi?.profile as any)?.businessProfile ?? null;
  const opps = Array.isArray(profile?.opportunities) ? profile.opportunities : [];
  const allFindings = toOfferFindings(opps);
  const wantIds = new Set(offer.findingIds ?? []);
  const anchored = wantIds.size ? allFindings.filter((f) => wantIds.has(f.id)) : allFindings;

  const findings: EvidenceFinding[] = anchored.map((f) => ({
    id: f.id,
    observation: gradedProblemStatement(f),
    plain: plainRestate(f.observation),
    whyItMatters: f.whyItMatters,
    confidenceLabel: f.confidenceLabel,
    confidenceScore: f.confidenceScore,
    screenshotId: screenshotIdForFinding(f, readyByViewport),
  }));

  // 3) PERSONALIZED VIDEO — ALWAYS MISSING. No generation pipeline exists yet, and
  //    we NEVER substitute the evergreen trust video for a real personalized one.
  const personalizedVideo: EvidenceAssetRef = {
    status: "MISSING",
    url: null,
    detail: "A per-business personalized video is not generated yet — no personalized-video pipeline exists. The shared evergreen explainer is a separate asset and is never presented as a personalized video.",
  };

  // 4) DIAGNOSTIC PDF — the PDF renders ON DEMAND, deterministically, from THIS same
  //    canonical evidence (findings + real screenshots) via the offer's diagnostic-pdf
  //    route. So it is READY exactly when it is renderable: at least one evidence-backed
  //    finding exists. With no findings there is nothing honest to put in a document.
  const diagnosticPdf: EvidenceAssetRef = findings.length > 0
    ? {
        status: "READY",
        url: `/api/quick-fix/${offer.offerId}/diagnostic-pdf`,
        detail: `On-demand diagnostic PDF from ${findings.length} evidence-backed finding(s) — rendered deterministically from this offer's canonical evidence.`,
      }
    : {
        status: "MISSING",
        url: null,
        detail: "No evidence-backed findings — there is nothing to present in a diagnostic PDF for this offer yet.",
      };

  // 5) EVERGREEN VIDEO — the shared trust explainer for the offer's scope. READY when
  //    a rendered asset is present; otherwise NOT_APPLICABLE (script-only fallback).
  const resolved = trustVideoForOffer(offer);
  const evergreenVideo: EvidenceAssetRef = resolved.asset.assetUrl
    ? { status: "READY", url: resolved.asset.assetUrl, detail: `Shared evergreen explainer: ${resolved.asset.title}.` }
    : { status: "NOT_APPLICABLE", url: null, detail: "No rendered evergreen video for this scope — the offer page shows the explainer script instead." };

  return {
    offerId: offer.offerId,
    leadId,
    company: offer.companyName,
    websiteUrl,
    screenshots,
    screenshotStatus,
    findings,
    personalizedVideo,
    diagnosticPdf,
    evergreenVideo,
    confidence: offer.confidence,
    evidenceGrade: offer.evidenceGrade,
    generatedAt: offer.generatedAt,
  };
}

/**
 * The PDF vertical's hook: mark the diagnostic PDF READY on an already-built package
 * once a real generated PDF is persisted (url = its always-usable route/URL). Pure —
 * returns a new package, mutates nothing. Foundation exposes this so the later
 * vertical never has to reach into the package internals.
 */
export function markDiagnosticPdfReady(pkg: EvidencePackage, url: string): EvidencePackage {
  return {
    ...pkg,
    diagnosticPdf: { status: "READY", url, detail: "Generated diagnostic PDF is persisted for this offer." },
  };
}

// ── CUSTOMER RECEIVES manifest (Part H) ──────────────────────────────────────
// What the customer will actually receive, derived ONLY from real asset bindings on
// the package (plus whether a fabrication-safe outreach draft composes). A missing,
// stale, or unverified asset can NEVER show READY here — the manifest carries the
// exact same status the underlying asset holds. No fabrication, no optimistic states.
export function customerReceivesManifest(pkg: EvidencePackage, offer: QuickFixOffer, emailReady: boolean): ManifestRow[] {
  const rows: ManifestRow[] = [];

  rows.push({
    key: "screenshots",
    label: "Screenshots of your live website",
    status: pkg.screenshotStatus,
    detail: pkg.screenshotStatus === "READY"
      ? `${pkg.screenshots.filter((s) => s.status === "READY").length} captured page image(s) of your real site.`
      : "No captured screenshot is ready yet.",
  });

  const findingsReady = pkg.findings.length > 0;
  rows.push({
    key: "findings",
    label: "What we found on your site (plain-language)",
    status: findingsReady ? "READY" : "MISSING",
    detail: findingsReady ? `${pkg.findings.length} evidence-backed finding(s).` : "No evidence-backed findings to present.",
  });

  rows.push({
    key: "diagnosticPdf",
    label: "Your diagnostic PDF",
    status: pkg.diagnosticPdf.status,
    detail: pkg.diagnosticPdf.detail,
  });

  rows.push({
    key: "personalizedVideo",
    label: "A personalized walkthrough video",
    status: pkg.personalizedVideo.status,
    detail: pkg.personalizedVideo.detail,
  });

  rows.push({
    key: "evergreenVideo",
    label: "How the Artifex quick fix works (short video)",
    status: pkg.evergreenVideo.status,
    detail: pkg.evergreenVideo.detail,
  });

  // The outreach email is only "receivable" when a fabrication-safe draft composes.
  rows.push({
    key: "email",
    label: "Your offer email",
    status: emailReady ? "READY" : "MISSING",
    detail: emailReady ? "A fabrication-safe offer email composes for this offer." : "No fabrication-safe offer email composes for this offer yet.",
  });

  return rows;
}
