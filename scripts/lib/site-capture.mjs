// Content Studio — DEEP PER-SITE CAPTURE (final revenue-blocker delta). The screenshot worker captures a
// single homepage PNG; this captures the site the way a reviewer actually would: it discovers the
// business's OWN internal pages (contact / services / booking / about) from the homepage navigation and
// visits each, extracting the DOM facts a directly-observed finding needs (forms, CTAs, phone/mail links,
// nav, booking affordances, mobile overflow, broken images, placeholder copy, header/footer name) and a
// legible mobile PNG per page. It reuses the worker's SSRF discipline verbatim: http/https only, no
// credentials, every navigated document (initial + each redirect + every discovered page) is re-resolved
// and re-classified before connect, and only same-registrable-domain pages are followed. It NEVER submits
// a form, logs in, adds to a cart, or follows an off-domain link. Pure capture — derivation lives in the
// tested TS module src/lib/content-studio/site-evidence.ts.
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { classifyIp, normalizeCaptureUrl } from "./ssrf-guard.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const MOBILE = { width: 540, height: 960, deviceScaleFactor: 2, isMobile: true, outW: 1080, outH: 1920 };

// Resolve every A/AAAA for a host and classify each — ALL must be public (worker-identical).
async function assertHostPublic(hostname) {
  let addrs;
  try { addrs = await lookup(hostname, { all: true }); }
  catch (e) { return { ok: false, reason: `DNS failed for ${hostname}: ${e?.code || e?.message || e}` }; }
  if (!addrs.length) return { ok: false, reason: `no addresses for ${hostname}` };
  for (const a of addrs) { const v = classifyIp(a.address); if (!v.ok) return { ok: false, reason: `${hostname} → blocked ${v.category} ${a.address}` }; }
  return { ok: true };
}

// The registrable-ish domain (last two labels) — we only follow links that stay on the business's site.
function baseDomain(host) { const p = String(host).toLowerCase().split("."); return p.slice(-2).join("."); }

function roleOf(url, text = "") {
  const s = (url + " " + text).toLowerCase();
  if (/\/contact|contact-us|get-in-touch/.test(s) || /\bcontact\b/.test(text.toLowerCase())) return "contact";
  if (/book|appointment|schedul|reserv/.test(s)) return "booking";
  if (/service|treatment|product|menu|pricing|shop|collection/.test(s)) return "services";
  if (/about|our-story|who-we-are/.test(s)) return "about";
  return "other";
}

// Extracted in-page (browser context). Returns the raw DOM facts; no fetching, no mutation.
function extractFacts() {
  const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };

  // Forms — classify each as a real intake affordance vs. a bare search box.
  const forms = Array.from(document.querySelectorAll("form")).map((f) => {
    const inputs = Array.from(f.querySelectorAll("input,textarea,select"));
    const typeStr = inputs.map((i) => `${(i.getAttribute("type") || i.tagName).toLowerCase()} ${(i.getAttribute("name") || "")} ${(i.getAttribute("placeholder") || "")}`).join(" ").toLowerCase();
    const hasEmailInput = /email/.test(typeStr) || !!f.querySelector('input[type="email"]');
    const hasTextInput = !!f.querySelector("textarea") || /\b(name|message|comment|phone|tel|first|last|subject)\b/.test(typeStr) || !!f.querySelector('input[type="text"]');
    const hasSubmit = !!f.querySelector('button[type="submit"],input[type="submit"],button:not([type])');
    const roleSearch = (f.getAttribute("role") === "search") || /search/.test((f.getAttribute("class") || "") + " " + (f.getAttribute("id") || "") + " " + typeStr);
    const isSearchOnly = roleSearch && !hasEmailInput && !hasTextInput || (inputs.length === 1 && /search|query|\bq\b/.test(typeStr));
    return { action: f.getAttribute("action"), inputCount: inputs.length, hasTextInput, hasEmailInput, hasSubmit, isSearchOnly };
  });

  // Prominent above-the-fold CTAs — REAL action buttons only. We deliberately exclude accessibility
  // skip-links, plain navigation links, and social icons, and require an action verb, so a busy header
  // isn't miscounted as "competing CTAs". A CTA is a button-styled element with an action-verb label
  // that is NOT inside the site navigation.
  const skipRx = /^skip (to|navigation)/i;
  const actionRx = /\b(shop|book|buy|order|get|start|call|contact|schedule|request|sign ?up|join|subscribe|quote|apply|reserve|claim|try|download|explore|find|save|add to)\b/i;
  const foldCtas = [];
  for (const el of Array.from(document.querySelectorAll("a,button"))) {
    if (!vis(el)) continue;
    if (el.closest("nav")) continue;                 // nav links are navigation, not CTAs
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > 900) continue;
    const st = getComputedStyle(el);
    const bg = st.backgroundColor && st.backgroundColor !== "rgba(0, 0, 0, 0)" && st.backgroundColor !== "transparent";
    const looksBtn = bg || parseFloat(st.borderRadius) > 2 || /\b(btn|button|cta)\b/i.test(el.className || "") || el.tagName === "BUTTON";
    const label = txt(el);
    if (looksBtn && label && label.length >= 2 && label.length <= 30 && !skipRx.test(label) && actionRx.test(label)) foldCtas.push(label);
  }
  const primaryCtas = Array.from(new Set(foldCtas)).slice(0, 12);

  // Primary navigation — the first real nav/header menu; count its top-level entries.
  const navEl = document.querySelector("header nav, nav[role='navigation'], nav, header ul");
  const navLinks = navEl ? Array.from(navEl.querySelectorAll("a")).filter(vis).map(txt).filter((t) => t && t.length <= 30) : [];
  const navItems = Array.from(new Set(navLinks)).slice(0, 20);

  // Booking affordances anywhere in the page (links/buttons/iframes).
  const bookingRx = /calendly|acuity|squareup|\bbook\b|booking|schedul|appointment|zocdoc|vagaro|setmore|reserve|opentable|resy/i;
  const bookingSignals = [];
  for (const el of Array.from(document.querySelectorAll("a,button,iframe"))) {
    const hay = `${el.getAttribute("href") || ""} ${el.getAttribute("src") || ""} ${txt(el)}`;
    const m = hay.match(bookingRx);
    if (m) bookingSignals.push(m[0].toLowerCase());
  }

  // Broken IMAGES: loaded but zero natural size = a real broken/missing image. Count ONLY the site's OWN
  // content images — third-party trackers/beacons (a Bing/GA pixel that "fails") are not a broken asset.
  const baseHost = location.host.split(".").slice(-2).join(".");
  const trackerRx = /bing|doubleclick|googleadservices|google-analytics|googletagmanager|gstatic|facebook|fbcdn|hotjar|segment|analytics|\/pixel|beacon|\/action\b|\/collect\b|utm_|clarity/i;
  const imgs = Array.from(document.querySelectorAll("img"));
  const brokenImgs = imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.getAttribute("src") || "").trim()).filter((i) => {
    try { const h = new URL(i.src, location.href); return (h.host === location.host || h.host.endsWith(baseHost)) && !trackerRx.test(i.src); } catch { return false; }
  });
  const brokenAssetSamples = brokenImgs.slice(0, 5).map((i) => i.getAttribute("src"));

  // Placeholder / unfinished copy actually present in the rendered text.
  const bodyText = (document.body ? document.body.innerText : "") || "";
  const phRx = /(lorem ipsum[^.]{0,40}|coming soon|your (?:text|content|title) here|insert [a-z ]{3,20} here|sample text|placeholder text)/gi;
  const placeholderHits = Array.from(new Set((bodyText.match(phRx) || []).map((s) => s.trim()))).slice(0, 5);

  // Header/footer business name (heuristic, CONSERVATIVE): only accept a logo alt / header link that
  // actually reads like a business name — reject promo-banner alts ("...New Look 16x9"), anything with
  // digits, or long marketing phrases. A wrong name is worse than none, so we prefer null.
  const headerEl = document.querySelector("header") || document.body;
  const nameLike = (s) => { const t = (s || "").trim(); return t && t.split(/\s+/).length <= 5 && !/\d|x\d|new look|feel|banner|promo|sale|shop now|menu|logo\b/i.test(t) ? t : null; };
  const logoImg = headerEl.querySelector("img[alt]");
  const headerName = nameLike(logoImg && logoImg.getAttribute("alt")) || nameLike(txt(headerEl.querySelector("a[href='/'], .logo, [class*='logo'] a, h1"))) || null;
  const footEl = document.querySelector("footer");
  let footerName = null;
  if (footEl) { const m = txt(footEl).match(/©\s*\d{0,4}\s*([A-Za-z0-9&'.\-][A-Za-z0-9&'.\- ]{2,40})/); if (m) footerName = m[1].replace(/\ball rights reserved\b.*/i, "").trim(); }

  return {
    title: document.title || "",
    hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
    metaDescription: (document.querySelector('meta[name="description"]') || {}).content || null,
    overflowPx: Math.max(0, Math.round((document.documentElement.scrollWidth || 0) - window.innerWidth)),
    forms, primaryCtas, navItemCount: navItems.length, navItems,
    phoneLinks: document.querySelectorAll('a[href^="tel:"]').length,
    mailLinks: document.querySelectorAll('a[href^="mailto:"]').length,
    bookingSignals: Array.from(new Set(bookingSignals)).slice(0, 6),
    brokenAssets: brokenImgs.length, brokenAssetSamples,
    placeholderHits, headerName: headerName || null, footerName,
    // discovered same-page anchor targets (absolute), for internal-page discovery
    links: Array.from(document.querySelectorAll("a[href]")).map((a) => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) })),
  };
}

async function newGuardedContext(browser, timeoutMs, resolvedIps) {
  const context = await browser.newContext({
    viewport: { width: MOBILE.width, height: MOBILE.height }, deviceScaleFactor: MOBILE.deviceScaleFactor, isMobile: MOBILE.isMobile,
    userAgent: "ArtifexLabs-ReviewBot/1.0 (+https://artifexlabs.tech; business technology review)", serviceWorkers: "block",
  });
  context.setDefaultNavigationTimeout(timeoutMs); context.setDefaultTimeout(timeoutMs);
  await context.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch { return route.abort("blockedbyclient"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort("blockedbyclient");
    if (req.resourceType() === "media") return route.abort("blockedbyclient");
    if (req.isNavigationRequest() && req.resourceType() === "document") {
      const nrm = normalizeCaptureUrl(u.href); if (!nrm.ok) return route.abort("blockedbyclient");
      const chk = await assertHostPublic(nrm.hostname); if (!chk.ok) return route.abort("blockedbyclient");
      resolvedIps.add(nrm.hostname);
    }
    return route.continue();
  });
  return context;
}

// Capture one page: navigate (SSRF-guarded), settle, extract facts, screenshot. Returns { facts, png, sha256, status, finalUrl } or { error }.
async function capturePage(context, url, role, timeoutMs) {
  const norm = normalizeCaptureUrl(url);
  if (!norm.ok) return { error: `unsafe url (${norm.category})` };
  const pre = await assertHostPublic(norm.hostname);
  if (!pre.ok) return { error: pre.reason };
  const page = await context.newPage();
  try {
    const resp = await page.goto(norm.url.href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const status = resp ? resp.status() : 0;
    const finalUrl = page.url();
    const facts = await page.evaluate(extractFacts).catch(() => null);
    if (!facts) return { error: "extract failed", status, finalUrl };
    let png = null, hash = null;
    if (status < 400) { png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: MOBILE.width, height: MOBILE.height } }); hash = sha256(png); }
    return { facts, png, sha256: hash, status, finalUrl, role };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally {
    await page.close().catch(() => {});
  }
}

// Capture a site: homepage + up to (maxPages-1) discovered internal pages covering distinct roles.
// Returns { site: SiteEvidence-shaped (no capturedAt stamp — caller stamps), shots: Map<finalUrl,{png,sha256}> }.
export async function captureSite({ website, industry, leadId, businessName, maxPages = 5, timeoutMs = 30000, browser: injected } = {}) {
  const home = normalizeCaptureUrl(website);
  if (!home.ok) throw new Error(`unsafe website (${home.category}): ${home.reason}`);
  // www↔apex fallback: lead records often store a stale "www." host that no longer resolves (or vice
  // versa). Pick the first host in {as-stored, toggled-www} that actually resolves to a public address.
  const toggleWww = (h) => (h.startsWith("www.") ? h.slice(4) : `www.${h}`);
  let host = home.url.host;
  if (!(await assertHostPublic(home.url.hostname)).ok) {
    const alt = toggleWww(home.url.hostname);
    if ((await assertHostPublic(alt)).ok) host = home.url.host.startsWith("www.") ? home.url.host.slice(4) : `www.${home.url.host}`;
    else throw new Error(`website host does not resolve to a public address: ${home.url.hostname}`);
  }
  const originHome = `${home.url.protocol}//${host}/`;
  const base = baseDomain(host);
  const browser = injected || await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const ownBrowser = !injected;
  const resolvedIps = new Set();
  const context = await newGuardedContext(browser, timeoutMs, resolvedIps);
  const pages = [];
  const shots = new Map();
  try {
    // 1) Homepage.
    const h = await capturePage(context, originHome, "home", timeoutMs);
    if (h.error && !h.facts) throw new Error(`homepage capture failed: ${h.error}`);
    const homeFacts = h.facts;
    pages.push(pageRecord(originHome, h, "home"));
    if (h.png) shots.set(h.finalUrl, { png: h.png, sha256: h.sha256 });

    // 2) Discover distinct-role internal pages from the homepage's own links (same base domain only).
    const seen = new Set([canon(h.finalUrl), canon(originHome)]);
    const wantRoles = ["contact", "booking", "services", "about"];
    const candidates = [];
    for (const l of (homeFacts?.links || [])) {
      let u; try { u = new URL(l.href); } catch { continue; }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (baseDomain(u.hostname) !== base) continue;         // stay on the business's own domain
      const c = canon(u.href); if (seen.has(c)) continue;
      const role = roleOf(u.pathname, l.text);
      if (role === "other") continue;
      candidates.push({ href: `${u.protocol}//${u.host}${u.pathname}`, role, c });
    }
    // one page per wanted role, in priority order, until maxPages reached
    for (const role of wantRoles) {
      if (pages.length >= maxPages) break;
      const pick = candidates.find((x) => x.role === role && !seen.has(x.c));
      if (!pick) continue;
      seen.add(pick.c);
      const r = await capturePage(context, pick.href, role, timeoutMs);
      pages.push(pageRecord(pick.href, r, role));
      if (r.png) shots.set(r.finalUrl, { png: r.png, sha256: r.sha256 });
    }
  } finally {
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }
  const site = { leadId, businessName, website, industry: industry ?? null, pages };
  return { site, shots };
}

function canon(u) { try { const x = new URL(u); x.hash = ""; x.search = ""; return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, "") || "/"}`; } catch { return u; } }

// Shape a capturePage result into the PageFacts the derivation consumes.
function pageRecord(requestedUrl, r, role) {
  if (r.error && !r.facts) return { requestedUrl, finalUrl: r.finalUrl || requestedUrl, title: "", role, status: r.status || 599, viewportWidth: MOBILE.width, hasViewportMeta: false, metaDescription: null, overflowPx: 0, forms: [], primaryCtas: [], navItemCount: 0, navItems: [], phoneLinks: 0, mailLinks: 0, bookingSignals: [], brokenAssets: 0, brokenAssetSamples: [], placeholderHits: [], headerName: null, footerName: null };
  const f = r.facts;
  return {
    requestedUrl, finalUrl: r.finalUrl || requestedUrl, title: f.title, role, status: r.status ?? 0, viewportWidth: MOBILE.width,
    hasViewportMeta: f.hasViewportMeta, metaDescription: f.metaDescription, overflowPx: f.overflowPx,
    forms: f.forms, primaryCtas: f.primaryCtas, navItemCount: f.navItemCount, navItems: f.navItems,
    phoneLinks: f.phoneLinks, mailLinks: f.mailLinks, bookingSignals: f.bookingSignals,
    brokenAssets: f.brokenAssets, brokenAssetSamples: f.brokenAssetSamples, placeholderHits: f.placeholderHits,
    headerName: f.headerName, footerName: f.footerName,
  };
}
