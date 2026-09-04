// ─────────────────────────────────────────────────────────────────────────────
// Website Intelligence Provider (Phase 1 — highest priority).
//
// The business website carries more useful intelligence than any directory. This
// provider extracts structured business understanding from public pages and emits
// normalized Evidence — never unsupported assumptions. Analysis is a PURE function
// over supplied pages (fully testable offline); the live crawl path is gated by
// config and only runs when explicitly enabled.
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type EvidenceKind, type EvidenceConfidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput, SuppliedPage } from "../providers";
import type { ObservationType } from "../../positioning";
import { htmlToText, extractTitle, canonicalizeUrl } from "../crawler";
import { intelligenceConfig } from "../config";
import { HttpClient } from "../http-client";
import { crawlSite } from "../crawler";

const PROVIDER_ID = "website-intelligence";

interface Emit {
  kind: EvidenceKind;
  field: string;
  value: Evidence["value"];
  statement: string;
  observationType: ObservationType;
  confidence: EvidenceConfidence;
  sourceUrl: string;
}

/** PURE: analyze already-fetched pages into normalized Evidence. */
export function analyzeWebsitePages(pages: SuppliedPage[]): Evidence[] {
  if (!pages.length) return [];
  const out: Emit[] = [];
  const home = pages[0];
  const allHtml = pages.map((p) => p.html).join("\n");
  const allText = pages.map((p) => htmlToText(p.html)).join(" \n ");
  const lc = allHtml.toLowerCase();
  const src = home.url;

  const push = (e: Emit) => out.push(e);
  const fact = (kind: EvidenceKind, field: string, value: Evidence["value"], statement: string, confidence: EvidenceConfidence = "Verified") =>
    push({ kind, field, value, statement, observationType: confidence === "Verified" ? "Directly observed fact" : "Strong inference", confidence, sourceUrl: src });
  const friction = (field: string, statement: string, confidence: EvidenceConfidence = "Verified") =>
    push({ kind: "friction", field: `friction:${field}`, value: statement, statement, observationType: "Directly observed fact", confidence, sourceUrl: src });

  // Business description
  const desc = metaContent(allHtml, "description") || ogContent(allHtml, "og:description") || firstSentence(allText);
  if (desc) fact("market", "businessDescription", trunc(desc, 300), `Describes itself as: "${trunc(desc, 160)}"`, "Likely");

  // Languages (international readiness)
  const langs = languages(allHtml);
  if (langs.length) fact("identity", "languages", langs.join(","), `Site language(s): ${langs.join(", ")}.`, langs.length > 1 ? "Verified" : "Likely");

  // Services (nav + section headings)
  const services = services_(allHtml);
  if (services.length) fact("market", "services", services.slice(0, 12).join("; "), `Advertises services: ${services.slice(0, 6).join(", ")}${services.length > 6 ? "…" : ""}.`, "Likely");

  // Primary CTA
  // A prominent action counts whether it sits in a plain <a>/<button> (primaryCta) OR appears as a strong
  // CTA phrase anywhere in the captured markup (strongCtaPhrase) — the latter catches nested/JS-rendered
  // buttons like "Free Consultation" that the anchor scan misses. Only emit noClearCTA when NEITHER exists,
  // so a page that visibly says "Free Consultation" is never labeled as having no call-to-action.
  const cta = primaryCta(allHtml) || strongCtaPhrase(allHtml);
  if (cta) fact("channel", "primaryCTA", cta, `Primary call-to-action reads "${cta}".`);
  else friction("noClearCTA", "No obvious primary call-to-action on the page — may leave visitors unsure what to do next.");

  // Booking / scheduling flow
  const booking = detectBooking(lc);
  if (booking) fact("technology", "bookingFlow", booking, `Online booking present via ${booking}.`);
  else friction("noOnlineBooking", "No online booking/scheduling detected — customers may have to call during hours to book.");

  // Lead form
  if (/<form[\s>]/i.test(allHtml)) fact("channel", "hasLeadForm", true, "A lead/contact form is present.");
  else friction("noLeadForm", "No lead/contact form detected — inquiries likely depend on phone or email only.");

  // Contact paths
  const contactPaths = contactPaths_(allHtml);
  if (contactPaths.length) fact("channel", "contactPaths", contactPaths.join(","), `Contact routes visible: ${contactPaths.join(", ")}.`);

  // Public email — the crawler already has the HTML; extract the actual address (not just
  // "an email exists") so the value-first review can be emailed instead of falling through to
  // a cold call. Prefer an address on the business's own domain; role inboxes (info@/office@)
  // are fine for a first touch. Emitted as evidence; promotion to the lead's send route is
  // gated downstream (same-domain only) so a stray third-party address is never used blindly.
  const emailPick = pickBusinessEmail(extractEmailsFromHtml(allHtml), src);
  if (emailPick) fact("channel", "publicEmail", emailPick, `A public email is published on the site: ${emailPick}.`, "Verified");

  // Locations
  const locs = countLocations(allText);
  if (locs > 1) fact("scale", "locations", locs, `Appears to reference ${locs} locations.`, "Likely");

  // Pricing visibility
  if (/\$\s?\d|\bpricing\b|\bplans\b|\bpackages\b/i.test(allText)) fact("market", "pricingVisible", true, "Pricing or packages are at least partially visible publicly.", "Likely");
  else fact("market", "pricingVisible", false, "No public pricing visible — common, but worth confirming positioning.", "Likely");

  // Trust indicators
  const trust = trustIndicators(allText);
  if (trust.length) fact("reputation", "trustIndicators", trust.join(","), `Trust signals present: ${trust.join(", ")}.`, "Likely");
  else friction("weakTrust", "Few visible trust indicators (testimonials, credentials, guarantees) — may slow customer decisions.", "Likely");

  // FAQ / support
  if (/\bfaq\b|frequently asked/i.test(allHtml)) fact("channel", "hasFAQ", true, "An FAQ / support section exists.");
  // Customer portal
  if (/\b(client|customer|patient)\s*(portal|login|account)\b|\/portal\b|\/login\b/i.test(lc)) fact("technology", "customerPortal", true, "A customer/client portal or login is present.", "Likely");
  // Careers (growth signal)
  if (/\bcareers?\b|we'?re hiring|join our team|\/jobs?\b/i.test(lc)) fact("activity", "hiring", true, "Careers/hiring content present — a possible growth signal.", "Likely");
  // Blog activity
  if (/\bblog\b|\/news\b|\barticles?\b/i.test(lc)) fact("activity", "blog", true, "Maintains a blog/news section.", "Likely");

  // Structured data
  const sd = structuredDataTypes(allHtml);
  if (sd.length) fact("technology", "structuredData", sd.join(","), `Publishes structured data: ${sd.join(", ")}.`);

  // Policies
  if (/privacy policy|terms of service|terms &|\/privacy\b|\/terms\b/i.test(lc)) fact("identity", "policies", true, "Publishes privacy/terms policies.");

  // Mobile + accessibility observations
  if (/<meta[^>]+name=["']viewport["']/i.test(allHtml)) fact("technology", "mobileViewport", true, "Declares a mobile viewport.");
  else friction("noViewport", "No mobile viewport declared — the site may render poorly on phones.");
  const altRatio = imgAltRatio(allHtml);
  if (altRatio != null && altRatio < 0.5) friction("accessibilityAlt", `Under half of images have alt text (${Math.round(altRatio * 100)}%) — an accessibility and SEO gap.`, "Likely");

  // Title (identity)
  const title = extractTitle(home.html);
  if (title) fact("identity", "pageTitle", trunc(title, 120), `Homepage title: "${trunc(title, 100)}".`);

  return out.map((e, i) =>
    evidence({ id: `${PROVIDER_ID}:${e.field}:${i}`, providerId: PROVIDER_ID, kind: e.kind, field: e.field, value: e.value, statement: e.statement, observationType: e.observationType, confidence: e.confidence, sourceUrl: e.sourceUrl }),
  );
}

export const websiteIntelligenceProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "Website Intelligence",
  capability: {
    fields: ["businessDescription", "services", "primaryCTA", "bookingFlow", "hasLeadForm", "contactPaths", "locations", "pricingVisible", "languages", "trustIndicators", "structuredData", "friction:*"],
    external: true,
    costUsd: 0,
  },
  ready: () => true, // offline-capable via supplied pages; live crawl is config-gated
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    // 1) Offline path — analyze supplied pages, no network.
    if (input.pages?.length) {
      return { providerId: PROVIDER_ID, ok: true, evidence: analyzeWebsitePages(input.pages), notes: [`analyzed ${input.pages.length} supplied page(s)`], costUsd: 0 };
    }
    // 2) Live crawl path — only when explicitly enabled.
    const cfg = intelligenceConfig();
    if (!cfg.website || !input.lead.website) {
      return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: [cfg.website ? "no website on lead" : "live website enrichment disabled"], costUsd: 0 };
    }
    try {
      const client = new HttpClient({ cacheTtlMs: cfg.cacheTtlMs, minDelayMs: cfg.crawl.minDelayMs, maxRetries: cfg.crawl.maxRetries, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      const crawl = await crawlSite(canonicalizeUrl(input.lead.website), { client, userAgent: cfg.crawl.userAgent, maxPages: cfg.crawl.maxPages });
      const ev = analyzeWebsitePages(crawl.pages.map((p) => ({ url: p.url, html: p.html })));
      return { providerId: PROVIDER_ID, ok: true, evidence: ev, notes: [`crawled ${crawl.pages.length} page(s)`, ...crawl.notes], costUsd: 0 };
    } catch (err) {
      return { providerId: PROVIDER_ID, ok: false, evidence: [], notes: [`crawl failed: ${(err as Error).message}`], costUsd: 0 };
    }
  },
};

// ── extraction helpers ───────────────────────────────────────────────────────
function metaContent(html: string, name: string): string {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i"));
  return m ? m[1].trim() : "";
}
function ogContent(html: string, prop: string): string {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  return m ? m[1].trim() : "";
}
function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s/)[0];
  return s && s.length > 30 ? s : "";
}
function languages(html: string): string[] {
  const set = new Set<string>();
  const lang = html.match(/<html[^>]+lang=["']([a-z-]+)["']/i);
  if (lang) set.add(lang[1].toLowerCase());
  const hreflang = [...html.matchAll(/hreflang=["']([a-z-]+)["']/gi)].map((m) => m[1].toLowerCase());
  for (const h of hreflang) if (h !== "x-default") set.add(h);
  return [...set];
}
function services_(html: string): string[] {
  const items = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*>([^<]{3,40})<\/a>/gi)) {
    const t = m[1].trim();
    if (/service|treatment|solution|repair|consult|clean|install|design|plan|care|therapy|package/i.test(t)) items.add(t);
  }
  for (const m of html.matchAll(/<h[23][^>]*>([^<]{3,50})<\/h[23]>/gi)) {
    const t = m[1].trim();
    if (/service|solution|what we|offer|treatment/i.test(t) === false && t.split(" ").length <= 5 && /[A-Z]/.test(t)) items.add(t);
  }
  return [...items].slice(0, 15);
}
// Primary call-to-action detection. Matches anchor/button text INCLUDING nested markup (a "Free
// Consultation" button often wraps its label in spans), strips inner tags, and recognizes the common
// service-business actions — notably consultation/estimate/demo, whose omission wrongly fired noClearCTA
// on pages that clearly DO have a prominent action (the Segal "Free Consultation" contradiction).
// Raw-text CTA fallback: a strong, unambiguous call-to-action phrase anywhere in the captured markup
// (link text, aria-label, button label, nested span) — catches the actions the anchor scan can't see.
export function strongCtaPhrase(html: string): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
  const m = text.match(/\b(free consultation|schedule (a|your) consultation|request (a )?(free )?consultation|book (now|online|a|your)|book an appointment|get (a )?free (quote|consultation|estimate)|request (a )?(free )?(quote|estimate)|schedule (a|your) (appointment|call)|get started today)\b/i);
  return m ? m[0].replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

export function primaryCta(html: string): string {
  const candidates = [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]{2,120}?)<\/(?:a|button)>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 2 && t.length <= 42);
  return candidates.find((t) => /\b(book|schedule|get (a )?quote|request (a )?quote|contact|call (us|now|today)|request|get started|sign up|appointment|consult|consultation|free consultation|estimate|get a demo|reserve|make an appointment|talk to (us|an)|get in touch|apply now|enroll|order now)\b/i.test(t)) ?? "";
}
function detectBooking(lc: string): string | null {
  const tools: Array<[RegExp, string]> = [[/calendly/, "Calendly"], [/acuityscheduling|acuity/, "Acuity"], [/squareup\.com\/appointments|square appointments/, "Square"], [/booksy/, "Booksy"], [/setmore/, "Setmore"], [/youcanbook\.me/, "YouCanBook.me"], [/simplybook/, "SimplyBook"], [/vagaro/, "Vagaro"]];
  for (const [re, name] of tools) if (re.test(lc)) return name;
  if (/\b(book (now|online|an appointment)|schedule (now|online|an appointment))\b/.test(lc)) return "on-site booking";
  return null;
}
// Junk / non-contact addresses that appear in markup but are never a real business inbox:
// tracking/CDN/builder placeholders, template stubs, and image/asset filenames.
const EMAIL_JUNK_RE = /(sentry|wixpress|example\.(com|org)|godaddy|squarespace|cloudflare|domain\.com|yourdomain|your-email|email@|name@|user@|\.(png|jpe?g|gif|webp|svg)$|u00|sentry-next|localhost)/i;
const ROLE_LOCALPARTS = ["info", "contact", "hello", "office", "hi", "admin", "reception", "appointments", "frontdesk", "front.desk", "bookings", "team", "mail"];

/** PURE: every plausible email address in the page markup (mailto: links + inline text). */
export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/href=["']mailto:([^"'?&>]+)/gi)) {
    const e = decodeURIComponent(m[1].trim()).toLowerCase();
    if (e) found.add(e);
  }
  for (const m of html.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)) {
    found.add(m[0].trim().toLowerCase());
  }
  return [...found].filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !EMAIL_JUNK_RE.test(e));
}

/** The registrable-ish host of a URL or email domain (last two labels), for same-site matching. */
function siteHost(urlOrDomain: string): string {
  const host = urlOrDomain.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  const labels = host.split(".").filter(Boolean);
  return labels.length >= 2 ? labels.slice(-2).join(".") : host;
}

/**
 * PURE: choose the single most trustworthy business inbox from candidates, or null.
 * Prefers an address on the business's OWN domain (so we never send to the web designer's
 * or a directory's address), then a role inbox (info@/office@…), then the first same-site
 * one. Returns a non-same-domain address only when NO same-domain address exists (a small
 * business that publishes its gmail) — downstream promotion still gates on same-domain.
 */
export function pickBusinessEmail(emails: string[], siteUrl: string | null | undefined): string | null {
  if (!emails.length) return null;
  const site = siteUrl ? siteHost(siteUrl) : "";
  const sameSite = site ? emails.filter((e) => siteHost(e.split("@")[1] ?? "") === site) : [];
  const pool = sameSite.length ? sameSite : emails;
  const role = pool.find((e) => ROLE_LOCALPARTS.includes(e.split("@")[0]));
  return role ?? pool[0] ?? null;
}

/** True when an email is safe to auto-adopt as the lead's send route: valid AND on the
 *  business's own website domain (the "reasonably trustworthy" bar — never a stray third party). */
export function isSameSiteEmail(email: string | null | undefined, websiteDomain: string | null | undefined): boolean {
  if (!email || !websiteDomain) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
  return siteHost(email.split("@")[1] ?? "") === siteHost(websiteDomain);
}

function contactPaths_(html: string): string[] {
  const out: string[] = [];
  if (/href=["']tel:/i.test(html)) out.push("phone");
  if (/href=["']mailto:/i.test(html)) out.push("email");
  if (/href=["'][^"']*contact/i.test(html)) out.push("contact page");
  if (/<form[\s>]/i.test(html)) out.push("form");
  return out;
}
function countLocations(text: string): number {
  const zips = new Set([...text.matchAll(/\b\d{5}(?:-\d{4})?\b/g)].map((m) => m[0].slice(0, 5)));
  const suiteWords = (text.match(/\b(suite|ste|unit|floor)\b/gi) || []).length;
  return Math.max(zips.size, suiteWords > 1 ? 2 : 1);
}
function trustIndicators(text: string): string[] {
  const out: string[] = [];
  if (/testimonial|what our (clients|customers|patients) say|reviews/i.test(text)) out.push("testimonials");
  if (/\b(licensed|certified|accredited|insured|award)\b/i.test(text)) out.push("credentials");
  if (/\b(\d{1,3}\+? years|since \d{4}|established \d{4})\b/i.test(text)) out.push("longevity");
  if (/\bguarantee|warranty\b/i.test(text)) out.push("guarantee");
  if (/case stud/i.test(text)) out.push("case studies");
  return out;
}
function structuredDataTypes(html: string): string[] {
  const types = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1]);
  }
  return [...types].slice(0, 8);
}
function imgAltRatio(html: string): number | null {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  if (!imgs.length) return null;
  const withAlt = imgs.filter((t) => /\balt=["'][^"']+["']/i.test(t)).length;
  return withAlt / imgs.length;
}
function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
