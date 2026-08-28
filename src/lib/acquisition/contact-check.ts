// ─────────────────────────────────────────────────────────────────────────────
// Contact-first gate — establish a business has a PUBLISHED, relevant email BEFORE any expensive
// work (deep BI/AI, screenshots, PageSpeed, PDF, video). Email is the cheap prerequisite; a business
// that can't be reached by email never earns paid research under the email-first model.
//
// Cheap by construction: a bounded homepage + a few contact/about pages via the EXISTING SSRF-safe
// fetcher (ssrf.safeFetch — 8s timeout, 2MB cap, 3-redirect + private-range blocks), reusing the
// battle-tested email regex/junk filter from the website-intelligence provider. No AI, no PageSpeed,
// no screenshots, no browser. The pure `extractContactFromPages` does the judgement with zero I/O so
// every rule below is unit-testable without a network.
//
// It never sends, never probes a mailbox, never guesses a pattern, never submits a form.
// ─────────────────────────────────────────────────────────────────────────────
import { safeFetch } from "../ssrf";
import { extractEmailsFromHtml, isSameSiteEmail } from "../intelligence/providers/website-intelligence";
import { validEmail } from "./compliance";

export const MAX_PAGES = 4; // homepage + up to 3 contact/about pages, per business, per pass

export type ContactOutcome =
  | "found"          // an appropriate published business email was established
  | "no-website"     // nothing to check — no website on file
  | "not-found"      // pages fetched, no appropriate address present (NOT proof none exists)
  | "fetch-failed"   // homepage could not be retrieved / blocked (distinct from not-found)
  | "ambiguous";     // addresses present but none can be trusted as THE business contact

export interface ContactCheckResult {
  outcome: ContactOutcome;
  email: string | null;
  sourceUrl: string | null;     // the page the chosen email was seen on
  observedAt: string;           // ISO time of the check
  pagesExamined: string[];      // URLs actually fetched (bounded ≤ MAX_PAGES)
  domainMatched: boolean;       // chosen email is on the business's own website domain
  reason: string;               // why-it-belongs, or why-not
  candidates: string[];         // all appropriate addresses seen (for audit / ambiguity)
}

// Inboxes that are NOT a business sales/contact address (privacy/abuse/careers/automated/specialist).
const REJECT_LOCALPARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "postmaster", "mailer-daemon", "bounce", "bounces",
  "abuse", "privacy", "dpo", "gdpr", "unsubscribe", "compliance",
  "careers", "career", "jobs", "job", "recruiting", "recruit", "recruitment", "hr", "humanresources",
  "press", "media", "pr", "legal", "dmca", "security", "webmaster", "hostmaster", "spam",
  // template/placeholder local-parts that ship in unedited theme markup ("your@email.com" etc.)
  "your", "youremail", "yourname", "firstname", "lastname", "example", "sample", "demo", "placeholder",
]);
// Never adopt our own / test / template-placeholder addresses (defense-in-depth; the extractor's
// junk filter already drops most, but isAppropriateContact must stand on its own).
const INTERNAL_DENY = /(jordant\.jackson@gmail\.com|@example\.|@test\.|@artifexlabs\.tech|noreply@|no-reply@|yourdomain|your-email|@domain\.com|@yourcompany|email@|name@|user@)/i;
const CONTACT_HINT = /(contact|about|reach|connect|get-?in-?touch|team|company)/i;

/** Is this address a plausible business-inquiry inbox (not automated/specialist/internal)? */
export function isAppropriateContact(email: string): boolean {
  if (!validEmail(email)) return false;
  if (INTERNAL_DENY.test(email)) return false;
  const local = email.split("@")[0].toLowerCase().replace(/\+.*$/, "");
  if (REJECT_LOCALPARTS.has(local)) return false;
  return true;
}

const ROLE_PREFERENCE = ["info", "contact", "hello", "office", "hi", "reception", "appointments", "bookings", "sales", "admin", "team", "mail"];

/**
 * PURE: choose THE business contact from a candidate set, or null. Same-site addresses win (never a
 * web-designer's or directory's inbox); among those a role inbox (info@/office@…) is preferred. If NO
 * same-site address exists, a published free-mail (e.g. a small business's gmail) is accepted — the
 * directive explicitly allows that — but flagged domainMatched=false so downstream can weigh it.
 */
export function pickContactEmail(emails: string[], siteUrl: string | null | undefined): { email: string | null; domainMatched: boolean } {
  const pool = [...new Set(emails.map((e) => e.toLowerCase()))].filter(isAppropriateContact);
  if (!pool.length) return { email: null, domainMatched: false };
  const sameSite = pool.filter((e) => isSameSiteEmail(e, siteUrl ?? null));
  const chooseFrom = sameSite.length ? sameSite : pool;
  const byRole = ROLE_PREFERENCE.map((r) => chooseFrom.find((e) => e.split("@")[0] === r)).find(Boolean);
  const email = byRole ?? chooseFrom[0];
  return { email, domainMatched: sameSite.length > 0 && sameSite.includes(email) };
}

/** PURE (no I/O): decide the contact outcome from already-fetched pages. Fully unit-testable. */
export function extractContactFromPages(
  pages: Array<{ url: string; html: string }>,
  siteUrl: string | null | undefined,
  now: string,
): ContactCheckResult {
  const base = { observedAt: now, pagesExamined: pages.map((p) => p.url), candidates: [] as string[] };
  if (!pages.length) return { outcome: "fetch-failed", email: null, sourceUrl: null, domainMatched: false, reason: "no pages retrieved", ...base };
  // Collect appropriate candidates, remembering which page each first appeared on.
  const seenOn = new Map<string, string>();
  for (const p of pages) for (const e of extractEmailsFromHtml(p.html)) { if (isAppropriateContact(e) && !seenOn.has(e)) seenOn.set(e, p.url); }
  const candidates = [...seenOn.keys()];
  const { email, domainMatched } = pickContactEmail(candidates, siteUrl);
  if (email) {
    return {
      outcome: "found", email, sourceUrl: seenOn.get(email) ?? pages[0].url, domainMatched,
      reason: domainMatched ? "published on the business's own website domain" : "published as the business contact (non-domain free-mail)",
      ...base, candidates,
    };
  }
  // Pages fetched but nothing appropriate — distinguish "raw addresses present but all rejected"
  // (ambiguous) from "no address at all" (not-found).
  const anyRaw = pages.some((p) => extractEmailsFromHtml(p.html).length > 0);
  return anyRaw
    ? { outcome: "ambiguous", email: null, sourceUrl: null, domainMatched: false, reason: "addresses present but none is an appropriate business contact", ...base, candidates }
    : { outcome: "not-found", email: null, sourceUrl: null, domainMatched: false, reason: "no email found in the pages checked (not proof none exists)", ...base, candidates };
}

/** Pick up to (MAX_PAGES-1) same-host contact/about links from homepage markup. */
function contactLinksFrom(homepageHtml: string, homeUrl: string): string[] {
  let host = ""; try { host = new URL(homeUrl).host; } catch { return []; }
  const urls = new Set<string>();
  for (const m of homepageHtml.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const raw = m[1];
    if (!CONTACT_HINT.test(raw)) continue;
    let abs: URL; try { abs = new URL(raw, homeUrl); } catch { continue; }
    if (abs.host !== host) continue;                 // same host only
    if (!/^https?:$/.test(abs.protocol)) continue;
    urls.add(abs.toString().split("#")[0]);
  }
  return [...urls].slice(0, MAX_PAGES - 1);
}

/**
 * Bounded email check for one business. Fetches the homepage then up to MAX_PAGES-1 contact/about
 * pages (same host) via the SSRF-safe fetcher; returns a structured outcome. `cachedPages` (e.g. HTML
 * already stored on the BI profile) is consulted FIRST and, when it yields an address, skips the
 * network entirely. Never throws.
 */
export async function checkPublishedEmail(
  website: string | null | undefined,
  opts: { now?: string; cachedPages?: Array<{ url: string; html: string }> } = {},
): Promise<ContactCheckResult> {
  const now = opts.now ?? new Date().toISOString();
  const emptyBase = { email: null, sourceUrl: null, domainMatched: false, observedAt: now, pagesExamined: [] as string[], candidates: [] as string[] };
  if (!website || !/^https?:\/\//i.test(website.trim())) {
    const withScheme = website && !/^https?:\/\//i.test(website) ? `https://${website.trim()}` : website;
    if (!withScheme) return { outcome: "no-website", reason: "no website on file", ...emptyBase };
    website = withScheme;
  }
  // 1) Cheapest: reuse cached content if it already yields an address.
  if (opts.cachedPages?.length) {
    const cached = extractContactFromPages(opts.cachedPages, website, now);
    if (cached.outcome === "found") return cached;
  }
  // 2) Bounded live fetch (homepage → contact/about pages), reusing the secure fetcher.
  const pages: Array<{ url: string; html: string }> = [];
  const home = await safeFetch(website);
  if (!home.ok || !home.body) return { outcome: "fetch-failed", reason: `homepage fetch failed (${home.error ?? home.status})`, ...emptyBase, pagesExamined: [] };
  pages.push({ url: home.finalUrl || website, html: home.body });
  for (const link of contactLinksFrom(home.body, home.finalUrl || website)) {
    if (pages.length >= MAX_PAGES) break;
    const r = await safeFetch(link);            // sequential = one host at a time (natural per-host rate limit)
    if (r.ok && r.body) pages.push({ url: r.finalUrl || link, html: r.body });
  }
  return extractContactFromPages(pages, website, now);
}
