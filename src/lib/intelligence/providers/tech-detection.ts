// ─────────────────────────────────────────────────────────────────────────────
// Technology Detection Provider (Phase 2).
//
// Detects public technologies where reasonably inferable — then TRANSLATES them
// into business understanding, not technical trivia. Detecting three separate
// customer systems becomes "potential duplicate data entry — validate in
// discovery", which feeds Friction Analysis and the Opportunity Graph.
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput, SuppliedPage } from "../providers";

const PROVIDER_ID = "tech-detection";

export type TechCategory = "cms" | "commerce" | "scheduling" | "crm-form" | "chat" | "analytics" | "marketing" | "payments" | "hosting" | "framework";

export interface DetectedTech {
  category: TechCategory;
  name: string;
  confidence: "Verified" | "Likely";
}

interface Sig {
  category: TechCategory;
  name: string;
  re: RegExp;
  headerRe?: RegExp;
}

// Signatures are intentionally conservative (public, page-visible markers).
const SIGNATURES: Sig[] = [
  { category: "cms", name: "WordPress", re: /wp-content|wp-includes|\/wp-json\//i },
  { category: "cms", name: "Squarespace", re: /squarespace\.com|static1\.squarespace/i },
  { category: "cms", name: "Wix", re: /wix\.com|_wixCssId|wixstatic/i },
  { category: "cms", name: "Webflow", re: /webflow\.(io|com)|wf-/i },
  { category: "cms", name: "Duda", re: /dudaone|duda\.co/i },
  { category: "commerce", name: "Shopify", re: /cdn\.shopify\.com|myshopify\.com|Shopify\./i },
  { category: "commerce", name: "WooCommerce", re: /woocommerce/i },
  { category: "commerce", name: "BigCommerce", re: /bigcommerce/i },
  { category: "scheduling", name: "Calendly", re: /calendly\.com/i },
  { category: "scheduling", name: "Acuity", re: /acuityscheduling/i },
  { category: "scheduling", name: "Square Appointments", re: /squareup\.com\/appointments/i },
  { category: "scheduling", name: "Booksy", re: /booksy\.com/i },
  { category: "scheduling", name: "Vagaro", re: /vagaro\.com/i },
  { category: "crm-form", name: "HubSpot Forms", re: /js\.hsforms|hubspot/i },
  { category: "crm-form", name: "Mailchimp", re: /list-manage\.com|mailchimp/i },
  { category: "crm-form", name: "Typeform", re: /typeform\.com/i },
  { category: "crm-form", name: "Jotform", re: /jotform/i },
  { category: "chat", name: "Intercom", re: /intercom\.io|widget\.intercom/i },
  { category: "chat", name: "Drift", re: /drift\.com|js\.driftt/i },
  { category: "chat", name: "Tawk.to", re: /tawk\.to/i },
  { category: "chat", name: "Facebook Messenger Chat", re: /connect\.facebook\.net\/.*Messenger|fb-customerchat/i },
  { category: "analytics", name: "Google Analytics", re: /google-analytics\.com|gtag\(|googletagmanager/i },
  { category: "analytics", name: "Meta Pixel", re: /fbevents\.js|fbq\(/i },
  { category: "marketing", name: "Google Ads", re: /googleadservices|aw-conversion/i },
  { category: "marketing", name: "Klaviyo", re: /klaviyo/i },
  { category: "payments", name: "Stripe", re: /js\.stripe\.com|stripe\.com\/v3/i },
  { category: "payments", name: "PayPal", re: /paypal\.com\/sdk|paypalobjects/i },
  { category: "payments", name: "Square", re: /squareup\.com\/(?!appointments)/i },
  { category: "framework", name: "React", re: /__NEXT_DATA__|data-reactroot|_next\/static/i },
  { category: "hosting", name: "Cloudflare", re: /cloudflare/i, headerRe: /cloudflare/i },
  { category: "hosting", name: "Vercel", re: /vercel/i, headerRe: /vercel/i },
];

/** PURE: detect public technologies from page html + optional headers. */
export function detectTechnologies(pages: SuppliedPage[]): DetectedTech[] {
  const html = pages.map((p) => p.html).join("\n");
  const headerBlob = pages.map((p) => Object.entries(p.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")).join("\n");
  const found = new Map<string, DetectedTech>();
  for (const sig of SIGNATURES) {
    const inHtml = sig.re.test(html);
    const inHeaders = sig.headerRe ? sig.headerRe.test(headerBlob) : false;
    if (inHtml || inHeaders) found.set(sig.name, { category: sig.category, name: sig.name, confidence: inHtml ? "Verified" : "Likely" });
  }
  return [...found.values()];
}

/** PURE: translate detected technologies into BUSINESS evidence + questions. */
export function techToBusinessEvidence(techs: DetectedTech[], sourceUrl: string): Evidence[] {
  const out: Evidence[] = [];
  const mk = (kind: Evidence["kind"], field: string, value: Evidence["value"], statement: string, observationType: Evidence["observationType"], confidence: Evidence["confidence"]) =>
    out.push(evidence({ id: `${PROVIDER_ID}:${field}`, providerId: PROVIDER_ID, kind, field, value, statement, observationType, confidence, sourceUrl }));

  const by = (c: TechCategory) => techs.filter((t) => t.category === c);
  const names = (c: TechCategory) => by(c).map((t) => t.name);

  // Fact: the detected stack (kept brief, business-relevant).
  if (techs.length) mk("technology", "stack", techs.map((t) => t.name).join(", "), `Public technology detected: ${techs.map((t) => t.name).join(", ")}.`, "Directly observed fact", "Likely");

  // Business translation #1 — disconnected customer systems → duplicate data entry.
  const customerSystems = new Set<string>([...names("scheduling"), ...names("crm-form"), ...names("commerce"), ...names("chat")]);
  if (customerSystems.size >= 3) {
    mk(
      "friction",
      "friction:disconnectedSystems",
      [...customerSystems].join(", "),
      `Multiple separate customer systems in use (${[...customerSystems].join(", ")}) — customer information may be re-entered across them (double data entry).`,
      "Strong inference",
      "Likely",
    );
    mk("market", "discovery:disconnectedSystems", true, "Discovery question: do these tools share customer data automatically, or does someone re-enter it?", "Open discovery question", "Unknown");
  }

  // Business translation #2 — no scheduling tool but a services business.
  if (!by("scheduling").length && (by("crm-form").length || by("cms").length)) {
    mk("friction", "friction:manualScheduling", "no scheduling tool detected", "No online scheduling tool detected — booking may be manual (phone/email), adding back-and-forth.", "Strong inference", "Likely");
  }

  // Business translation #3 — analytics/marketing maturity.
  if (!by("analytics").length) mk("friction", "friction:noAnalytics", "no analytics detected", "No web analytics detected — the business may lack visibility into what drives inquiries.", "Strong inference", "Likely");
  if (by("marketing").length) mk("activity", "activeMarketing", names("marketing").join(","), `Runs paid/marketing tooling (${names("marketing").join(", ")}) — an active-demand and ability-to-invest signal.`, "Strong inference", "Likely");

  // Business translation #4 — commerce / payments present.
  if (by("payments").length || by("commerce").length) mk("technology", "transactsOnline", true, `Handles transactions online (${[...names("payments"), ...names("commerce")].join(", ")}).`, "Directly observed fact", "Likely");

  // Platform note (affects how easily we can improve things).
  if (by("cms").length) mk("technology", "cms", names("cms").join(","), `Built on ${names("cms").join(", ")} — informs how modernization would be implemented.`, "Directly observed fact", "Likely");

  return out;
}

export const techDetectionProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "Technology Detection",
  capability: { fields: ["stack", "cms", "transactsOnline", "activeMarketing", "friction:disconnectedSystems", "friction:manualScheduling", "friction:noAnalytics"], external: true, costUsd: 0 },
  ready: () => true, // offline-capable via supplied pages
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    if (!input.pages?.length) return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["no supplied pages to inspect"], costUsd: 0 };
    const techs = detectTechnologies(input.pages);
    const src = input.pages[0].url;
    return { providerId: PROVIDER_ID, ok: true, evidence: techToBusinessEvidence(techs, src), notes: [`detected ${techs.length} technolog${techs.length === 1 ? "y" : "ies"}`], costUsd: 0 };
  },
};
