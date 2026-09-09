// ─────────────────────────────────────────────────────────────────────────────
// PER-OFFER DIAGNOSTIC PDF — one evidence truth, presented as a document.
//
// This builds the customer-facing "Website Review" PDF for a single quick-fix
// offer from the SAME canonical EvidencePackage the offer page and the operator
// evidence view read. It NEVER invents a finding, a screenshot, or a metric, and it
// is ordered around EVIDENCE-FIRST / VALUE-BEFORE-PRICE psychology:
//
//   §1  WHAT WE TRIED / WHAT HAPPENED — the SAME opening claim as the first-touch
//       email + the offer hero, taken from experienceFrameForOffer(offer). One
//       evidence truth, one opener. Price is NOT here — this is the human moment.
//   §2  SCREENSHOT EVIDENCE — the EXACT package findings: the real captured shot,
//       the page we tested, and a plain-language explanation. Proof precedes ask.
//   §3  WHAT WE'D CHANGE + WHAT'S INCLUDED — the offer's own customer-facing scope
//       (proposed change, what's included, what we won't touch). Still no price.
//   FINAL  FIXED PRICE + turnaround + a clean link to the personalized offer page.
//       Price is neither the cover headline nor hidden — it lives here, last.
//
// Guardrails preserved from Wave 1:
//   • Findings are the EXACT EvidenceFinding objects on the package — no PDF-only
//     findings, no re-derivation. A finding is INCLUDED only when its assembled
//     customer-facing text passes containsFabricatedClaim(); a tripping finding is
//     SKIPPED, never softened into a fabricated claim.
//   • A screenshot is embedded only when the finding links to a READY captured
//     shot AND we can read the real stored image bytes. Otherwise the finding is
//     text-only — we never draw a placeholder or a fake screenshot in the PDF.
//   • WHY IT MATTERS is qualitative only (from the finding's metric-free whyItMatters).
//   • The §1 opener is the experience frame's emailOpener verbatim — never a new
//     claim; there is NO fake agency-value anchoring (no "$1,200 value → $249").
//
// assembleDiagnosticDoc() is a PURE function over (offer, package): it decides what
// the document contains without touching storage, so it is directly testable.
// renderDiagnosticPdf() layers the real screenshot bytes on top and renders through
// the EXISTING @react-pdf stack (src/lib/pdf/render.ts pattern + design system).
// It performs NO sends, NO charges, NO writes.
// ─────────────────────────────────────────────────────────────────────────────
import "../pdf/design/textdecoder-fix"; // MUST precede any @react-pdf/fontkit import
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { Document, Page, Text, View, Image, Link } from "@react-pdf/renderer";
import {
  color, space, radius, type,
  Row, Eyebrow, Title, Label, Wordmark, Icon,
  pageStyles, RunningFooter, SectionHeader, Card, Callout, AccentTick,
} from "../pdf/design";
import { ARTIFEX_IDENTITY } from "../identity";
import { containsFabricatedClaim } from "./evidence-gate";
import { experienceFrameForOffer, type ExperienceFrame } from "./experience-frame";
import { buildEvidencePackage } from "./evidence-package";
import type { QuickFixOffer } from "./types";
import type { EvidencePackage, EvidenceScreenshot } from "./evidence-package";
import { latestReadyShot, type Viewport } from "../content-studio/screenshot-jobs";
import { getArtifactStore } from "../content-studio/storage-factory";

// ── Assembled (pure) document model ──────────────────────────────────────────
export interface DiagnosticFindingBlock {
  id: string;
  /** Plain-language restatement of what we observed (from the package finding). */
  observed: string;
  /** Qualitative reason it matters (from the package finding — never a metric). */
  whyItMatters: string;
  /** The linked screenshot (READY) when one exists — else null (text-only). */
  screenshot: EvidenceScreenshot | null;
  /** The inspected page/URL, when known. */
  inspectedUrl: string | null;
  confidenceLabel: string;
}

export interface DiagnosticRepair {
  title: string;          // offer scope.offerName (customer-facing title)
  solution: string;       // offer scope.proposedSolution
  willChange: string[];   // scope.includedItems
  willNotChange: string[]; // scope.excludedItems
}

/** §FINAL — the fixed price + turnaround. Isolated so price lives ONLY here. */
export interface DiagnosticPricing {
  priceLabel: string;     // "$495 flat" — deterministic, from priceCents
  turnaround: string;     // offer scope.deliveryWindow
}

/**
 * §1 — WHAT WE TRIED / WHAT HAPPENED. The opener is the experience frame's
 * emailOpener VERBATIM (the same source the first-touch email + offer hero use), so
 * every surface tells one evidence truth. `friction` is the short observed clause.
 */
export interface DiagnosticOpener {
  /** experienceFrame.emailOpener — identical string to the email opener. */
  opener: string;
  /** experienceFrame.offerHeroTitle — matches the offer hero title. */
  heroTitle: string;
  /** experienceFrame.friction — the plain observed friction clause. */
  friction: string;
  /** True when the frame is an attempted-use claim (vs an honest observation). */
  attemptSupported: boolean;
}

export interface DiagnosticDoc {
  offerId: string;
  company: string;
  websiteUrl: string | null;
  /** §1 opening, sourced from experienceFrameForOffer(offer). */
  opener: DiagnosticOpener;
  findings: DiagnosticFindingBlock[];
  /** Findings dropped because their assembled text tripped the fabrication guard. */
  droppedFindingIds: string[];
  repair: DiagnosticRepair;
  /** §FINAL price block — the ONLY place a price appears in the document. */
  pricing: DiagnosticPricing;
  /** Public offer link the customer follows to take the next step. */
  nextStepUrl: string;
  /** True when at least one presentable finding survived — the PDF is renderable. */
  renderable: boolean;
}

function priceLabelOf(offer: QuickFixOffer): string {
  return `$${Math.round(offer.priceCents / 100)} flat`;
}

/** The public offer path — the share token is the customer's capability. */
export function offerNextStepUrl(offer: QuickFixOffer, shareToken: string | null): string {
  const base = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ARTIFEX_IDENTITY.publicWebsite).replace(/\/$/, "");
  const seg = shareToken || offer.offerId;
  return `${base}/offer/${seg}`;
}

/**
 * Assemble the diagnostic document model from the offer + its canonical evidence
 * package. PURE + deterministic — no storage, no I/O. Consumes the SAME finding and
 * screenshot objects the package holds (never re-derives them). A finding whose
 * assembled customer text would emit a fabricated/quantitative claim is DROPPED.
 */
export function assembleDiagnosticDoc(
  offer: QuickFixOffer,
  pkg: EvidencePackage,
  shareToken: string | null = null,
): DiagnosticDoc {
  const byScreenshotId = new Map(pkg.screenshots.map((s) => [s.id, s] as const));

  const findings: DiagnosticFindingBlock[] = [];
  const droppedFindingIds: string[] = [];

  for (const f of pkg.findings) {
    const shot = f.screenshotId ? byScreenshotId.get(f.screenshotId) ?? null : null;
    // Only a READY captured shot is ever embedded — never a placeholder.
    const screenshot = shot && shot.status === "READY" ? shot : null;

    // Run the fabrication guard over EVERYTHING customer-facing we would print for
    // this finding. If any of it trips, skip the finding rather than emit a claim.
    const customerText = [f.plain, f.whyItMatters].filter(Boolean).join("\n");
    if (containsFabricatedClaim(customerText)) {
      droppedFindingIds.push(f.id);
      continue;
    }

    findings.push({
      id: f.id,
      observed: f.plain,
      whyItMatters: f.whyItMatters,
      screenshot,
      inspectedUrl: screenshot?.sourceUrl ?? pkg.websiteUrl,
      confidenceLabel: f.confidenceLabel,
    });
  }

  // §1 — one evidence truth: the SAME opener the email + offer hero derive from the
  // canonical defect. experienceFrameForOffer is the arbiter of the allowed claim.
  const frame: ExperienceFrame = experienceFrameForOffer(offer);
  const opener: DiagnosticOpener = {
    opener: frame.emailOpener,
    heroTitle: frame.offerHeroTitle,
    friction: frame.friction,
    attemptSupported: frame.attemptSupported,
  };

  const repair: DiagnosticRepair = {
    title: offer.scope.offerName,
    solution: offer.scope.proposedSolution,
    willChange: offer.scope.includedItems ?? [],
    willNotChange: offer.scope.excludedItems ?? [],
  };

  // §FINAL — price is isolated to its own block so it can only render last.
  const pricing: DiagnosticPricing = {
    priceLabel: priceLabelOf(offer),
    turnaround: offer.scope.deliveryWindow,
  };

  return {
    offerId: pkg.offerId,
    company: pkg.company,
    websiteUrl: pkg.websiteUrl,
    opener,
    findings,
    droppedFindingIds,
    repair,
    pricing,
    nextStepUrl: offerNextStepUrl(offer, shareToken),
    renderable: findings.length > 0,
  };
}

// ── Customer-facing filename ─────────────────────────────────────────────────
/**
 * The email-attachment filename: "[Business] — Website Review.pdf". Sanitized to
 * letters/digits/space/&/- (whitespace collapsed) so it is safe across mail clients
 * and leaks NO internal offer/lead id. Falls back to a neutral title when the
 * business name sanitizes to nothing.
 */
export function diagnosticPdfFilename(offer: QuickFixOffer): string {
  const business = (offer.companyName ?? "")
    .replace(/[^A-Za-z0-9 &-]+/g, " ") // keep only letters/digits/space/&/-
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim();
  const name = business || "Website";
  return `${name} — Website Review.pdf`;
}

// ── Screenshot bytes (I/O — used only at render time) ─────────────────────────
// Resolve the REAL captured image for an embedded screenshot as a data URL. Reads
// only; returns null when nothing is stored (finding then renders text-only).
async function screenshotDataUrl(leadId: string, viewport: Viewport): Promise<string | null> {
  try {
    const shot = await latestReadyShot(leadId, viewport);
    if (!shot || shot.status !== "ready" || !shot.outputKey) return null;
    const store = getArtifactStore();
    const meta = await store.getMeta(shot.outputKey);
    const buf = await store.readFull(shot.outputKey);
    if (!buf) return null;
    const ct = meta?.contentType || "image/png";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Text sanitize — Helvetica has no glyph for stars/symbols; mirror render.ts.
function sanitize(s: string): string {
  return (s ?? "")
    .replace(/(\d(?:\.\d+)?)\s*[★⭐✦✪]/g, "$1/5")
    .replace(/[★☆⭐✦✪✔✓➔➜]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

// ── Document (react-pdf) ─────────────────────────────────────────────────────
type FindingImage = { screenshotId: string; dataUrl: string };

function DiagnosticDocument({ doc, images }: { doc: DiagnosticDoc; images: Map<string, string> }) {
  const footerNote = `Prepared for ${doc.company}  ·  Website Review`;
  const site = clean(doc.websiteUrl);

  return (
    <Document title={`Website Review — ${doc.company}`} author="Artifex Labs">
      {/* ── §1 WHAT WE TRIED / WHAT HAPPENED + §2 SCREENSHOT EVIDENCE ─────────── */}
      <Page size="A4" style={pageStyles.content}>
        <RunningFooter note={footerNote} />

        {/* Masthead — NO price. This is the human "what happened" moment. */}
        <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
          <Wordmark size={14} />
          <View style={{ borderWidth: 0.75, borderColor: color.hairlineStrong, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 }}>
            <Text style={[type.fine, { color: color.textFaint, letterSpacing: 1.3, textTransform: "uppercase" }]}>Website Review</Text>
          </View>
        </Row>
        <View style={{ height: 0.75, backgroundColor: color.hairline, marginBottom: space.lg }} />

        <Eyebrow>Prepared for {doc.company}</Eyebrow>
        <View style={{ height: 10 }} />
        {/* Cover headline = what we tried / what happened, NOT the price. */}
        <Title style={{ fontSize: 22, maxWidth: 460 }}>{sanitize(doc.opener.heroTitle)}</Title>
        {site ? (
          <>
            <View style={{ height: 8 }} />
            <Row style={{ alignItems: "center", gap: 6 }}>
              <Icon name="globe" size={12} color={color.accentDeep} strokeWidth={1.8} />
              <Text style={[type.subtitle, { color: color.textMuted }]}>{site}</Text>
            </Row>
          </>
        ) : null}
        <View style={{ height: space.md }} />
        <AccentTick />
        <View style={{ height: space.lg }} />

        {/* §1 opener body — the SAME sentence the email led with. */}
        <Card tint={color.surfaceSubtle} style={{ marginBottom: space.xl }}>
          <Label color={color.textFaint}>{doc.opener.attemptSupported ? "What we tried, and what happened" : "What we noticed"}</Label>
          <View style={{ height: 8 }} />
          <Text style={[type.bodyStrong, { color: color.textPrimary }]}>{sanitize(doc.opener.opener)}</Text>
        </Card>

        {/* §2 SCREENSHOT EVIDENCE */}
        <SectionHeader
          eyebrow="The evidence"
          title="What we found on your site"
          intro="Each item pairs what we actually saw with a captured image of your live site — the page we tested and a plain explanation, where an image is available."
          icon="search"
        />

        {doc.findings.map((f, i) => (
          <FindingBlock key={f.id} index={i + 1} f={f} images={images} />
        ))}
      </Page>

      {/* ── §3 WHAT WE'D CHANGE + WHAT'S INCLUDED, then §FINAL PRICE ──────────── */}
      <Page size="A4" style={pageStyles.content}>
        <RunningFooter note={footerNote} />

        {/* §3 — the proposed change + scope. Still NO price. */}
        <SectionHeader
          eyebrow="What we'd change"
          title={doc.repair.title}
          intro={doc.repair.solution}
          icon="layers"
        />

        <Row style={{ gap: space.md, marginBottom: space.xl }}>
          <View style={{ flex: 1 }}>
            <ChangeList title="What's included" items={doc.repair.willChange} accent={color.positive} tint={color.positiveBgTint} icon="check" />
          </View>
          <View style={{ flex: 1 }}>
            <ChangeList title="What we won't change" items={doc.repair.willNotChange} accent={color.textFaint} tint={color.surfaceSubtle} icon="shield" />
          </View>
        </Row>

        {/* §FINAL — the ONLY place the price appears: fixed price + turnaround + link. */}
        <SectionHeader
          eyebrow="The offer"
          title="Fixed price, no surprises"
          icon="check"
        />

        <Card accent={color.accent} style={{ marginBottom: space.lg }}>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Label color={color.accentDeep}>Fixed price</Label>
              <Text style={[type.stat, { color: color.textPrimary, marginTop: 4 }]}>{doc.pricing.priceLabel}</Text>
            </View>
            <View style={{ width: 0.75, height: 40, backgroundColor: color.hairline, marginHorizontal: space.lg }} />
            <View style={{ flex: 1.4 }}>
              <Label color={color.accentDeep}>Turnaround</Label>
              <Text style={[type.h3, { color: color.textPrimary, marginTop: 6 }]}>{sanitize(doc.pricing.turnaround)}</Text>
            </View>
          </Row>
        </Card>

        <Callout icon="arrowRight" label="Next step" variant="accent">
          Open your personalized offer page to review the exact scope, price, and requirements — then approve and check out securely.
        </Callout>
        <View style={{ height: space.sm }} />
        <Link src={doc.nextStepUrl}>
          <Text style={[type.bodyStrong, { color: color.accentDeep }]}>{clean(doc.nextStepUrl)}</Text>
        </Link>

        <View style={{ height: space.xxl }} />
        <View style={{ height: 0.75, backgroundColor: color.hairline, marginBottom: 8 }} />
        <Text style={[type.caption, { color: color.textMuted }]}>
          Every observation in this review is based on a real look at your live website. We never assert traffic, revenue, or conversion outcomes.
        </Text>
      </Page>
    </Document>
  );
}

function FindingBlock({ index, f, images }: { index: number; f: DiagnosticFindingBlock; images: Map<string, string> }) {
  const dataUrl = f.screenshot ? images.get(f.screenshot.id) ?? null : null;
  return (
    <View wrap={false} style={{ marginBottom: space.lg, borderTopWidth: 1.5, borderTopColor: color.textPrimary, paddingTop: space.sm }}>
      <Row style={{ alignItems: "flex-start", gap: 12 }}>
        <Text style={[type.stat, { color: color.surfaceSunken, fontSize: 22, lineHeight: 1 }]}>{String(index).padStart(2, "0")}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[type.h3, { color: color.textPrimary }]}>{sanitize(f.observed)}</Text>
          <View style={{ height: 6 }} />
          <Row style={{ alignItems: "center", gap: 7 }}>
            <Icon name="bolt" size={12} color={color.heat} strokeWidth={1.9} />
            <Label color={color.textFaint}>Why it matters</Label>
          </Row>
          <View style={{ height: 4 }} />
          <Text style={[type.body, { color: color.textBody }]}>{sanitize(f.whyItMatters)}</Text>
          {f.inspectedUrl ? (
            <Text style={[type.fine, { color: color.textFaint, marginTop: 6 }]}>Page tested: {clean(f.inspectedUrl)}</Text>
          ) : null}
        </View>
        {dataUrl ? (
          <View style={{ width: 120, alignItems: "center" }}>
            <View style={{ borderWidth: 0.75, borderColor: color.hairlineStrong, borderRadius: radius.sm, overflow: "hidden" }}>
              <Image src={dataUrl} style={{ width: 118 }} />
            </View>
            <Text style={[type.fine, { color: color.textFaint, marginTop: 4 }]}>{f.screenshot?.pageLabel}</Text>
          </View>
        ) : null}
      </Row>
    </View>
  );
}

function ChangeList({ title, items, accent, tint, icon }: { title: string; items: string[]; accent: string; tint: string; icon: "check" | "shield" }) {
  return (
    <View style={{ backgroundColor: tint, borderWidth: 0.75, borderColor: color.hairline, borderRadius: radius.lg, borderLeftWidth: 3, borderLeftColor: accent, padding: space.lg }}>
      <Row style={{ alignItems: "center", gap: 7, marginBottom: 8 }}>
        <Icon name={icon} size={13} color={accent} strokeWidth={1.9} />
        <Label color={color.textMuted}>{title}</Label>
      </Row>
      {items.length ? (
        items.map((it, i) => (
          <Row key={i} style={{ alignItems: "flex-start", gap: 6, marginBottom: 5 }}>
            <Text style={[type.body, { color: accent, fontSize: 9.5 }]}>•</Text>
            <Text style={[type.body, { color: color.textBody, fontSize: 9.5, flex: 1 }]}>{sanitize(it)}</Text>
          </Row>
        ))
      ) : (
        <Text style={[type.caption, { color: color.textMuted }]}>Nothing listed.</Text>
      )}
    </View>
  );
}

/**
 * Render the per-offer diagnostic PDF to a Buffer through the existing @react-pdf
 * stack. Reads the real captured screenshot bytes for embedded findings (read-only),
 * assembles the pure document model, and renders. NO sends, NO charges, NO writes.
 */
export async function renderDiagnosticPdf(
  offer: QuickFixOffer,
  pkg: EvidencePackage,
  shareToken: string | null = null,
): Promise<Buffer> {
  const doc = assembleDiagnosticDoc(offer, pkg, shareToken);

  // Fetch real image bytes only for the screenshots we actually embed (deduped by id).
  const images = new Map<string, string>();
  const needed = new Map<string, EvidenceScreenshot>();
  for (const f of doc.findings) if (f.screenshot) needed.set(f.screenshot.id, f.screenshot);
  for (const shot of needed.values()) {
    const url = await screenshotDataUrl(pkg.leadId, shot.viewport);
    if (url) images.set(shot.id, url);
  }

  return renderToBuffer(DiagnosticDocument({ doc, images }) as any);
}

/**
 * Email-attachment entry point. Takes JUST the offer: builds the SAME canonical
 * EvidencePackage the offer page + route read, resolves the offer's own share token
 * (so the embedded link points at the customer's personalized page), and renders the
 * PDF to a Buffer. Read-only — NO sends, NO charges, NO writes. Pairs with
 * diagnosticPdfFilename(offer) for the "[Business] — Website Review.pdf" attachment.
 */
export async function renderDiagnosticPdfBuffer(offer: QuickFixOffer): Promise<Buffer> {
  const pkg = await buildEvidencePackage(offer);
  // The share token lives on the stored offer; read it defensively (QuickFixOffer
  // itself doesn't declare it) so the offer link is the revocable share path.
  const shareToken = (offer as { shareToken?: string | null }).shareToken ?? null;
  return renderDiagnosticPdf(offer, pkg, shareToken);
}
