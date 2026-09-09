// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX TRUST-VIDEO RENDER — v2 (MOTION).
//
// v1 was a single static branded frame looped over the narration. v2 renders a
// real motion explainer: a deterministic HTML timeline (kinetic typography,
// animated device mockups, a process pipeline, trust chips, a conceptual
// before/after) is captured FRAME-BY-FRAME with headless Chromium (Playwright),
// then ffmpeg assembles the frames and muxes the SAME evergreen narration MP3.
//
// Everything is claim-safe: on-screen text describes only the Quick-Fix PROCESS
// (fixed scope / fixed price / tested / confirmed). No traffic, revenue, ranking,
// conversion %, testimonials, or "before/after results". Any example interface is
// generic and labelled "Example". Captions (.vtt) are the ACTUAL spoken script,
// so they always match the audio.
//
//   node scripts/quickfix-trust-video-render-v2.mjs [familyKey]   (no arg = all)
//
// Outputs (never destroys v1):
//   public/trust-videos/<scope>-v2.mp4
//   public/trust-videos/<scope>-v2-poster.jpg
//   public/trust-videos/<scope>-v2.vtt
//   public/trust-videos/manifest-v2.json  (per-asset QA incl. a motion check)
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const AUDIO_DIR = "/Users/jordanjackson/Downloads/Artifex Labs - Quick Fix Naratives";
const OUT_DIR = path.join(ROOT, "public", "trust-videos");
const FONT_DIR = "file://" + path.join(ROOT, "public", "fonts", "pdf");
const VERSION = 2;
const SCRIPT_VERSION = "qf-trust-v2-2026-09";
const FPS = 24;

// ── Spoken narration (verbatim from src/lib/quick-fix/trust-videos.ts) — used ONLY
//    to generate matching .vtt captions so captions always equal the audio. ───────
const OPEN =
  "Hey, I'm Jordan with Artifex Labs. We built Quick-Fix for businesses that don't need a giant redesign, a long consulting engagement, or weeks of back-and-forth just to solve one specific problem.";
const CLOSE =
  "The process is straightforward. Once you move forward, we confirm exactly what needs to be fixed, collect only the access or information required to do the work, make the change, test it, and give you clear confirmation of what was completed. We keep the scope intentionally tight. You'll know what you're paying for before the work starts, and if we discover something outside that scope, we don't quietly turn it into a bigger project. We explain it and let you decide what happens next. The goal of Quick-Fix is simple: identify a real problem, fix it properly, and get you back to business without making the process more complicated than it needs to be. That's Artifex Quick-Fix.";
const MODULES = {
  "contact-form-lead-capture": "For this Quick-Fix, we're focused specifically on the part of your site that turns visitors into inquiries. That might mean repairing a contact form, fixing a broken submission flow, correcting where leads are being sent, or making sure the path from the call-to-action to the actual submission works end to end.",
  "cta-conversion": "For this Quick-Fix, we're focused on a specific conversion issue — the part of the experience that should move a visitor toward taking action. We'll address the identified friction, make the necessary change, and test the path so the intended action works clearly and consistently.",
  "mobile-responsive": "For this Quick-Fix, we're focused on the way the experience behaves across screen sizes. We'll correct the identified mobile or responsive issue, verify the important content and actions remain usable, and test the result across the relevant breakpoints.",
  "accessibility": "For this Quick-Fix, we're focused on a specific accessibility issue that can make the site harder to use for some visitors. We'll remediate the defined problem, test the affected experience, and document what was corrected.",
  "analytics-tracking": "For this Quick-Fix, we're focused on making sure the activity you care about can actually be measured. We'll repair or configure the defined tracking, verify that the expected events are being captured, and clearly document what is now being measured.",
  "cms-technical": "For this Quick-Fix, we're focused on a specific technical issue inside the site or CMS. We'll isolate the problem, make the scoped correction, test the affected functionality, and confirm that the repair is working as intended.",
  "seo-metadata": "For this Quick-Fix, we're focused on a defined technical search-visibility issue — things like page metadata, indexing-related configuration, or other scoped on-page technical problems. We'll correct the identified issue and verify that the implementation is properly in place.",
  "homepage-sprint": "For this scope, we're addressing a slightly broader set of issues on one high-value part of the site. We'll focus on the elements most directly affecting clarity, trust, and conversion, make the agreed improvements, and test the resulting experience as one contained sprint.",
  "fix-scan": "This one works a little differently. The Fix Scan is designed for situations where there appears to be a problem, but the correct repair isn't clear enough yet to responsibly sell you a solution. We inspect the issue, identify what is actually happening, and give you a clear recommended next step. If you move forward with an eligible repair afterward, the Fix Scan can be credited according to the terms of the offer.",
};
const spokenScript = (scope) => `${OPEN} ${MODULES[scope]} ${CLOSE}`;

// ── Per-scope on-screen config (claim-safe summaries + a scope-specific mock). ────
// hook   : a single skimmable line for the opening scene
// mock   : an id resolved by deviceMock() to a generic, "Example"-labelled interface
// callout: the friction we point at (structural, no metric)
// fixes  : 3-4 short scope-true fix phrases (drawn from the spoken module)
// before / after : conceptual interface STRUCTURE labels (never a measured result)
const SCOPES = {
  "contact-form-lead-capture": {
    tag: "01", title: "Contact Form & Lead Capture",
    hook: "When the form breaks, the inquiry never arrives.",
    mock: "form", callout: "Submission path broken",
    fixes: ["Repair the contact form", "Fix the submission flow", "Correct where leads are sent", "Test the path end to end"],
    before: "Form errors · leads lost", after: "Working inquiry path",
  },
  "cta-conversion": {
    tag: "02", title: "CTA & Conversion",
    hook: "One unclear call-to-action is all it takes to lose the next step.",
    mock: "cta", callout: "Primary action unclear",
    fixes: ["Clarify the primary action", "Repair broken or misdirected clicks", "Strengthen the mobile tap target", "Verify the path end to end"],
    before: "Action buried · competing buttons", after: "One clear primary action",
  },
  "mobile-responsive": {
    tag: "03", title: "Mobile & Responsive Layout",
    hook: "It works on your screen — but not on theirs.",
    mock: "mobile", callout: "Layout breaks on small screens",
    fixes: ["Correct the responsive issue", "Keep key content usable", "Fix tap targets", "Test the relevant breakpoints"],
    before: "Cramped · overflowing layout", after: "Clean, usable on any screen",
  },
  "accessibility": {
    tag: "04", title: "Accessibility",
    hook: "A small barrier can lock some visitors out entirely.",
    mock: "a11y", callout: "Specific accessibility barrier",
    fixes: ["Remediate the defined issue", "Restore keyboard & focus cues", "Repair labels & contrast", "Test the affected experience"],
    before: "Missing labels · weak focus", after: "Clear, operable, labelled",
  },
  "analytics-tracking": {
    tag: "05", title: "Analytics & Tracking",
    hook: "If it isn't measured, you're guessing.",
    mock: "analytics", callout: "Events not firing",
    fixes: ["Repair or configure tracking", "Verify the expected events fire", "Confirm what's measured", "Document the setup"],
    before: "Silent · unverified events", after: "Verified, documented tracking",
  },
  "cms-technical": {
    tag: "06", title: "CMS & Technical",
    hook: "One technical fault, isolated and fixed.",
    mock: "cms", callout: "Scoped technical fault",
    fixes: ["Isolate the problem", "Make the scoped correction", "Test the affected function", "Confirm it works as intended"],
    before: "Broken function", after: "Repaired & confirmed",
  },
  "seo-metadata": {
    tag: "07", title: "SEO & Metadata",
    hook: "The technical basics search engines actually read.",
    mock: "seo", callout: "Metadata / indexing issue",
    fixes: ["Correct page metadata", "Fix indexing-related config", "Resolve the scoped on-page issue", "Verify it's properly in place"],
    before: "Missing · malformed metadata", after: "Correct, in-place metadata",
  },
  "homepage-sprint": {
    tag: "08", title: "Homepage Conversion Sprint",
    hook: "One focused sprint on your highest-value page.",
    mock: "homepage", callout: "Clarity & trust on the homepage",
    fixes: ["Sharpen the section hierarchy", "Strengthen the trust block", "Clarify the primary action", "Test the resulting experience"],
    before: "Unclear priority · weak trust", after: "Clear hierarchy · visible trust",
  },
  "fix-scan": {
    tag: "09", title: "Fix Scan",
    hook: "Inspect first. Diagnose the real problem. Recommend the right fix.",
    mock: "scan", callout: "Diagnose before prescribing",
    fixes: ["Inspect the issue directly", "Identify what's actually happening", "Recommend the right next step", "Credit an eligible repair per the terms"],
    before: "Unclear problem", after: "Evidence-backed recommendation",
  },
};

// ── Trust chips (shared, from the offer page's integrity principles). ─────────────
const TRUST = ["Fixed scope", "Fixed price", "Evidence-backed", "No passwords", "You control access", "No work without approval"];
const PROCESS = ["Scope confirmed", "Access received", "Fix implemented", "Tested", "Completion confirmed"];

// ── A generic, clearly-"Example" interface per scope (structure only). ────────────
function deviceMock(mock) {
  const bar = `<div class="bx-bar"><span class="bx-dot"></span><span class="bx-dot"></span><span class="bx-dot"></span><span class="bx-url">example-site</span></div>`;
  const btn = (t, cls = "") => `<div class="ui-btn ${cls}">${t}</div>`;
  const line = (w) => `<div class="ui-line" style="width:${w}"></div>`;
  if (mock === "cta")
    return `<div class="browser">${bar}<div class="bx-body"><div class="ui-h">${line("62%")}</div>${line("88%")}${line("74%")}<div class="ui-row">${btn("Learn more", "muted")}${btn("Contact", "muted")}${btn("Get started", "weak js-target")}</div></div></div>`;
  if (mock === "form")
    return `<div class="browser">${bar}<div class="bx-body"><div class="ui-h">${line("48%")}</div><div class="ui-field"></div><div class="ui-field js-target err">Submission failed</div><div class="ui-field"></div><div class="ui-row">${btn("Send", "weak")}</div></div></div>`;
  if (mock === "mobile")
    return `<div class="phone"><div class="ph-notch"></div><div class="ph-body"><div class="ui-h">${line("70%")}</div><div class="ui-row wrap js-target">${btn("A", "tiny")}${btn("B", "tiny")}${btn("C", "tiny")}${btn("D", "tiny")}</div>${line("120%")}${line("118%")}</div></div>`;
  if (mock === "a11y")
    return `<div class="browser">${bar}<div class="bx-body"><div class="ui-h">${line("52%")}</div><div class="ui-field lbl js-target">Label</div><div class="ui-field lbl">Label</div><div class="ui-row">${btn("Submit", "focusring")}</div></div></div>`;
  if (mock === "analytics")
    return `<div class="browser">${bar}<div class="bx-body dash"><div class="ui-h">${line("40%")}</div><div class="bars"><span style="height:38%"></span><span style="height:60%"></span><span class="miss js-target" style="height:14%"></span><span style="height:72%"></span><span style="height:52%"></span></div></div></div>`;
  if (mock === "cms")
    return `<div class="browser">${bar}<div class="bx-body code js-target"><div class="cl"><i>1</i>${line("60%")}</div><div class="cl err"><i>2</i>${line("80%")}</div><div class="cl"><i>3</i>${line("44%")}</div><div class="cl"><i>4</i>${line("70%")}</div></div></div>`;
  if (mock === "seo")
    return `<div class="browser">${bar}<div class="bx-body serp"><div class="serp-title js-target">Page title — example</div><div class="serp-url">example-site › page</div>${line("92%")}${line("78%")}</div></div>`;
  if (mock === "homepage")
    return `<div class="browser">${bar}<div class="bx-body home"><div class="hh js-target"></div><div class="hr">${line("40%")}${line("40%")}${line("40%")}</div><div class="hr">${line("60%")}</div></div></div>`;
  // scan
  return `<div class="browser">${bar}<div class="bx-body scan"><div class="mag js-target">⌕</div><div class="ui-h">${line("50%")}</div>${line("86%")}${line("72%")}${line("64%")}</div></div>`;
}

function timelineHtml(s) {
  const fixes = s.fixes.map((f, i) => `<div class="anim card" data-i="${i}" data-anim="up"><span class="ck">✓</span><span>${f}</span></div>`).join("");
  const proc = PROCESS.map((p, i) => `<div class="anim step" data-i="${i}" data-anim="up"><span class="node">${i + 1}</span><span class="pl">${p}</span></div>`).join("");
  const trust = TRUST.map((t, i) => `<div class="anim chip" data-i="${i}" data-anim="scale">${t}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Regular.ttf');font-weight:400}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Medium.ttf');font-weight:500}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-SemiBold.ttf');font-weight:600}
    @font-face{font-family:'Inter';src:url('${FONT_DIR}/Inter-Bold.ttf');font-weight:700}
    @font-face{font-family:'Mono';src:url('${FONT_DIR}/JetBrainsMono-Medium.ttf');font-weight:500}
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1920px;height:1080px;overflow:hidden;font-family:'Inter',sans-serif;background:#070b12}
    .stage{position:absolute;inset:0;background:radial-gradient(1400px 900px at var(--gx,26%) var(--gy,20%), #16233a 0%, #0b1220 48%, #070b12 100%)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,160,220,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,220,.045) 1px,transparent 1px);background-size:70px 70px;mask-image:radial-gradient(1000px 680px at 30% 32%,#000,transparent 78%)}
    .glowb{position:absolute;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,rgba(58,117,230,.16),transparent 62%);filter:blur(6px)}
    /* persistent chrome */
    .topbar{position:absolute;top:70px;left:150px;right:150px;display:flex;align-items:center;justify-content:space-between;z-index:9}
    .brand{display:flex;align-items:center;gap:16px}
    .dot{width:15px;height:15px;border-radius:50%;background:#42c9a6;box-shadow:0 0 20px rgba(66,201,166,.85)}
    .bt{font-weight:700;font-size:30px;letter-spacing:.03em;color:#eef2f8}
    .bs{font-family:'Mono';font-size:19px;color:#7f93ad;letter-spacing:.16em;text-transform:uppercase;margin-left:4px}
    .tag{font-family:'Mono';font-size:22px;color:#6b7f98;letter-spacing:.12em}
    .prog{position:absolute;left:150px;right:150px;bottom:70px;height:5px;border-radius:4px;background:rgba(255,255,255,.08);z-index:9}
    .prog>i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#5aa0ff,#42c9a6);width:0}
    /* scenes */
    .scene{position:absolute;left:150px;right:150px;top:150px;bottom:150px;display:flex;flex-direction:column;justify-content:center;opacity:0;will-change:opacity,transform}
    .eyebrow{font-family:'Mono';font-size:24px;letter-spacing:.30em;text-transform:uppercase;color:#5aa0ff;margin-bottom:26px}
    .anim{will-change:transform,opacity}
    /* hook */
    .hook{font-weight:700;font-size:104px;line-height:1.04;letter-spacing:-.02em;color:#f4f7fb;max-width:1500px}
    .subhook{margin-top:30px;font-size:36px;color:#aab8cc;max-width:1200px}
    /* problem */
    .two{display:flex;gap:70px;align-items:center}
    .col{flex:1}
    .kicker{font-size:30px;color:#9fb0c6;margin-bottom:18px}
    .callout{display:inline-flex;align-items:center;gap:14px;font-size:34px;font-weight:600;color:#ffd0a6;background:rgba(245,155,90,.12);border:1px solid rgba(245,155,90,.4);padding:16px 26px;border-radius:16px}
    .callout .cd{width:14px;height:14px;border-radius:50%;background:#f5bc63;box-shadow:0 0 16px rgba(245,188,99,.8)}
    /* device mocks */
    .mock{width:760px;height:520px;position:relative;filter:drop-shadow(0 40px 80px rgba(0,0,0,.5))}
    .browser{width:100%;height:100%;background:#0e1626;border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden}
    .bx-bar{height:56px;background:#0b111d;display:flex;align-items:center;gap:12px;padding:0 22px;border-bottom:1px solid rgba(255,255,255,.07)}
    .bx-dot{width:13px;height:13px;border-radius:50%;background:#31405a}
    .bx-url{margin-left:16px;font-family:'Mono';font-size:20px;color:#5f728c}
    .bx-body{padding:40px 44px;display:flex;flex-direction:column;gap:20px}
    .ui-line{height:20px;border-radius:8px;background:rgba(160,185,220,.18)}
    .ui-h .ui-line,.ui-h{height:44px}.ui-h .ui-line{height:44px;background:rgba(200,220,250,.32)}
    .ui-field{height:52px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
    .ui-field.err{border-color:rgba(229,106,85,.7);color:#ff9b8a;font-size:22px;display:flex;align-items:center;padding:0 20px;background:rgba(229,106,85,.1)}
    .ui-field.lbl{position:relative}
    .ui-field.lbl::before{content:"◦";position:absolute;left:-2px;top:-30px;color:#7f93ad;font-size:22px}
    .ui-row{display:flex;gap:18px;margin-top:6px}.ui-row.wrap{flex-wrap:wrap}
    .ui-btn{padding:16px 26px;border-radius:12px;font-size:24px;font-weight:600;background:#26344c;color:#c7d4e6}
    .ui-btn.muted{background:#1a2436;color:#8294ac}
    .ui-btn.weak{background:rgba(255,255,255,.06);color:#7f8ea3;border:1px dashed rgba(255,255,255,.2)}
    .ui-btn.tiny{padding:12px 16px;font-size:18px}
    .ui-btn.focusring{outline:3px solid #5aa0ff;outline-offset:4px}
    .phone{width:300px;height:520px;margin:0 auto;background:#0e1626;border:2px solid rgba(255,255,255,.14);border-radius:38px;overflow:hidden;position:relative}
    .ph-notch{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:110px;height:22px;border-radius:14px;background:#0b111d}
    .ph-body{padding:56px 26px 26px;display:flex;flex-direction:column;gap:16px}
    .dash .bars{display:flex;align-items:flex-end;gap:20px;height:280px;margin-top:20px}
    .dash .bars>span{flex:1;background:linear-gradient(180deg,#5aa0ff,#3257a8);border-radius:8px 8px 0 0}
    .dash .bars>span.miss{background:repeating-linear-gradient(45deg,rgba(229,106,85,.35),rgba(229,106,85,.35) 10px,transparent 10px,transparent 20px);border:1px dashed rgba(229,106,85,.7)}
    .code{font-family:'Mono';gap:12px}
    .code .cl{display:flex;align-items:center;gap:20px}
    .code .cl>i{color:#4a5b76;font-style:normal;width:24px}
    .code .cl.err .ui-line{background:rgba(229,106,85,.4)}
    .serp .serp-title{font-size:30px;color:#8ab4ff}
    .serp .serp-url{font-size:20px;color:#4a8a52;margin:6px 0 18px}
    .home .hh{height:120px;border-radius:14px;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.16)}
    .home .hr{display:flex;gap:18px;margin-top:6px}
    .scan .mag{font-size:70px;color:#5aa0ff;text-shadow:0 0 30px rgba(90,160,255,.6)}
    /* fix cards */
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px;max-width:1500px}
    .card{display:flex;align-items:center;gap:22px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:30px 34px;font-size:38px;font-weight:600;color:#e7eef8}
    .card .ck{width:52px;height:52px;flex:none;border-radius:50%;background:rgba(66,201,166,.16);color:#5fe3c7;display:flex;align-items:center;justify-content:center;font-size:30px}
    /* process */
    .pipe{display:flex;align-items:center;justify-content:space-between;position:relative;margin-top:30px}
    .pipe::before{content:"";position:absolute;left:60px;right:60px;top:46px;height:4px;background:rgba(255,255,255,.1)}
    .pipe>.pfill{position:absolute;left:60px;top:46px;height:4px;background:linear-gradient(90deg,#5aa0ff,#42c9a6);width:0;z-index:1}
    .step{display:flex;flex-direction:column;align-items:center;gap:20px;width:280px;z-index:2}
    .step .node{width:92px;height:92px;border-radius:50%;background:#0e1626;border:2px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:#8294ac}
    .step.on .node{border-color:#42c9a6;color:#0b1220;background:linear-gradient(180deg,#7fe3c7,#42c9a6);box-shadow:0 0 30px rgba(66,201,166,.5)}
    .step .pl{font-size:27px;color:#aab8cc;text-align:center}
    /* trust chips */
    .chips{display:flex;flex-wrap:wrap;gap:24px;max-width:1500px;margin-top:10px}
    .chip{font-size:36px;font-weight:600;color:#dbe6f4;background:rgba(90,160,255,.1);border:1px solid rgba(90,160,255,.32);border-radius:999px;padding:22px 40px}
    /* before/after */
    .ba{display:flex;gap:40px;margin-top:34px}
    .ba .bacol{flex:1;border-radius:20px;padding:34px 38px;border:1px solid rgba(255,255,255,.1)}
    .ba .bexlabel{font-family:'Mono';font-size:20px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:16px}
    .ba .before{background:rgba(229,106,85,.07);border-color:rgba(229,106,85,.3)}
    .ba .before .bexlabel{color:#f58e7c}
    .ba .after{background:rgba(66,201,166,.08);border-color:rgba(66,201,166,.34)}
    .ba .after .bexlabel{color:#5fe3c7}
    .ba .bt2{font-size:40px;font-weight:600;color:#eaf1fb}
    .exbadge{display:inline-block;font-family:'Mono';font-size:19px;letter-spacing:.16em;text-transform:uppercase;color:#7f93ad;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 14px;margin-bottom:22px}
    /* close */
    .close-wrap{align-items:flex-start}
    .closebrand{display:flex;align-items:center;gap:22px}
    .closebrand .cd{width:26px;height:26px;border-radius:50%;background:#42c9a6;box-shadow:0 0 28px rgba(66,201,166,.9)}
    .closebrand .ct{font-weight:700;font-size:72px;color:#f4f7fb;letter-spacing:-.01em}
    .closetag{margin-top:30px;font-size:40px;color:#aab8cc}
    .accent{height:6px;width:360px;border-radius:5px;background:linear-gradient(90deg,#5aa0ff,#42c9a6);margin-top:44px}
    .title-sm{margin-top:26px;font-family:'Mono';font-size:26px;letter-spacing:.10em;color:#8ea3bd}
  </style></head><body>
  <div class="stage"><div class="grid"></div><div class="glowb" id="glowb"></div></div>
  <div class="topbar"><div class="brand"><span class="dot"></span><span class="bt">Artifex Labs</span><span class="bs">Quick-Fix</span></div><span class="tag">${s.tag} / 09</span></div>
  <div class="prog"><i id="progfill"></i></div>

  <!-- 1 HOOK -->
  <section class="scene" data-a="0.00" data-b="0.12">
    <div class="anim eyebrow" data-i="0" data-anim="up">How Quick-Fix works</div>
    <div class="anim hook" data-i="1" data-anim="up">${s.hook}</div>
    <div class="anim subhook" data-i="2" data-anim="up">${s.title} — one clearly defined problem, fixed properly.</div>
  </section>

  <!-- 2 PROBLEM -->
  <section class="scene" data-a="0.12" data-b="0.28">
    <div class="two">
      <div class="col">
        <div class="anim kicker" data-i="0" data-anim="up">The friction</div>
        <div class="anim callout" data-i="1" data-anim="up"><span class="cd"></span>${s.callout}</div>
        <div class="anim exbadge" data-i="2" data-anim="up" style="margin-top:26px">Example interface</div>
      </div>
      <div class="anim mock" data-i="1" data-anim="right">${deviceMock(s.mock)}</div>
    </div>
  </section>

  <!-- 3 WHAT WE FIX -->
  <section class="scene" data-a="0.28" data-b="0.48">
    <div class="anim eyebrow" data-i="0" data-anim="up">What Artifex fixes</div>
    <div class="grid2">${fixes}</div>
  </section>

  <!-- 4 PROCESS -->
  <section class="scene" data-a="0.48" data-b="0.66">
    <div class="anim eyebrow" data-i="0" data-anim="up">The process</div>
    <div class="pipe"><span class="pfill" id="pfill"></span>${proc}</div>
  </section>

  <!-- 5 TRUST + before/after -->
  <section class="scene" data-a="0.66" data-b="0.86">
    <div class="anim eyebrow" data-i="0" data-anim="up">How you're protected</div>
    <div class="chips">${trust}</div>
    <div class="ba">
      <div class="anim bacol before" data-i="1" data-anim="up"><div class="bexlabel">Example · before</div><div class="bt2">${s.before}</div></div>
      <div class="anim bacol after" data-i="2" data-anim="up"><div class="bexlabel">Example · what the repair addresses</div><div class="bt2">${s.after}</div></div>
    </div>
  </section>

  <!-- 6 CLOSE -->
  <section class="scene close-wrap" data-a="0.86" data-b="1.001">
    <div class="anim closebrand" data-i="0" data-anim="up"><span class="cd"></span><span class="ct">Artifex Quick-Fix</span></div>
    <div class="anim closetag" data-i="1" data-anim="up">Fixed scope · Fixed price · Confirmed completion</div>
    <div class="anim accent" data-i="2" data-anim="left"></div>
    <div class="anim title-sm" data-i="3" data-anim="up">${s.title}</div>
  </section>

  <script>
    const scenes = [...document.querySelectorAll('.scene')].map(el => ({
      el, a: parseFloat(el.dataset.a), b: parseFloat(el.dataset.b),
      anims: [...el.querySelectorAll('.anim')].map(n => ({ n, i: parseInt(n.dataset.i||'0',10), type: n.dataset.anim||'up' })),
    }));
    const steps = [...document.querySelectorAll('.step')];
    const pfill = document.getElementById('pfill');
    const progfill = document.getElementById('progfill');
    const glowb = document.getElementById('glowb');
    const stage = document.querySelector('.stage');
    const clamp = (x,lo,hi)=>Math.max(lo,Math.min(hi,x));
    const easeOut = x => 1 - Math.pow(1 - clamp(x,0,1), 3);
    const easeIO = x => x<0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2;
    function tf(type, e){
      const inv = 1 - e;
      if(type==='up') return 'translateY(' + (46*inv).toFixed(2) + 'px)';
      if(type==='right') return 'translateX(' + (70*inv).toFixed(2) + 'px) scale(' + (0.96+0.04*e).toFixed(3) + ')';
      if(type==='left') return 'scaleX(' + e.toFixed(3) + ')';
      if(type==='scale') return 'scale(' + (0.8+0.2*e).toFixed(3) + ')';
      return 'none';
    }
    window.__draw = function(t, D){
      const p = clamp(t / D, 0, 1);
      // progress bar + subtle background parallax
      progfill.style.width = (p*100).toFixed(2) + '%';
      stage.style.setProperty('--gx', (26 + Math.sin(p*Math.PI*2)*4).toFixed(2) + '%');
      stage.style.setProperty('--gy', (20 + p*10).toFixed(2) + '%');
      glowb.style.right = (-80 + Math.sin(p*6.28)*40) + 'px';
      glowb.style.bottom = (-120 + Math.cos(p*6.28)*40) + 'px';
      for(const sc of scenes){
        const fin = 0.6 / D;   // fade-in seconds → frac
        const fout = 0.5 / D;
        let op = 0;
        if(p >= sc.a - 0.0001 && p <= sc.b + fout){
          const inp = clamp((p - sc.a)/fin, 0, 1);
          const outp = p > sc.b ? clamp((p - sc.b)/fout, 0, 1) : 0;
          op = easeIO(inp) * (1 - easeOut(outp));
        }
        sc.el.style.opacity = op.toFixed(3);
        sc.el.style.display = op < 0.003 ? 'none' : 'flex';
        if(op < 0.003) continue;
        const lp = clamp((p - sc.a)/((sc.b - sc.a)||1), 0, 1);
        for(const a of sc.anims){
          const delay = Math.min(a.i * 0.13, 0.7);
          const e = easeOut((lp - delay)/(1 - delay || 1));
          a.n.style.opacity = e.toFixed(3);
          a.n.style.transform = tf(a.type, e);
        }
        // process pipeline fill + node activation
        if(sc.el.querySelector('.pipe')){
          pfill.style.width = (easeIO(lp) * 92).toFixed(2) + '%';
          steps.forEach((st,idx)=>{ st.classList.toggle('on', lp > (idx+0.5)/steps.length); });
        }
      }
    };
    window.__ready = true;
  </script></body></html>`;
}

function ffprobeJson(file) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,codec_name", "-of", "json", file], { encoding: "utf8" }));
}
function audioDuration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim()) || 0;
}
const sha16 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

// Split the spoken script into sentence cues distributed by character length so the
// .vtt tracks the audio (sentence-level; TTS has no per-word timing available).
function buildVtt(script, D) {
  const parts = script.match(/[^.!?]+[.!?]+/g) || [script];
  const total = parts.reduce((n, s) => n + s.trim().length, 0) || 1;
  const fmt = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = (sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  };
  let acc = 0, out = "WEBVTT\n\n";
  for (const raw of parts) {
    const seg = raw.trim(); const start = (acc / total) * D; acc += seg.length; const end = (acc / total) * D;
    out += `${fmt(start)} --> ${fmt(Math.min(end, D))}\n${seg}\n\n`;
  }
  return out;
}

async function main() {
  const only = process.argv[2];
  mkdirSync(OUT_DIR, { recursive: true });
  const keys = only ? [only] : Object.keys(SCOPES);
  const audioName = {
    "contact-form-lead-capture": "Artifex Evergreen - Contact form _ lead capture.mp3",
    "cta-conversion": "Artifex Evergreen - CTA _ conversion.mp3",
    "mobile-responsive": "Artifex Evergreen - Mobile _ layout.mp3",
    "accessibility": "Artifex Evergreen - Accessibility.mp3",
    "analytics-tracking": "Artifex Evergreen - Analytics _ tracking.mp3",
    "cms-technical": "Artifex Evergreen - CMS _ technical.mp3",
    "seo-metadata": "Artifex Evergreen - SEO _ metadata cleanup.mp3",
    "homepage-sprint": "Artifex Evergreen - Homepage _ conversion sprint.mp3",
    "fix-scan": "Artifex Evergreen - Fix Scan.mp3",
  };

  const browser = await chromium.launch();
  const manifest = [];

  for (const key of keys) {
    const s = SCOPES[key];
    const audioPath = path.join(AUDIO_DIR, audioName[key]);
    if (!existsSync(audioPath)) { console.log(`  ✗ ${key}: audio missing (${audioName[key]})`); continue; }
    const D = audioDuration(audioPath);
    if (!(D > 0)) { console.log(`  ✗ ${key}: could not read audio duration`); continue; }

    // A FRESH page per scope — reusing one page across setContent() calls corrupted
    // the animation for every scope after the first (scenes never revealed). Isolation
    // guarantees each scope renders like a first load.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.setContent(timelineHtml(s), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { if (!window.__draw) throw new Error("timeline script did not initialise"); });

    const frameDir = path.join(tmpdir(), `qf-v2-${key}-${process.pid}`);
    rmSync(frameDir, { recursive: true, force: true });
    mkdirSync(frameDir, { recursive: true });
    const N = Math.round(D * FPS);
    let posterBuf = null;
    process.stdout.write(`  … ${key}: ${D.toFixed(1)}s → ${N} frames `);
    for (let i = 0; i < N; i++) {
      const t = i / FPS;
      await page.evaluate(([tt, dd]) => window.__draw(tt, dd), [t, D]);
      const buf = await page.screenshot({ type: "jpeg", quality: 82 });
      writeFileSync(path.join(frameDir, `f${String(i).padStart(5, "0")}.jpg`), buf);
      if (i === Math.round(N * 0.16)) posterBuf = buf; // poster = a populated (hook) frame
      if (i % 200 === 0) process.stdout.write(".");
    }
    process.stdout.write("\n");
    await page.close();

    const posterPath = path.join(OUT_DIR, `${key}-v${VERSION}-poster.jpg`);
    if (posterBuf) writeFileSync(posterPath, posterBuf);

    const outMp4 = path.join(OUT_DIR, `${key}-v${VERSION}.mp4`);
    execFileSync("ffmpeg", ["-y", "-framerate", String(FPS), "-i", path.join(frameDir, "f%05d.jpg"),
      "-i", audioPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
      "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", outMp4], { stdio: "ignore" });
    rmSync(frameDir, { recursive: true, force: true });

    // captions (.vtt) = the actual spoken script
    const vttPath = path.join(OUT_DIR, `${key}-v${VERSION}.vtt`);
    writeFileSync(vttPath, buildVtt(spokenScript(key), D));

    // QA — probe the DELIVERED mp4: correct res, audio present, and real MOTION
    // (sample 3 frames straight from the output file at 10/50/90% and require them
    // to differ — this validates the actual artifact, not the capture buffers).
    const probe = ffprobeJson(outMp4);
    const v = (probe.streams || []).find((x) => x.codec_type === "video");
    const a = (probe.streams || []).find((x) => x.codec_type === "audio");
    const dur = Number(probe.format?.duration || 0);
    // Sample 4 frames well inside distinct scenes; require ALL distinct (an empty /
    // broken render would repeat the same chrome-only frame).
    const samples = [0.2, 0.4, 0.6, 0.8].map((f) => {
      const png = path.join(tmpdir(), `qf-probe-${process.pid}-${key}-${Math.round(f * 100)}.png`);
      execFileSync("ffmpeg", ["-y", "-ss", String(dur * f), "-i", outMp4, "-frames:v", "1", png], { stdio: "ignore" });
      const h = sha16(readFileSync(png)); rmSync(png, { force: true }); return h;
    });
    const distinct = new Set(samples).size;
    const hasMotion = distinct === samples.length;
    const qa = { hasVideo: !!v, res: v ? `${v.width}x${v.height}` : "none", hasAudio: !!a, audioCodec: a?.codec_name, durationSec: Math.round(dur * 10) / 10, hasMotion, motionFrames: `${distinct}/${samples.length}`, hasCaptions: existsSync(vttPath) };
    const ok = qa.hasVideo && qa.res === "1920x1080" && qa.hasAudio && dur > 30 && qa.hasMotion && qa.hasCaptions;
    console.log(`  ${ok ? "✓" : "✗"} ${key}: ${qa.res} ${qa.durationSec}s audio=${qa.audioCodec} motion=${qa.motionFrames} → ${key}-v${VERSION}.mp4`);
    manifest.push({ scope: key, title: s.title, file: `/trust-videos/${key}-v${VERSION}.mp4`, poster: `/trust-videos/${key}-v${VERSION}-poster.jpg`, captions: `/trust-videos/${key}-v${VERSION}.vtt`, version: VERSION, scriptVersion: SCRIPT_VERSION, durationSeconds: qa.durationSec, audioSha16: sha16(readFileSync(audioPath)), qa, active: ok, createdAt: new Date().toISOString() });
  }
  await browser.close();
  const manifestPath = path.join(OUT_DIR, "manifest-v2.json");
  writeFileSync(manifestPath, JSON.stringify({ generatedWith: "playwright-chromium frame-by-frame + ffmpeg (libx264/aac)", scriptVersion: SCRIPT_VERSION, fps: FPS, assets: manifest }, null, 2));
  const okCount = manifest.filter((m) => m.active).length;
  console.log(`\n════════ v2 MOTION: ${okCount}/${manifest.length} QA-passed → ${manifestPath} ════════\n`);
  process.exit(manifest.length && okCount === manifest.length ? 0 : 1);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
