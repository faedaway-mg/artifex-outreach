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
import { KEYWORDS, BOOKING_HOSTS, PAYMENT_HOSTS, actionMatchesText, decideVerdict, type ProbeSignal } from "./verdict";

const NAV_TIMEOUT = 25_000;
const MAX_CLICKS_PER_VIEWPORT = 2;

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
    var out = { title: document.title || "", overlaysDismissed: [], links: [], buttons: [], iframes: [], tel: [], mailto: [], forms: 0, openedMenu: false, bodyText: "" };
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
    for (var n=0;n<frames.length;n++){ out.iframes.push(frames[n].getAttribute("src")||""); }
    out.forms = document.querySelectorAll("form").length;
    out.bodyText = ((document.body && document.body.innerText)||"").slice(0,4000).toLowerCase();
    out.links = out.links.slice(0,250); out.buttons = out.buttons.slice(0,120); out.iframes = out.iframes.slice(0,40);
    var tset={}, tarr=[]; for (var p=0;p<out.tel.length;p++){ if(!tset[out.tel[p]]){tset[out.tel[p]]=1;tarr.push(out.tel[p]);} } out.tel = tarr.slice(0,10);
    var mset={}, marr=[]; for (var q=0;q<out.mailto.length;q++){ if(!mset[out.mailto[q]]){mset[out.mailto[q]]=1;marr.push(out.mailto[q]);} } out.mailto = marr.slice(0,10);
    return out;
  })()`;
}

interface ProbeResult {
  title: string; overlaysDismissed: string[];
  links: Array<{ text: string; href: string }>; buttons: Array<{ text: string; type: string }>;
  iframes: string[]; tel: string[]; mailto: string[]; forms: number; openedMenu: boolean; bodyText: string;
}

function hostMatch(url: string, hosts: string[]): boolean {
  const u = (url || "").toLowerCase();
  return hosts.some((h) => u.includes(h));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** Analyse one viewport's probe into signals (pure given the probe result). */
function analyzeProbe(
  h: ProblemHypothesis, probe: ProbeResult, viewport: "desktop" | "mobile",
): { signal: ProbeSignal; actions: CounterTestAction[]; alternates: AlternatePath[]; clickTargets: Array<{ text: string; href: string }> } {
  const actions: CounterTestAction[] = [];
  const alternates: AlternatePath[] = [];
  if (probe.overlaysDismissed.length) actions.push({ step: "dismiss-overlay", viewport, observation: `dismissed: ${probe.overlaysDismissed.join(", ")}` });
  if (probe.openedMenu) actions.push({ step: "open-mobile-menu", viewport, observation: "opened mobile navigation" });
  actions.push({ step: "scan", viewport, observation: `${probe.links.length} links, ${probe.buttons.length} buttons, ${probe.iframes.length} iframes, ${probe.forms} forms` });

  const action = h.primaryCustomerAction;
  const kw = KEYWORDS[action] ?? [];
  // 1) Scheduler/booking widget present (strongest online-path signal).
  const widget = probe.iframes.find((s) => hostMatch(s, BOOKING_HOSTS)) ||
    probe.links.map((l) => l.href).find((href) => hostMatch(href, BOOKING_HOSTS));
  let onlinePath = false;
  if (widget && (action === "booking" || action === "appointment")) {
    onlinePath = true;
    alternates.push({ kind: "widget", detail: `scheduler widget: ${widget}`, viewport });
    actions.push({ step: "detect-widget", viewport, target: widget, observation: "online scheduler detected" });
  }
  // 2) Matching links/buttons (candidate online paths).
  const linkHits = probe.links.filter((l) => actionMatchesText(action, l.text) || (kw.some((k) => l.href.toLowerCase().includes(k))));
  const btnHits = probe.buttons.filter((b) => actionMatchesText(action, b.text) && b.type !== "submit");
  const clickTargets = linkHits.filter((l) => l.href && !l.href.startsWith("#")).slice(0, MAX_CLICKS_PER_VIEWPORT);
  if (linkHits.length || btnHits.length) {
    actions.push({ step: "found-candidates", viewport, observation: `${linkHits.length} link(s) + ${btnHits.length} button(s) match ${action}` });
    for (const l of linkHits.slice(0, 3)) alternates.push({ kind: "link", detail: `${l.text || "(icon)"} → ${l.href}`, viewport });
  }
  // 3) Phone / email fallback paths for the action.
  const hasTel = probe.tel.length > 0;
  const hasMail = probe.mailto.length > 0;
  if (hasTel) alternates.push({ kind: "tel", detail: probe.tel[0], viewport });
  if (hasMail) alternates.push({ kind: "email", detail: probe.mailto[0], viewport });
  // 4) Contact/quote via a form on the page.
  const formPath = (action === "contact" || action === "quote" || action === "forms") && probe.forms > 0;
  if (formPath) alternates.push({ kind: "form", detail: `${probe.forms} form(s) present`, viewport });
  // Body-text mention (weak) — used only to avoid false PROVEN when clearly present.
  const bodyMentions = kw.some((k) => probe.bodyText.includes(k));
  // A "Book Online/Now" control that links OUT to a different host is an external
  // scheduler — a real online booking path for booking/appointment claims.
  if ((action === "booking" || action === "appointment") && !onlinePath) {
    const siteHost = hostOf(h.url);
    const external = linkHits.find((l) => /\bbook|schedul|appoint|reserv|consult/i.test(l.text) && l.href.startsWith("http") && hostOf(l.href) && hostOf(l.href) !== siteHost);
    if (external) { onlinePath = true; alternates.push({ kind: "widget", detail: `external scheduler: ${external.text || "(link)"} → ${external.href}`, viewport }); }
  }

  const signal: ProbeSignal = {
    loaded: true,
    onlinePath: onlinePath || (action !== "booking" && action !== "appointment" && (linkHits.length > 0 || formPath)),
    candidatePath: linkHits.length > 0 || btnHits.length > 0,
    widget: !!widget,
    phonePath: hasTel,
    emailPath: hasMail,
    formPath,
    bodyMentions,
  };
  return { signal, actions, alternates, clickTargets };
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
        if (status >= 400) { signals.push({ loaded: false } as ProbeSignal); await ctx.close(); continue; }
        // Give client-rendered nav a beat, then probe.
        const probe = (await page.evaluate(buildProbe(VIEWPORTS[vp].isMobile))) as ProbeResult;
        const { signal, actions, alternates, clickTargets } = analyzeProbe(h, probe, vp);
        base.actionsAttempted.push(...actions);
        base.alternatePathsFound.push(...alternates);
        base.statesObserved.push(`${vp}: title="${probe.title}" widget=${signal.widget} candidates=${signal.candidatePath} tel=${signal.phonePath} form=${signal.formPath}`);
        // SAFE click-through: follow up to N candidate links (never submit, never pay).
        for (const target of clickTargets) {
          const dest = absolute(h.url, target.href);
          if (hostMatch(dest, PAYMENT_HOSTS)) { base.actionsAttempted.push({ step: "skip-click", target: dest, viewport: vp, observation: "skipped payment/checkout destination" }); continue; }
          try {
            const p2 = await ctx.newPage();
            const r2 = await p2.goto(dest, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            const st2 = r2?.status?.() ?? 0;
            const probe2 = (await p2.evaluate(buildProbe(VIEWPORTS[vp].isMobile))) as ProbeResult;
            const widget2 = probe2.iframes.find((s) => hostMatch(s, BOOKING_HOSTS));
            const usable = st2 < 400 && (widget2 || probe2.forms > 0 || actionMatchesText(h.primaryCustomerAction, probe2.bodyText.slice(0, 400)));
            base.pagesVisited.push(p2.url());
            base.actionsAttempted.push({ step: "click", target: `${target.text || "(link)"} → ${dest}`, viewport: vp, observation: `HTTP ${st2}; ${widget2 ? "scheduler present" : probe2.forms > 0 ? `${probe2.forms} form(s)` : "no obvious path"}` });
            if (usable) { signal.onlinePath = true; base.alternatePathsFound.push({ kind: widget2 ? "widget" : "page", detail: `reached ${dest}${widget2 ? ` (widget ${widget2})` : ""}`, viewport: vp }); }
            await p2.close();
          } catch (e) { base.actionsAttempted.push({ step: "click", target: dest, viewport: vp, observation: `navigation failed: ${(e as Error).message}` }); }
        }
        signals.push(signal);
      } catch (e) {
        base.actionsAttempted.push({ step: "goto", target: h.url, viewport: vp, observation: `load failed: ${(e as Error).message}` });
        signals.push({ loaded: false } as ProbeSignal);
      } finally { await ctx.close(); }
    }
    const { verdict, rationale } = decideVerdict(h, signals);
    return { ...base, executed: true, finishedAt: new Date().toISOString(), verdict, rationale };
  } catch (e) {
    return { ...base, executed: false, finishedAt: new Date().toISOString(), verdict: "NEEDS_MORE_EVIDENCE", rationale: "counter-test could not run", error: (e as Error).message };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

function absolute(base: string, href: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}
