// ─────────────────────────────────────────────────────────────────────────────
// Website analysis adapter.
//
// Deterministic checks run first (HTTPS, metadata, CTA/contact-path, form, tech,
// PageSpeed) against permitted PUBLIC pages only — never authenticated, private,
// or sensitive pages. Their evidence is what the AI layer later interprets; we do
// not claim a private workflow exists based on a public website.
//
// Screenshot CAPTURE (headless browser) is intentionally NOT run inside the main
// web service — a fragile browser in the request path is a reliability risk. When
// a screenshot worker is configured (SCREENSHOT_WORKER_URL), real captures are
// requested from it; otherwise deterministic placeholder images are used. See
// docs/DEPLOYMENT.md for the worker architecture.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { WebsiteSignals } from "../scoring";
import type { FindingResult } from "../schemas";

export type AnalyzedFinding = FindingResult & { sourceUrl: string | null };

export interface WebsiteAnalysis {
  signals: WebsiteSignals;
  findings: AnalyzedFinding[];
  screenshots: Array<{ pageUrl: string; viewport: "mobile" | "desktop"; caption: string; storageUrl: string; storageKey: string | null }>;
  performedWith: "mock" | "live-fetch" | "live-fetch+pagespeed";
}

function placeholder(label: string, viewport: "mobile" | "desktop") {
  const w = viewport === "mobile" ? 390 : 1280;
  const h = viewport === "mobile" ? 780 : 800;
  return `/api/placeholder?w=${w}&h=${h}&label=${encodeURIComponent(label)}`;
}

async function fetchText(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "ArtifexOutreachBot/1.0 (+https://artifexlabs.tech)" } });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html: html.slice(0, 500_000), finalUrl: res.url };
  } catch {
    return { ok: false, status: 0, html: "", finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

async function pageSpeed(url: string): Promise<{ lcpMs: number; score: number } | null> {
  const key = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${key}`;
    const res = await fetch(api, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const lcp = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue ?? 0;
    const score = (data.lighthouseResult?.categories?.performance?.score ?? 0) * 100;
    return { lcpMs: Math.round(lcp), score: Math.round(score) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Heuristic fallback signals when the site can't be fetched (offline/dev). */
function heuristicSignals(lead: Lead): WebsiteSignals {
  const seed = lead.normalizedName.length;
  return {
    hasWebsite: Boolean(lead.website),
    mobileFriendly: seed % 3 === 0,
    slowLoad: seed % 2 === 0,
    hasOnlineBooking: seed % 4 === 0 && lead.industry !== "Home-service company",
    hasLeadForm: Boolean(lead.contactFormUrl),
  };
}

export async function analyzeWebsite(lead: Lead): Promise<WebsiteAnalysis> {
  if (!lead.website) {
    return {
      signals: { hasWebsite: false, mobileFriendly: false, slowLoad: false, hasOnlineBooking: false, hasLeadForm: false },
      findings: [
        {
          category: "Search visibility",
          title: "No dedicated website found",
          observation: "The business appears to rely on its Google listing with no standalone website.",
          evidence: "No website URL present on the business profile.",
          businessImpact: "Limits credibility and the ability to convert searchers into booked customers.",
          modernizationDirection: "Launch a fast, mobile-first website with clear calls to action.",
          findingType: "Verified fact",
          confidence: "Verified",
          sourceUrl: null,
        },
      ],
      screenshots: [],
      performedWith: "mock",
    };
  }

  const url = lead.website;
  const page = await fetchText(url);
  const findings: AnalyzedFinding[] = [];
  let performedWith: WebsiteAnalysis["performedWith"] = "mock";

  let signals: WebsiteSignals;
  if (page.ok && page.html) {
    performedWith = "live-fetch";
    const html = page.html.toLowerCase();
    const httpsOk = page.finalUrl.startsWith("https://");
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(page.html);
    const hasForm = /<form[\s>]/i.test(html);
    const hasBooking = /(book|schedule|appointment|reserve|calendly|acuity|squareup|booksy)/.test(html);
    const hasContactPath = /(tel:|mailto:|contact)/.test(html);
    const title = (page.html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const hasDescription = /<meta[^>]+name=["']description["']/i.test(page.html);

    const ps = await pageSpeed(url);
    if (ps) performedWith = "live-fetch+pagespeed";
    const slowLoad = ps ? ps.lcpMs > 2500 : false;

    signals = { hasWebsite: true, mobileFriendly: hasViewport, slowLoad, hasOnlineBooking: hasBooking, hasLeadForm: hasForm };

    if (!httpsOk) {
      findings.push(fnd("Security", "Site is not served over HTTPS", "The homepage did not resolve over a secure HTTPS connection.", `Final URL: ${page.finalUrl}`, "Visitors may see browser security warnings; hurts trust and SEO.", "Enable HTTPS with a valid certificate.", "Automated technical finding", "Verified", url));
    }
    if (!hasViewport) {
      findings.push(fnd("Mobile usability", "No mobile viewport configured", "The page lacks a responsive viewport meta tag.", "No <meta name=viewport> found in the homepage HTML.", "The site likely does not adapt to phones, hurting mobile visitors.", "Add responsive design with a proper viewport.", "Automated technical finding", "Verified", url));
    }
    if (ps && slowLoad) {
      findings.push(fnd("Page speed", "Homepage is slow on mobile", `Largest Contentful Paint measured at ~${(ps.lcpMs / 1000).toFixed(1)}s (performance score ${ps.score}).`, `Google PageSpeed Insights (mobile): LCP ${ps.lcpMs}ms, score ${ps.score}/100.`, "Slow loads increase bounce rate on paid and organic traffic.", "Optimize images and rebuild on a modern framework.", "Automated technical finding", "Verified", url));
    }
    if (!hasForm && !hasContactPath) {
      findings.push(fnd("Conversion journey", "No obvious contact path", "The homepage exposes neither a form nor a tel/mailto contact link.", "No <form>, tel:, or mailto: detected on the homepage.", "Prospective customers may struggle to make contact, losing inquiries.", "Add a clear contact/booking call to action and intake form.", "AI inference", "Likely", url));
    } else if (!hasForm) {
      findings.push(fnd("Conversion journey", "No online lead/intake form", "Contact appears to rely on phone/email rather than an online form.", "No <form> element detected on the homepage.", "After-hours interest is lost and staff handle repetitive intake.", "Add an online intake form with automated confirmations.", "AI inference", "Likely", url));
    }
    if (!hasDescription || !title) {
      findings.push(fnd("Search visibility", "Weak homepage metadata", "The homepage is missing a title and/or meta description.", `Title: ${title || "(missing)"}; description present: ${hasDescription}.`, "Reduces click-through from search results.", "Add descriptive title and meta description.", "Automated technical finding", "Verified", url));
    }
  } else {
    // Could not fetch (offline/dev/blocked) — fall back to heuristic signals.
    signals = heuristicSignals(lead);
    if (!signals.mobileFriendly) findings.push(fnd("Mobile usability", "Primary action likely hard to reach on mobile", "Automated heuristic (site not directly reachable during analysis).", "Heuristic estimate; re-run when the site is reachable for verified evidence.", "Mobile visitors may leave before contacting.", "Persistent, thumb-friendly primary action on mobile.", "AI inference", "Unknown", url));
    if (!signals.hasLeadForm) findings.push(fnd("Conversion journey", "No online lead/intake form detected", "Automated heuristic (site not directly reachable during analysis).", "Heuristic estimate; re-run for verified evidence.", "After-hours interest may be lost.", "Add an online intake form.", "AI inference", "Unknown", url));
  }

  // Screenshots — request from worker if configured, else placeholders.
  const screenshots = await captureScreenshots(lead);

  // Cap to 3 primary findings for a focused brief.
  return { signals, findings: findings.slice(0, 3), screenshots, performedWith };
}

function fnd(
  category: string,
  title: string,
  observation: string,
  evidence: string,
  businessImpact: string,
  modernizationDirection: string,
  findingType: FindingResult["findingType"],
  confidence: FindingResult["confidence"],
  sourceUrl: string,
): AnalyzedFinding {
  return { category, title, observation, evidence, businessImpact, modernizationDirection, findingType, confidence, sourceUrl };
}

async function captureScreenshots(lead: Lead): Promise<WebsiteAnalysis["screenshots"]> {
  const worker = process.env.SCREENSHOT_WORKER_URL;
  const pages: Array<{ pageUrl: string; viewport: "mobile" | "desktop"; caption: string }> = [
    { pageUrl: lead.website!, viewport: "desktop", caption: `${lead.businessName} — Homepage (desktop)` },
    { pageUrl: lead.website!, viewport: "mobile", caption: `${lead.businessName} — Homepage (mobile)` },
    { pageUrl: lead.contactFormUrl ?? `${lead.website}/contact`, viewport: "mobile", caption: `${lead.businessName} — Contact (mobile)` },
  ];
  if (!worker) {
    return pages.map((p) => ({ ...p, storageUrl: placeholder(p.caption, p.viewport), storageKey: null }));
  }
  // Real capture path: delegate to the screenshot worker (Playwright), which
  // stores images and returns their URLs/keys. Falls back to placeholders on error.
  try {
    const res = await fetch(`${worker.replace(/\/$/, "")}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SCREENSHOT_WORKER_TOKEN ?? ""}` },
      body: JSON.stringify({ leadId: lead.id, pages }),
    });
    if (!res.ok) throw new Error(`worker ${res.status}`);
    const data = (await res.json()) as { screenshots: WebsiteAnalysis["screenshots"] };
    return data.screenshots;
  } catch {
    return pages.map((p) => ({ ...p, storageUrl: placeholder(p.caption, p.viewport), storageKey: null }));
  }
}
