// ─────────────────────────────────────────────────────────────────────────────
// LIVE browser counter-test executor — the browser-automation stack for the
// Problem-Reality doctrine. It loads the real prospect site and actively tries to
// DISPROVE the hypothesis (e.g. "no booking path") by behaving like a customer:
// dismiss overlays, read the header/mobile menu/footer, find and click SAFE
// booking/contact/quote controls, detect scheduler widgets, follow location
// selectors — then judge whether a usable path exists.
//
// NON-DISRUPTIVE POLICY (structurally enforced): it may navigate, click, scroll,
// open menus and select non-destructive options; it must NEVER submit a real
// inquiry, book, pay, create an account, or otherwise cause an external event.
// It never fills+submits a form and never clicks type=submit / pay / checkout.
//
// PLANNED ≠ EXECUTED: this returns a CounterTestExecution with executed=true only
// when a browser actually ran. Verdict logic lives in verdict.ts (pure/testable).
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemHypothesis, CounterTestExecution, CounterTestAction, AlternatePath } from "./types";
import {
  KEYWORDS, BOOKING_HOSTS, PAYMENT_HOSTS, actionMatchesText, decideVerdict,
  detectRenderedPhones, classifyIframe, type ProbeSignal, type ProbeStatus, type HarvestCompleteness,
} from "./verdict";

const NAV_TIMEOUT = 25_000;
const MAX_CLICKS_PER_VIEWPORT = 2;
const MAX_CRAWL_PER_VIEWPORT = 4;   // bounded site-wide resolution (§7)
const SETTLE_IDLE_MS = 8_000;       // bounded wait for network idle (hydration/lazy)
const SETTLE_EXTRA_MS = 1_500;      // small extra beat for late widgets
// Same-site destinations worth checking for an intended contact/booking path.
const CRAWL_KEYWORDS = /\b(contact|appointment|appt|book|booking|schedule|scheduling|location|request|get.?in.?touch|new.?patient)\b/i;
// A browser-rendered page that is actually a bot/consent wall, not the site.
const CHALLENGE_RX = /(captcha|are you (a )?human|verify you are human|attention required|access denied|cloudflare|checking your browser|ddos|please enable javascript and cookies)/i;

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
} as const;

export interface CounterTestOptions {
  /** Injected for tests. When absent, playwright chromium is launched. */
  launch?: () => Promise<BrowserLike>;
  headless?: boolean;
}

// Minimal structural interfaces so tests can inject a fake browser without playwright.
export interface PageLike {
  goto(url: string, o?: Record<string, unknown>): Promise<{ status(): number } | null>;
  url(): string;
  title(): Promise<string>;
  evaluate<T = unknown>(fn: any, arg?: any): Promise<T>;
  content(): Promise<string>;
  close(): Promise<void>;
  // Optional in fakes; present on real Playwright pages. Used for a BOUNDED settle
  // so JS-rendered / lazy controls get a chance to appear before we harvest.
  waitForLoadState?(state: string, o?: Record<string, unknown>): Promise<void>;
  waitForTimeout?(ms: number): Promise<void>;
}
export interface ContextLike { newPage(): Promise<PageLike>; close(): Promise<void>; }
export interface BrowserLike { newContext(o?: Record<string, unknown>): Promise<ContextLike>; close(): Promise<void>; }

async function defaultLaunch(headless: boolean): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless }) as unknown as Promise<BrowserLike>;
}

// DOM probe run INSIDE the page. Built as a STRING EXPRESSION (an IIFE) rather
// than a passed function so the TS/esbuild transpile step never injects helpers
// like __name into it — those are undefined in the page and would throw. The one
// runtime input (isMobile) is inlined into the string. Performs SAFE overlay
// dismissal + mobile-menu opening; never fills/submits forms.
function buildProbe(isMobile: boolean): string {
  return `(() => {
    var isMobile = ${isMobile ? "true" : "false"};
    var out = { title: document.title || "", overlaysDismissed: [], links: [], buttons: [], iframes: [], tel: [], mailto: [], forms: 0, openedMenu: false, bodyText: "", rawText: "" };
    function textOf(el){ return (((el.getAttribute && (el.getAttribute("aria-label")||"")) || "") + " " + (el.textContent||"")).replace(/\\s+/g," ").trim().toLowerCase(); }
    var dismissWords = ["accept","agree","got it","ok","close","dismiss","i agree","allow all","continue","no thanks","reject all","accept all"];
    var clickable = Array.prototype.slice.call(document.querySelectorAll("button, [role=button], a, [aria-label]"));
    for (var i=0;i<clickable.length;i++){ var el=clickable[i]; var t=textOf(el); var al=((el.getAttribute && (el.getAttribute("aria-label")||""))||"").toLowerCase();
      var isDismiss = al.indexOf("close")>=0 || al.indexOf("dismiss")>=0; for (var d=0; d<dismissWords.length; d++){ var w=dismissWords[d]; if (t===w || t.indexOf(w)===0){ isDismiss=true; break; } }
      if (isDismiss){ var r = el.getBoundingClientRect && el.getBoundingClientRect(); if (r && r.width>0 && r.height>0){ try { el.click(); out.overlaysDismissed.push(t||al); } catch(e){} } }
      if (out.overlaysDismissed.length>=3) break;
    }
    if (isMobile){ for (var j=0;j<clickable.length;j++){ var b=clickable[j]; var bal=((b.getAttribute && b.getAttribute("aria-label"))||"").toLowerCase(); var cls=(b.className && b.className.toString?b.className.toString():"").toLowerCase();
      if (bal.indexOf("menu")>=0||bal.indexOf("navigation")>=0||cls.indexOf("hamburger")>=0||cls.indexOf("menu-toggle")>=0||cls.indexOf("nav-toggle")>=0||textOf(b)==="menu"){ try{ b.click(); out.openedMenu=true; }catch(e){} } } }
    var anchors = document.querySelectorAll("a[href]");
    for (var k=0;k<anchors.length;k++){ var a=anchors[k]; var href=a.getAttribute("href")||""; if (href.indexOf("tel:")===0) out.tel.push(href); else if (href.indexOf("mailto:")===0) out.mailto.push(href); else out.links.push({ text: textOf(a), href: href }); }
    var btns = document.querySelectorAll("button, [role=button]");
    for (var m=0;m<btns.length;m++){ out.buttons.push({ text: textOf(btns[m]), type: (btns[m].getAttribute && btns[m].getAttribute("type"))||"" }); }
    var frames = document.querySelectorAll("iframe");
    for (var n=0;n<frames.length;n++){ var fr=frames[n]; out.iframes.push({ src: (fr.getAttribute("src")||fr.getAttribute("data-src")||""), title: ((fr.getAttribute("title")||fr.getAttribute("aria-label"))||"") }); }
    out.forms = document.querySelectorAll("form").length;
    var _raw = ((document.body && document.body.innerText)||"");
    out.rawText = _raw.slice(0,20000);
    out.bodyText = _raw.slice(0,8000).toLowerCase();
    out.links = out.links.slice(0,250); out.buttons = out.buttons.slice(0,120); out.iframes = out.iframes.slice(0,40);
    var tset={}, tarr=[]; for (var p=0;p<out.tel.length;p++){ if(!tset[out.tel[p]]){tset[out.tel[p]]=1;tarr.push(out.tel[p]);} } out.tel = tarr.slice(0,10);
    var mset={}, marr=[]; for (var q=0;q<out.mailto.length;q++){ if(!mset[out.mailto[q]]){mset[out.mailto[q]]=1;marr.push(out.mailto[q]);} } out.mailto = marr.slice(0,10);
    return out;
  })()`;
}

interface ProbeResult {
  title: string; overlaysDismissed: string[];
  links: Array<{ text: string; href: string }>; buttons: Array<{ text: string; type: string }>;
  iframes: Array<{ src: string; title: string }>; tel: string[]; mailto: string[]; forms: number;
  openedMenu: boolean; bodyText: string; rawText: string;
}

/** Normalize iframe entries whether a probe returns strings (legacy/tests) or
 *  {src,title} objects (current). Keeps injected fake probes working. */
function iframeEntries(probe: { iframes?: Array<{ src: string; title: string } | string> }): Array<{ src: string; title: string }> {
  return (probe.iframes ?? []).map((f) => (typeof f === "string" ? { src: f, title: "" } : f)).filter((f) => f.src || f.title);
}

function hostMatch(url: string, hosts: string[]): boolean {
  const u = (url || "").toLowerCase();
  return hosts.some((h) => u.includes(h));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** A tel: href is usable when it carries enough digits to dial. */
function isValidTel(href: string): boolean {
  const raw = (href || "").replace(/^tel:/i, "").trim();
  if (!raw) return false;
  if (/[a-z]/i.test(raw.replace(/^tel/i, ""))) return false;   // letters ⇒ malformed
  return (raw.match(/\d/g)?.length ?? 0) >= 7;
}

/** A mailto: href is usable when it is a plausible address. */
function isValidMailto(href: string): boolean {
  const raw = (href || "").replace(/^mailto:/i, "").split("?")[0].trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/** Analyse one viewport's probe into signals (pure given the probe result). */
function analyzeProbe(
  h: ProblemHypothesis, probe: ProbeResult, viewport: "desktop" | "mobile",
): { signal: ProbeSignal; actions: CounterTestAction[]; alternates: AlternatePath[]; clickTargets: Array<{ text: string; href: string }>; crawlTargets: string[] } {
  const actions: CounterTestAction[] = [];
  const alternates: AlternatePath[] = [];
  const frames = iframeEntries(probe);
  if (probe.overlaysDismissed.length) actions.push({ step: "dismiss-overlay", viewport, observation: `dismissed: ${probe.overlaysDismissed.join(", ")}` });
  if (probe.openedMenu) actions.push({ step: "open-mobile-menu", viewport, observation: "opened mobile navigation" });
  actions.push({ step: "scan", viewport, observation: `${probe.links.length} links, ${probe.buttons.length} buttons, ${frames.length} iframes, ${probe.forms} forms` });

  const action = h.primaryCustomerAction;
  const kw = KEYWORDS[action] ?? [];
  // 1) Scheduler/booking widget present (strongest online-path signal).
  const widget = frames.map((f) => f.src).find((s) => hostMatch(s, BOOKING_HOSTS)) ||
    probe.links.map((l) => l.href).find((href) => hostMatch(href, BOOKING_HOSTS));
  let onlinePath = false;
  if (widget && (action === "booking" || action === "appointment")) {
    onlinePath = true;
    alternates.push({ kind: "widget", detail: `scheduler widget: ${widget}`, viewport });
    actions.push({ step: "detect-widget", viewport, target: widget, observation: "online scheduler detected" });
  }
  // 1b) Embedded CONTACT/LEAD-FORM iframe classification (River Dental blind spot).
  //     A known provider ("confirmed") is a real path; an un-inspectable form-ish
  //     cross-origin iframe ("possible") must block a no-path PROVEN.
  let iframeForm: "confirmed" | "possible" | undefined;
  for (const f of frames) {
    const cls = classifyIframe(f.src) === "non-form" && CRAWL_KEYWORDS.test(f.title) ? "possible" : classifyIframe(f.src);
    if (cls === "confirmed") { iframeForm = "confirmed"; alternates.push({ kind: "form", detail: `embedded form provider: ${f.src}`, viewport }); break; }
    if (cls === "possible") iframeForm = iframeForm ?? "possible";
  }
  if (iframeForm) actions.push({ step: "detect-iframe-form", viewport, observation: `cross-origin form signal: ${iframeForm}` });
  // 2) Matching links/buttons (candidate online paths).
  const linkHits = probe.links.filter((l) => actionMatchesText(action, l.text) || (kw.some((k) => l.href.toLowerCase().includes(k))));
  const btnHits = probe.buttons.filter((b) => actionMatchesText(action, b.text) && b.type !== "submit");
  const clickTargets = linkHits.filter((l) => l.href && !l.href.startsWith("#")).slice(0, MAX_CLICKS_PER_VIEWPORT);
  if (linkHits.length || btnHits.length) {
    actions.push({ step: "found-candidates", viewport, observation: `${linkHits.length} link(s) + ${btnHits.length} button(s) match ${action}` });
    for (const l of linkHits.slice(0, 3)) alternates.push({ kind: "link", detail: `${l.text || "(icon)"} → ${l.href}`, viewport });
  }
  // 3) Phone / email fallback paths for the action. A tel:/mailto: only counts as a
  //    real fallback when it is well-formed; a malformed advertised contact link is a
  //    DEFECT (family: contact-path), not a working alternate.
  const validTel = probe.tel.filter(isValidTel);
  const validMail = probe.mailto.filter(isValidMailto);
  const hasTel = validTel.length > 0;
  const hasMail = validMail.length > 0;
  // 3b) Phone as RENDERED TEXT (no tel: anchor) — the second River Dental blind spot.
  const phoneTextHits = detectRenderedPhones(probe.rawText || "");
  const hasPhoneText = phoneTextHits.length > 0;
  const phoneProvenance: string[] = [];
  if (hasTel) phoneProvenance.push("PHONE_LINK");
  if (hasPhoneText) phoneProvenance.push("PHONE_RENDERED_TEXT");
  if (hasTel) alternates.push({ kind: "tel", detail: validTel[0], viewport });
  if (hasMail) alternates.push({ kind: "email", detail: validMail[0], viewport });
  if (!hasTel && hasPhoneText) alternates.push({ kind: "tel", detail: `rendered text: ${phoneTextHits[0]}`, viewport });
  // Malformed advertised contact link with no working counterpart ⇒ contact-path defect.
  let deadPath: { family: string; detail: string } | undefined;
  if ((action === "contact" || action === "quote" || action === "forms") && probe.forms === 0 && !iframeForm && !hasPhoneText) {
    const badMail = probe.mailto.find((m) => !isValidMailto(m));
    const badTel = probe.tel.find((t) => !isValidTel(t));
    if (badMail && !hasMail && !hasTel) deadPath = { family: "contact-path", detail: `advertised email link is malformed: ${badMail}` };
    else if (badTel && !hasTel && !hasMail) deadPath = { family: "contact-path", detail: `advertised phone link is malformed: ${badTel}` };
  }
  // 4) Contact/quote via a form on the page (on-page <form> or a confirmed iframe form).
  const formPath = (action === "contact" || action === "quote" || action === "forms") && (probe.forms > 0 || iframeForm === "confirmed");
  if (formPath && probe.forms > 0) alternates.push({ kind: "form", detail: `${probe.forms} form(s) present`, viewport });
  // Body-text mention (weak) — used only to avoid false PROVEN when clearly present.
  const bodyMentions = kw.some((k) => probe.bodyText.includes(k));
  // A "Book Online/Now" control that links OUT to a different host is an external
  // scheduler — a real online booking path for booking/appointment claims.
  if ((action === "booking" || action === "appointment") && !onlinePath) {
    const siteHost = hostOf(h.url);
    const external = linkHits.find((l) => /\bbook|schedul|appoint|reserv|consult/i.test(l.text) && l.href.startsWith("http") && hostOf(l.href) && hostOf(l.href) !== siteHost);
    if (external) { onlinePath = true; alternates.push({ kind: "widget", detail: `external scheduler: ${external.text || "(link)"} → ${external.href}`, viewport }); }
  }

  if (deadPath) actions.push({ step: "defect", viewport, observation: `${deadPath.family}: ${deadPath.detail}` });

  // Same-site destinations worth checking if THIS page shows no path (§7 bounded crawl).
  const siteHost = hostOf(h.url);
  const crawlTargets = probe.links
    .filter((l) => CRAWL_KEYWORDS.test(`${l.text} ${l.href}`) && l.href.startsWith("http") && hostOf(l.href) === siteHost)
    .map((l) => l.href);

  // Affirmative evidence a path is INTENDED here (needed before no-path can be PROVEN).
  const pathIntended = linkHits.length > 0 || btnHits.length > 0 || bodyMentions || crawlTargets.length > 0;

  const signal: ProbeSignal = {
    loaded: true,
    onlinePath: onlinePath || (action !== "booking" && action !== "appointment" && (linkHits.length > 0 || formPath)),
    candidatePath: linkHits.length > 0 || btnHits.length > 0,
    widget: !!widget,
    phonePath: hasTel,
    phoneText: hasPhoneText,
    emailPath: hasMail,
    formPath,
    iframeForm,
    bodyMentions,
    pathIntended,
    phoneProvenance: phoneProvenance.length ? phoneProvenance : undefined,
    deadPath,
  };
  return { signal, actions, alternates, clickTargets, crawlTargets };
}

/** Bounded settle: give hydration / lazy content / embedded widgets a chance to
 *  appear before harvesting. No-ops on injected fakes (methods absent). */
async function settle(page: PageLike): Promise<void> {
  try { await page.waitForLoadState?.("networkidle", { timeout: SETTLE_IDLE_MS }); } catch { /* ignore */ }
  try { await page.waitForTimeout?.(SETTLE_EXTRA_MS); } catch { /* ignore */ }
}

/** True when ANY usable contact/booking path signal is present on the surface. */
function hasAnyPath(s: ProbeSignal): boolean {
  return !!(s.onlinePath || s.widget || s.phonePath || s.phoneText || s.emailPath || s.formPath || s.iframeForm);
}

function dedupe(arr: string[]): string[] { return [...new Set(arr)]; }

/** The site homepage, or "" when the tested URL already IS the homepage. */
function homepageOf(url: string): string {
  try { const u = new URL(url); return u.pathname === "/" || u.pathname === "" ? "" : `${u.protocol}//${u.host}/`; } catch { return ""; }
}

/** Harvest one extra same-site page. Distinguishes a clean miss (probe:null,
 *  threw:false) from a navigation that was BLOCKED/threw (threw:true → downgrades
 *  harvest completeness so a no-path verdict cannot be PROVEN off a partial crawl). */
async function harvestExtraPage(ctx: ContextLike, url: string, isMobile: boolean): Promise<{ probe: ProbeResult | null; threw: boolean }> {
  let p: PageLike | null = null;
  try {
    p = await ctx.newPage();
    const r = await p.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const st = r?.status?.() ?? 0;
    if (st >= 400) { await p.close(); return { probe: null, threw: st === 403 || st === 429 || st === 503 }; }
    await settle(p);
    const probe = (await p.evaluate(buildProbe(isMobile))) as ProbeResult;
    await p.close();
    return { probe, threw: false };
  } catch { try { await p?.close(); } catch { /* ignore */ } return { probe: null, threw: true }; }
}

/** OR any path signals found on an extra same-site page into the viewport signal. */
function mergePathSignals(signal: ProbeSignal, probe: ProbeResult, h: ProblemHypothesis): void {
  const extra = analyzeProbe(h, probe, "desktop").signal;
  signal.phonePath = signal.phonePath || extra.phonePath;
  signal.phoneText = signal.phoneText || extra.phoneText;
  signal.emailPath = signal.emailPath || extra.emailPath;
  signal.formPath = signal.formPath || extra.formPath;
  signal.widget = signal.widget || extra.widget;
  signal.onlinePath = signal.onlinePath || extra.onlinePath;
  signal.iframeForm = signal.iframeForm || extra.iframeForm;
  signal.candidatePath = signal.candidatePath || extra.candidatePath;
  signal.bodyMentions = signal.bodyMentions || extra.bodyMentions;
  signal.pathIntended = signal.pathIntended || extra.pathIntended;
  if (extra.phoneProvenance) signal.phoneProvenance = dedupe([...(signal.phoneProvenance ?? []), ...extra.phoneProvenance]);
}

/** Roll the per-viewport signals up into one harvest completeness for the record. */
function overallCompleteness(signals: ProbeSignal[]): HarvestCompleteness {
  if (signals.some((s) => s.completeness === "BLOCKED") && !signals.some((s) => s.completeness === "COMPLETE")) return "BLOCKED";
  if (signals.some((s) => s.completeness === "PARTIAL") || signals.some((s) => s.completeness === "BLOCKED")) return "PARTIAL";
  return signals.some((s) => s.completeness === "COMPLETE") ? "COMPLETE" : "PARTIAL";
}

/** Roll probe statuses up: a success anywhere dominates a block elsewhere. */
function overallProbeStatus(signals: ProbeSignal[]): ProbeStatus {
  if (signals.some((s) => s.probeStatus === "BROWSER_SUCCESS")) return "BROWSER_SUCCESS";
  if (signals.some((s) => s.probeStatus === "BOT_CHALLENGE")) return "BOT_CHALLENGE";
  if (signals.some((s) => s.probeStatus === "HTTP_FETCH_BLOCKED")) return "HTTP_FETCH_BLOCKED";
  return "INDETERMINATE";
}

export async function executeCounterTest(h: ProblemHypothesis, opts: CounterTestOptions = {}): Promise<CounterTestExecution> {
  const startedAt = new Date().toISOString();
  const base: CounterTestExecution = {
    hypothesisId: h.id, claim: h.claim, url: h.url, executed: false,
    startedAt, finishedAt: startedAt, pagesVisited: [], actionsAttempted: [],
    statesObserved: [], alternatePathsFound: [], nonDisruptive: true,
    verdict: "NEEDS_MORE_EVIDENCE", rationale: "", evidenceShots: [],
  };
  if (!h.url) return { ...base, finishedAt: new Date().toISOString(), rationale: "no URL to test", error: "no-url" };

  let browser: BrowserLike | null = null;
  const signals: ProbeSignal[] = [];
  try {
    browser = await (opts.launch ? opts.launch() : defaultLaunch(opts.headless ?? true));
    for (const vp of ["desktop", "mobile"] as const) {
      const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height }, isMobile: VIEWPORTS[vp].isMobile});
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(h.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        const status = resp?.status?.() ?? 0;
        base.pagesVisited.push(page.url());
        base.actionsAttempted.push({ step: "goto", target: h.url, viewport: vp, observation: `HTTP ${status} → ${page.url()}` });
        // A raw HTTP error / bot challenge is tracked separately — it is NOT evidence
        // that a path is missing. Fail closed, never PROVEN off a blocked probe.
        if (status >= 400) {
          const ps: ProbeStatus = status === 403 || status === 429 || status === 503 ? "BOT_CHALLENGE" : "HTTP_FETCH_BLOCKED";
          base.actionsAttempted.push({ step: "probe-status", viewport: vp, observation: `${ps} (HTTP ${status})` });
          signals.push({ loaded: false, probeStatus: ps, completeness: "BLOCKED" } as ProbeSignal);
          continue;
        }
        // BOUNDED settle so JS-rendered / lazy controls, menus and embedded widgets
        // get a chance to appear before we harvest.
        await settle(page);
        const probe = (await page.evaluate(buildProbe(VIEWPORTS[vp].isMobile))) as ProbeResult;
        // A page that rendered but is actually a bot/consent wall ⇒ BOT_CHALLENGE.
        if (CHALLENGE_RX.test(probe.bodyText) && probe.links.length < 4 && probe.forms === 0) {
          base.actionsAttempted.push({ step: "probe-status", viewport: vp, observation: "BOT_CHALLENGE (rendered challenge/consent wall)" });
          signals.push({ loaded: false, probeStatus: "BOT_CHALLENGE", completeness: "BLOCKED" } as ProbeSignal);
          continue;
        }
        const { signal, actions, alternates, clickTargets, crawlTargets } = analyzeProbe(h, probe, vp);
        signal.probeStatus = "BROWSER_SUCCESS";
        base.actionsAttempted.push(...actions);
        base.alternatePathsFound.push(...alternates);
        base.statesObserved.push(`${vp}: title="${probe.title}" widget=${signal.widget} candidates=${signal.candidatePath} tel=${signal.phonePath} phoneText=${signal.phoneText} iframeForm=${signal.iframeForm ?? "none"} form=${signal.formPath}`);
        // SAFE click-through: follow up to N candidate links (never submit, never pay).
        for (const target of clickTargets) {
          const dest = absolute(h.url, target.href);
          if (hostMatch(dest, PAYMENT_HOSTS)) { base.actionsAttempted.push({ step: "skip-click", target: dest, viewport: vp, observation: "skipped payment/checkout destination" }); continue; }
          try {
            const p2 = await ctx.newPage();
            const r2 = await p2.goto(dest, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            const st2 = r2?.status?.() ?? 0;
            await settle(p2);
            const probe2 = (await p2.evaluate(buildProbe(VIEWPORTS[vp].isMobile))) as ProbeResult;
            const widget2 = iframeEntries(probe2).map((f) => f.src).find((s) => hostMatch(s, BOOKING_HOSTS));
            const usable = st2 < 400 && (widget2 || probe2.forms > 0 || actionMatchesText(h.primaryCustomerAction, probe2.bodyText.slice(0, 400)));
            base.pagesVisited.push(p2.url());
            base.actionsAttempted.push({ step: "click", target: `${target.text || "(link)"} → ${dest}`, viewport: vp, observation: `HTTP ${st2}; ${widget2 ? "scheduler present" : probe2.forms > 0 ? `${probe2.forms} form(s)` : "no obvious path"}` });
            if (usable) { signal.onlinePath = true; base.alternatePathsFound.push({ kind: widget2 ? "widget" : "page", detail: `reached ${dest}${widget2 ? ` (widget ${widget2})` : ""}`, viewport: vp }); }
            else if (st2 >= 400) {
              // The intended primary-action control leads to a dead/erroring destination —
              // a reproducible defect on the tested surface (a phone/email elsewhere would
              // only MITIGATE this, never erase it).
              const family = h.primaryCustomerAction === "booking" || h.primaryCustomerAction === "appointment" ? "broken-booking" : "broken-cta";
              signal.deadPath = { family, detail: `primary "${h.primaryCustomerAction}" control '${target.text || "(link)"}' → ${dest} returned HTTP ${st2}` };
              base.actionsAttempted.push({ step: "defect", target: dest, viewport: vp, observation: `dead destination HTTP ${st2}` });
            }
            await p2.close();
          } catch (e) { base.actionsAttempted.push({ step: "click", target: dest, viewport: vp, observation: `navigation failed: ${(e as Error).message}` }); }
        }
        // §7 SITE-WIDE bounded resolution: if this page showed no usable path and no
        // defect, check a few likely same-site destinations (contact/appointment/
        // book/location) + the homepage before concluding anything is missing.
        let completeness: HarvestCompleteness = "COMPLETE";
        if (!hasAnyPath(signal) && !signal.deadPath) {
          const targets = dedupe([...crawlTargets, homepageOf(h.url)]).filter(Boolean).slice(0, MAX_CRAWL_PER_VIEWPORT);
          for (const url of targets) {
            const res = await harvestExtraPage(ctx, url, VIEWPORTS[vp].isMobile);
            if (res.threw) { completeness = "PARTIAL"; base.actionsAttempted.push({ step: "crawl", target: url, viewport: vp, observation: "navigation blocked/failed — harvest PARTIAL" }); continue; }
            if (!res.probe) { base.actionsAttempted.push({ step: "crawl", target: url, viewport: vp, observation: "no content (skipped/404)" }); continue; }
            base.pagesVisited.push(url);
            mergePathSignals(signal, res.probe, h);
            base.actionsAttempted.push({ step: "crawl", target: url, viewport: vp, observation: `checked same-site destination; path now ${hasAnyPath(signal) ? "FOUND" : "still none"}` });
            if (hasAnyPath(signal)) break;
          }
        }
        signal.completeness = completeness;
        signals.push(signal);
      } catch (e) {
        base.actionsAttempted.push({ step: "goto", target: h.url, viewport: vp, observation: `load failed: ${(e as Error).message}` });
        signals.push({ loaded: false, probeStatus: "INDETERMINATE" } as ProbeSignal);
      } finally { await ctx.close(); }
    }
    const d = decideVerdict(h, signals);
    return {
      ...base, executed: true, finishedAt: new Date().toISOString(),
      verdict: d.verdict, rationale: d.rationale,
      defect: d.defect ?? null, severity: d.severity, mitigation: d.mitigation, materiality: d.materiality,
      harvestCompleteness: overallCompleteness(signals), probeStatus: overallProbeStatus(signals),
    };
  } catch (e) {
    return { ...base, executed: false, finishedAt: new Date().toISOString(), verdict: "NEEDS_MORE_EVIDENCE", rationale: "counter-test could not run", error: (e as Error).message };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

function absolute(base: string, href: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}
