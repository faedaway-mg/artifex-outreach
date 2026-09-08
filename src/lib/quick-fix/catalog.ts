// ─────────────────────────────────────────────────────────────────────────────
// FIX CATALOG — the canonical, SKU-aware view of what Artifex sells. It augments
// the capability registry with catalog metadata (family, SLA, defect signatures,
// platform compatibility, version) WITHOUT duplicating it. "Which approved fix
// matches this broken thing?" is answered here — the LLM never invents a SKU.
//
// It is also SKU-AWARE DISCOVERY: each SKU declares the defect signatures whose
// presence makes it eligible, so analysis can hunt for those signatures on
// purpose instead of generating random observations.
// ─────────────────────────────────────────────────────────────────────────────
import { CAPABILITIES, capabilityByKey, isSellable, type Capability } from "./capabilities";

export type FixFamily =
  | "WEBSITE_FUNCTION"
  | "CONVERSION"
  | "ACCESSIBILITY"
  | "ANALYTICS"
  | "LEAD_FLOW"
  | "CMS_TECHNICAL";

export interface SkuMeta {
  family: FixFamily;
  slaLabel: string; // customer-facing SLA
  /** Defect signatures whose presence makes this SKU eligible (SKU-aware search). */
  defectSignatures: string[];
  /** Platforms this SKU can be delivered on. */
  platformCompatibility: string[];
  version: string;
}

const COMMON_PLATFORMS = ["WordPress", "Shopify", "Webflow", "Squarespace", "Wix", "custom"];

// Keyed by capability.key — every sellable capability has a SKU record.
const SKU_META: Record<string, SkuMeta> = {
  "cta-repair": { family: "CONVERSION", slaLabel: "24 hours", defectSignatures: ["cta-missing", "cta-below-fold", "cta-broken-link", "mobile-cta-unusable"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "contact-form-repair": { family: "WEBSITE_FUNCTION", slaLabel: "24 hours", defectSignatures: ["form-missing", "form-submit-fails", "no-contact-path", "form-not-delivering"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "metadata-seo-cleanup": { family: "CMS_TECHNICAL", slaLabel: "24 hours", defectSignatures: ["duplicate-title", "placeholder-metadata", "missing-meta-description", "missing-share-preview"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "analytics-install": { family: "ANALYTICS", slaLabel: "48 hours", defectSignatures: ["no-analytics", "no-conversion-event", "tracking-broken", "no-form-tracking"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "mobile-layout-fix": { family: "WEBSITE_FUNCTION", slaLabel: "48 hours", defectSignatures: ["no-viewport-tag", "mobile-layout-breaks", "not-mobile-friendly", "mobile-tap-targets"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "trust-signal-install": { family: "CONVERSION", slaLabel: "48 hours", defectSignatures: ["reviews-not-surfaced", "no-testimonials", "brand-inconsistency", "no-credibility-elements"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "accessibility-quickfix": { family: "ACCESSIBILITY", slaLabel: "3 business days", defectSignatures: ["contrast-failure", "missing-alt-text", "unlabeled-control", "keyboard-focus-issue"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "lead-capture-package": { family: "LEAD_FLOW", slaLabel: "5 business days", defectSignatures: ["no-online-booking", "weak-conversion-path", "no-lead-routing", "fragmented-contact"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
  "homepage-conversion-sprint": { family: "CONVERSION", slaLabel: "5 business days", defectSignatures: ["no-value-prop-above-fold", "no-primary-action", "hero-unclear"], platformCompatibility: COMMON_PLATFORMS, version: "sku-v1" },
};

export interface Sku extends SkuMeta {
  key: string;
  name: string;
  state: Capability["state"];
  priceHintHours: [number, number];
  requiresDiscovery: boolean;
}

export function skuFor(capKey: string): Sku | null {
  const cap = capabilityByKey(capKey);
  const meta = SKU_META[capKey];
  if (!cap || !meta) return null;
  return { key: cap.key, name: cap.name, state: cap.state, priceHintHours: [cap.minHours, cap.maxHours], requiresDiscovery: cap.requiresDiscovery, ...meta };
}

export function listSkus(): Sku[] {
  return CAPABILITIES.filter(isSellable).map((c) => skuFor(c.key)).filter((s): s is Sku => !!s);
}

/** SKU-aware discovery: signature → the SKU(s) it makes eligible. */
export function defectSignatureIndex(): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  for (const sku of listSkus()) {
    for (const sig of sku.defectSignatures) (idx[sig] ??= []).push(sku.key);
  }
  return idx;
}

export function familyOf(capKey: string): FixFamily | null {
  return SKU_META[capKey]?.family ?? null;
}
