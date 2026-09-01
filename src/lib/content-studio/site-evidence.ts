// Content Studio — DEEP PER-SITE EVIDENCE → directly-observed findings (final revenue-blocker delta).
//
// The prior pipeline inspected ONLY the homepage and emitted a single AI-INFERRED finding ("No <form>
// on the homepage → No online lead/intake form", confidence "Likely"). The mandate forbids that: a
// finding must describe something concretely visible or mechanically verified after inspecting MULTIPLE
// pages, and must never infer a form is absent merely because the homepage screenshot didn't show one.
//
// This module is the PURE, deterministic derivation half: given the DOM facts captured across a site's
// pages (scripts/lib/site-capture.mjs does the Playwright/SSRF capture), it emits ONLY directly-observed
// findings, each with an exact page, the observed element/absence, reproduction steps, and concrete
// provenance. Every emitted observation is written to survive the review-evidence sendability gate
// (Observed confidence, non-empty concrete basis, observable category, NO speculative/hedging language),
// and each finding classifies to a distinct semantic TOPIC so genuinely different sites produce
// genuinely different scripts (BreakBot then can't call them template-equivalent).

import type { ModernizationOpportunity, OpportunityCategory, ImpactLevel } from "../business-intelligence/types";
import { confidence } from "../business-intelligence/confidence";
import type { TopicKey } from "../outreach/review-evidence";

// ── Captured facts (persisted by the capture worker/script; this module never fetches) ──────────────
export interface FormFacts {
  action: string | null;
  inputCount: number;
  hasTextInput: boolean;   // a text/textarea/name field — a real intake affordance, not just a search box
  hasEmailInput: boolean;
  hasSubmit: boolean;
  isSearchOnly: boolean;   // a lone search box does not count as a contact/intake form
}

export type PageRole = "home" | "contact" | "services" | "booking" | "about" | "other";

export interface PageFacts {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  role: PageRole;
  status: number;              // HTTP status of the document itself
  viewportWidth: number;       // the mobile width the overflow was measured at (e.g. 390)
  hasViewportMeta: boolean;
  metaDescription: string | null;
  overflowPx: number;          // documentElement.scrollWidth - innerWidth at viewportWidth (>0 = sideways scroll)
  forms: FormFacts[];
  primaryCtas: string[];       // prominent, above-the-fold button/link labels (deduped, trimmed)
  navItemCount: number;
  navItems: string[];
  phoneLinks: number;          // count of tel: links
  mailLinks: number;           // count of mailto: links
  bookingSignals: string[];    // detected scheduling affordances (e.g. "calendly", "book online", "schedule")
  brokenAssets: number;        // images/links that returned >= 400
  brokenAssetSamples: string[];
  placeholderHits: string[];   // lorem/placeholder/"coming soon" text actually present
  headerName: string | null;   // business name as shown in the header/logo alt
  footerName: string | null;   // business name as shown in the footer
}

export interface SiteEvidence {
  leadId: string;
  businessName: string;
  website: string;
  industry?: string | null;
  pages: PageFacts[];
  capturedAt: string;
}

// A directly-observed finding: what was seen, where, how to reproduce it, and the provenance behind it.
export interface ObservedFinding {
  key: string;                 // stable rule key (e.g. "no-contact-form")
  topic: TopicKey;             // drives the review title/intervention + cross-site distinctness
  category: OpportunityCategory;
  impactLevel: ImpactLevel;
  observation: string;         // concrete, declarative, NON-speculative
  whyItMatters: string;
  basis: string[];             // concrete provenance strings (page URLs + measured facts)
  reproduction: string[];      // operator-checkable steps
  sourcePageUrl: string;       // the exact page the evidence lives on (the screenshot target)
  sourcePageTitle: string;
}

// The exact hedging/inference vocabulary the review-evidence gate rejects (review-evidence.ts
// SPECULATIVE_RX). Kept here so tests can assert every emitted observation is gate-clean, and so the
// derivation authors observations that are declarations of fact, not guesses.
export const SPECULATIVE_RX =
  /\b(may|might|could|probably|likely|perhaps|possibly|seems?|appears?|look(?:s|ing)?\s+(?:developing|thin|limited|basic)|little sign|from the outside|behind the scenes|we (?:think|suspect|believe)|internal|back[\s-]?office|manual(?:ly)?|repetitive)\b/i;

export function isSpeculative(text: string): boolean {
  return SPECULATIVE_RX.test(text);
}

// Verticals where the ABSENCE of online booking is itself a finding (customers expect to book online).
// For a hardware store, "no online booking" is not a gap; for a dental practice it is.
const BOOKING_EXPECTED_RX = /dent|orthodont|salon|spa|barber|beauty|medspa|clinic|derma|chiro|physical therapy|physio|vet|veterinar|fitness|pilates|yoga|massage|nail/i;

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// A form counts as a real contact/intake affordance only if it has a text or email field and is not a
// bare search box — so "no intake form" is judged against genuine intake forms, not site search.
function isIntakeForm(f: FormFacts): boolean {
  return !f.isSearchOnly && (f.hasEmailInput || f.hasTextInput) && f.inputCount >= 1;
}

const list = (xs: string[]): string => xs.length <= 1 ? (xs[0] ?? "") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

// ── The derivation. Each rule returns a finding ONLY when a concrete fact supports it. ──────────────
// Rules are ordered strongest-first; the caller keeps a distinct-topic subset. Nothing here fabricates:
// if the facts don't support a rule, it emits nothing (and a site can legitimately yield ZERO findings).
export function deriveObservedFindings(site: SiteEvidence): ObservedFinding[] {
  const out: ObservedFinding[] = [];
  const home = site.pages.find((p) => p.role === "home") ?? site.pages[0];
  if (!home) return out;
  const pages = site.pages.filter((p) => p.status < 400); // reason only over pages we actually rendered
  const inspected = pages.length;
  const pageUrls = pages.map((p) => p.finalUrl);

  // 1) MOBILE — the homepage forces horizontal scrolling on a phone (measured overflow). High impact.
  if (home.overflowPx >= 16) {
    out.push({
      key: "mobile-overflow", topic: "mobile", category: "Customer Acquisition", impactLevel: "High",
      observation: `On a ${home.viewportWidth}-pixel phone screen the homepage is ${home.overflowPx} pixels wider than the screen, so visitors have to scroll sideways to read it.`,
      whyItMatters: "Most first visits are on a phone; a page that spills off-screen makes the first ten seconds feel broken and pushes people back to search results.",
      basis: [home.finalUrl, `measured at ${home.viewportWidth}px viewport: document width exceeds the screen by ${home.overflowPx}px (horizontal scroll present)`],
      reproduction: ["Open the homepage on a phone, or in a browser window set to 390px wide.", "The page scrolls sideways / content runs past the right edge."],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  } else if (!home.hasViewportMeta) {
    // Same topic as overflow (only one "mobile" finding survives), used when there's no overflow but the
    // page ships no viewport tag, so phones shrink it to desktop width.
    out.push({
      key: "no-viewport-meta", topic: "mobile", category: "Customer Acquisition", impactLevel: "High",
      observation: `The homepage ships no mobile viewport tag, so phones render it at desktop width and shrink the text to fit.`,
      whyItMatters: "Shrunk-to-fit text is hard to read on a phone, and phones are where most first visits happen.",
      basis: [home.finalUrl, "no <meta name=\"viewport\"> element in the homepage HTML"],
      reproduction: ["Open the homepage on a phone.", "The whole desktop layout is scaled down; text is tiny until you pinch-zoom."],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  // 2) CONTACT — no intake form ANYWHERE, and we ACTUALLY inspected a contact page (the mandate's core
  // correction: never conclude "no form" from the homepage alone). High impact.
  const contactPage = pages.find((p) => p.role === "contact");
  const anyIntake = pages.some((p) => p.forms.some(isIntakeForm));
  if (contactPage && !anyIntake && inspected >= 2) {
    const hasMail = pages.some((p) => p.mailLinks > 0);
    const reach = hasMail ? "a phone number and an email address" : "a phone number";
    out.push({
      key: "no-contact-form", topic: "contact", category: "Communication", impactLevel: "High",
      observation: `Across the ${inspected} pages inspected — including the contact page — there is no contact or intake form; the only published way to reach the business is ${reach}.`,
      whyItMatters: "A visitor ready to act at 9pm has to remember to call during business hours; without a form that intent is lost overnight.",
      basis: [contactPage.finalUrl, `no <form> with a name/email/message field on ${inspected} inspected pages (contact page included: ${contactPage.finalUrl})`, ...pageUrls.slice(0, 4)],
      reproduction: ["Open the site's Contact page.", `Confirm there is no form to fill in — only ${reach}.`],
      sourcePageUrl: contactPage.finalUrl, sourcePageTitle: contactPage.title,
    });
  }

  // 3) BOOKING — a booking-expected vertical with no online scheduler anywhere. High impact.
  const bookingExpected = BOOKING_EXPECTED_RX.test(`${site.industry ?? ""} ${site.businessName}`);
  const anyBooking = pages.some((p) => p.bookingSignals.length > 0);
  if (bookingExpected && !anyBooking && inspected >= 2 && pages.some((p) => p.phoneLinks > 0)) {
    out.push({
      key: "no-online-booking", topic: "booking", category: "Scheduling", impactLevel: "High",
      observation: `No online booking or appointment scheduler is present on any of the ${inspected} pages inspected; the only way to book is to call during business hours.`,
      whyItMatters: "Patients and clients increasingly book after hours from a phone; phone-only booking loses the ones who won't call back.",
      basis: [home.finalUrl, `no scheduling widget or "book"/"schedule" affordance found across ${inspected} inspected pages`, ...pageUrls.slice(0, 4)],
      reproduction: ["Look for a Book / Schedule / Request Appointment control on the homepage and services page.", "Confirm booking is phone-only."],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  // 4) CTA — several equally-weighted primary buttons above the fold, no single next step. Moderate.
  const ctas = home.primaryCtas.filter((c, i, a) => a.indexOf(c) === i);
  if (ctas.length >= 3) {
    out.push({
      key: "competing-ctas", topic: "cta", category: "Customer Acquisition", impactLevel: "Moderate",
      observation: `The homepage puts ${ctas.length} competing primary buttons (${list(ctas.slice(0, 4).map((c) => `"${c}"`))}) above the fold, with no single emphasized next step.`,
      whyItMatters: "When everything is a primary action, nothing is; visitors hesitate instead of clicking the one thing that matters.",
      basis: [home.finalUrl, `${ctas.length} prominent above-the-fold CTAs: ${ctas.slice(0, 6).join(" | ")}`],
      reproduction: ["Open the homepage.", `Count the equally-weighted primary buttons above the fold — there are ${ctas.length}.`],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  // 5) NAVIGATION — an overcrowded top-level menu. Moderate.
  if (home.navItemCount >= 9) {
    out.push({
      key: "crowded-nav", topic: "navigation", category: "Customer Acquisition", impactLevel: "Moderate",
      observation: `The main navigation lists ${home.navItemCount} top-level menu items, so the primary path competes with ${home.navItemCount - 1} others.`,
      whyItMatters: "A crowded menu spreads attention thin and makes the one page you want people on harder to find.",
      basis: [home.finalUrl, `${home.navItemCount} top-level nav items: ${home.navItems.slice(0, 10).join(" | ")}`],
      reproduction: ["Open the homepage.", `Count the top-level menu entries — there are ${home.navItemCount}.`],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  // 6) PLACEHOLDER — unfinished template/placeholder copy still live. Moderate.
  const placeholderPage = pages.find((p) => p.placeholderHits.length > 0);
  if (placeholderPage) {
    const sample = placeholderPage.placeholderHits[0].slice(0, 60);
    out.push({
      key: "placeholder-copy", topic: "copy", category: "Brand Experience", impactLevel: "Moderate",
      observation: `The ${placeholderPage.role} page still shows unfinished placeholder text ("${sample}") instead of finished copy.`,
      whyItMatters: "Leftover placeholder text reads as unfinished and quietly erodes trust at the moment someone is deciding.",
      basis: [placeholderPage.finalUrl, `placeholder/template text present on ${placeholderPage.finalUrl}: "${sample}"`],
      reproduction: [`Open ${placeholderPage.finalUrl}.`, `Find the placeholder text: "${sample}".`],
      sourcePageUrl: placeholderPage.finalUrl, sourcePageTitle: placeholderPage.title,
    });
  }

  // 7) BROKEN ASSETS — links/images that 404. Moderate. (topic "general" → titled from the observation.)
  if (home.brokenAssets >= 1) {
    out.push({
      key: "broken-assets", topic: "general", category: "Brand Experience", impactLevel: "Moderate",
      observation: `${home.brokenAssets} links or images on the homepage fail to load and return HTTP 404.`,
      whyItMatters: "A broken link or missing image at the top of a visit signals neglect and interrupts the path to contact.",
      basis: [home.finalUrl, `${home.brokenAssets} homepage resources returned >=400: ${home.brokenAssetSamples.slice(0, 4).join(" | ")}`],
      reproduction: ["Open the homepage.", `Follow the flagged links/images: ${home.brokenAssetSamples.slice(0, 2).join(" ; ")}.`],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  // 8) BRAND — the business name is written inconsistently across the page furniture. Moderate.
  // Guard: the footer often repeats the header name plus boilerplate ("… All Rights Reserved"); that is
  // the SAME name, not an inconsistency. Only fire when neither name contains the other.
  const hn = norm(home.headerName || ""), fn = norm(home.footerName || "");
  const sameName = hn && fn && (hn.includes(fn) || fn.includes(hn));
  if (home.headerName && home.footerName && hn !== fn && hn.length >= 3 && fn.length >= 3 && !sameName) {
    out.push({
      key: "name-inconsistency", topic: "brand", category: "Brand Experience", impactLevel: "Moderate",
      observation: `The business name is written inconsistently on the homepage — "${home.headerName}" in the header and "${home.footerName}" in the footer.`,
      whyItMatters: "An inconsistent name makes the business harder to remember and to find again by search.",
      basis: [home.finalUrl, `header name "${home.headerName}" vs footer name "${home.footerName}" on ${home.finalUrl}`],
      reproduction: ["Open the homepage.", "Compare the name in the header to the name in the footer."],
      sourcePageUrl: home.finalUrl, sourcePageTitle: home.title,
    });
  }

  return out;
}

// Keep at most one finding per topic (strongest first), so a site's script never repeats itself and
// cross-site distinctness is judged on genuinely different problems.
export function distinctByTopic(findings: ObservedFinding[]): ObservedFinding[] {
  const seen = new Set<string>();
  const kept: ObservedFinding[] = [];
  for (const f of findings) { if (seen.has(f.topic)) continue; seen.add(f.topic); kept.push(f); }
  return kept;
}

// Convert observed findings into review-ready opportunities the EXISTING pipeline consumes
// (buildQuickReview → selectReviewFindings). confidence is "Observed" (directly seen), basis is the
// concrete provenance, category is observable — so isSendable() accepts them and the evidence gate lets
// generation proceed. Deterministic id from the rule key keeps re-runs stable.
export function toOpportunities(findings: ObservedFinding[], leadId: string): ModernizationOpportunity[] {
  return findings.map((f) => ({
    id: `opp_${leadId}_${f.key}`.replace(/[^0-9a-z_]/gi, "_"),
    category: f.category,
    observation: f.observation,
    whyItMatters: f.whyItMatters,
    estimatedImpact: { level: f.impactLevel, rationale: f.reproduction.join(" ") },
    confidence: confidence("Observed"),
    basis: f.basis,
  }));
}
