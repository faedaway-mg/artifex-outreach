// ─────────────────────────────────────────────────────────────────────────────
// Deterministic renderer: validated ConceptSpec → sanitized HTML + CSS.
// Emits semantic, mobile-first markup. NEVER emits scripts, event handlers, raw
// model HTML, iframes, or unsafe URLs. Always includes the concept disclaimer and
// Artifex attribution. Text is HTML-escaped; hrefs are re-validated.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConceptSpec, ConceptComponent } from "./spec";
import { tokensFor } from "./spec";

export const CONCEPT_DISCLAIMER =
  "Concept Website Preview — prepared by Artifex Labs for demonstration only. Not affiliated with, approved by, or requested by this business. Final design and scope require discovery and agreement. Represented features, pricing, and claims are illustrative and not implemented.";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function href(u: unknown): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || /^(tel:|mailto:)/i.test(s)) return esc(s);
  return null; // drop javascript:, data:, relative, anything else
}
function btn(label: string, url: unknown): string {
  const h = href(url);
  return h ? `<a class="btn" href="${h}" rel="nofollow noopener">${esc(label)}</a>` : `<span class="btn">${esc(label)}</span>`;
}

function renderComponent(c: ConceptComponent): string {
  switch (c.type) {
    case "navigation":
      return `<header class="nav"><div class="nav-in"><span class="brand">${esc(c.props.businessName)}</span><nav>${c.props.links.map((l) => `<span class="nav-link">${esc(l)}</span>`).join("")}</nav>${c.props.cta ? `<span class="btn btn-sm">${esc(c.props.cta)}</span>` : ""}</div></header>`;
    case "hero":
      return `<section class="hero"><div class="wrap">${c.props.eyebrow ? `<p class="eyebrow">${esc(c.props.eyebrow)}</p>` : ""}<h1>${esc(c.props.headline)}</h1><p class="lede">${esc(c.props.subhead)}</p>${btn(c.props.ctaLabel, c.props.ctaHref)}</div></section>`;
    case "serviceGrid":
      return `<section class="section"><div class="wrap"><h2>${esc(c.props.heading)}</h2><div class="grid">${c.props.services.map((s) => `<div class="card"><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p></div>`).join("")}</div></div></section>`;
    case "trustMetrics":
      return `<section class="section metrics"><div class="wrap">${c.props.heading ? `<h2>${esc(c.props.heading)}</h2>` : ""}<div class="grid">${c.props.metrics.map((m) => `<div class="metric"><span class="num">${esc(m.value)}</span><span class="lbl">${esc(m.label)}</span></div>`).join("")}</div></div></section>`;
    case "process":
      return `<section class="section"><div class="wrap"><h2>${esc(c.props.heading)}</h2><ol class="steps">${c.props.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></li>`).join("")}</ol></div></section>`;
    case "reviewSummary":
      return `<section class="section review"><div class="wrap"><p class="rating"><strong>${esc(c.props.rating)}</strong> · ${esc(c.props.reviewCount)} reviews <span class="muted">(${esc(c.props.source)})</span></p></div></section>`;
    case "appointmentCta":
    case "consultationCta":
    case "quoteRequest":
      return `<section class="section cta"><div class="wrap"><h2>${esc(c.props.heading)}</h2><p>${esc(c.props.body)}</p>${btn(c.props.buttonLabel, c.props.buttonHref)}</div></section>`;
    case "faq":
      return `<section class="section"><div class="wrap"><h2>${esc(c.props.heading)}</h2><div class="faq">${c.props.items.map((i) => `<div class="qa"><p class="q">${esc(i.q)}</p><p class="a">${esc(i.a)}</p></div>`).join("")}</div></div></section>`;
    case "contact":
      return `<section class="section"><div class="wrap"><h2>${esc(c.props.heading)}</h2><address>${c.props.phone ? `<p>${esc(c.props.phone)}</p>` : ""}${c.props.address ? `<p>${esc(c.props.address)}</p>` : ""}</address>${c.props.bookingHref ? btn("Book now", c.props.bookingHref) : ""}</div></section>`;
    case "footer":
      return `<footer class="foot"><div class="wrap"><p class="brand">${esc(c.props.businessName)}</p>${c.props.phone ? `<p>${esc(c.props.phone)}</p>` : ""}${c.props.address ? `<p class="muted">${esc(c.props.address)}</p>` : ""}</div></footer>`;
    case "disclaimer":
      return `<div class="disclaimer"><p>${esc(c.props.text)}</p></div>`;
  }
}

function css(direction: string): string {
  const t = tokensFor(direction);
  return `*{box-sizing:border-box;margin:0}html{scroll-behavior:smooth}body{font-family:${t.font};background:${t.bg};color:${t.text};line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.nav{position:sticky;top:0;background:${t.bg}cc;backdrop-filter:blur(8px);border-bottom:1px solid #ffffff14;z-index:5}
.nav-in{display:flex;align-items:center;gap:20px;max-width:1080px;margin:0 auto;padding:16px 24px}
.brand{font-weight:700}.nav nav{display:flex;gap:18px;flex-wrap:wrap}.nav-link{color:${t.muted};font-size:14px}
.btn{display:inline-block;background:${t.accent};color:${t.accentText};padding:12px 22px;border-radius:${t.radius};font-weight:600;text-decoration:none;margin-top:8px}
.btn-sm{padding:8px 16px;margin:0;font-size:14px}
.hero{padding:96px 0 72px;background:${t.heroBg}}.eyebrow{color:${t.accent};text-transform:uppercase;letter-spacing:.12em;font-size:13px;font-weight:600;margin-bottom:12px}
h1{font-size:clamp(2rem,5vw,3.2rem);line-height:1.05;margin-bottom:16px;max-width:16ch}.lede{color:${t.muted};font-size:clamp(1rem,2vw,1.25rem);max-width:52ch;margin-bottom:8px}
.section{padding:56px 0;border-top:1px solid #ffffff10}h2{font-size:clamp(1.5rem,3vw,2.1rem);margin-bottom:24px}h3{font-size:1.15rem;margin-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card{background:${t.surface};border:1px solid #ffffff10;border-radius:${t.radius};padding:22px}.card p,.qa .a,.metric .lbl{color:${t.muted}}
.metrics .num{display:block;font-size:2.4rem;font-weight:700;color:${t.accent}}.metric{background:${t.surface};border-radius:${t.radius};padding:22px;text-align:center}
.steps{list-style:none;display:grid;gap:16px;counter-reset:s}.steps li{background:${t.surface};border-radius:${t.radius};padding:20px;position:relative}
.cta .wrap{background:${t.surface};border:1px solid #ffffff14;border-radius:${t.radius};padding:40px;text-align:center}
.review .rating{font-size:1.2rem}.muted{color:${t.muted}}.faq .qa{padding:16px 0;border-bottom:1px solid #ffffff10}.q{font-weight:600;margin-bottom:4px}
address{font-style:normal;color:${t.muted};margin-bottom:12px}
.foot{padding:40px 0;border-top:1px solid #ffffff14;color:${t.muted}}.foot .brand{color:${t.text};font-weight:700;margin-bottom:6px}
.disclaimer{background:#00000055;border-top:1px solid #ffffff1a;padding:16px 24px}.disclaimer p{max-width:1080px;margin:0 auto;color:#c9b98f;font-size:12.5px;line-height:1.5}
.artifex-attr{padding:14px 24px;text-align:center;color:${t.muted};font-size:12px;border-top:1px solid #ffffff10}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
}

/** Render a validated spec to sanitized HTML + CSS. Always adds a disclaimer bar
 *  (if the spec lacks one) and an Artifex attribution line. */
export function renderConcept(spec: ConceptSpec): { html: string; css: string } {
  const styles = css(spec.meta.visualDirection);
  const hasDisclaimer = spec.components.some((c) => c.type === "disclaimer");
  const parts = spec.components.map(renderComponent).join("\n");
  const disclaimerBar = hasDisclaimer ? "" : `<div class="disclaimer"><p>${esc(CONCEPT_DISCLAIMER)}</p></div>`;
  const attribution = `<div class="artifex-attr">Concept prepared by Artifex Labs · artifexlabs.tech · Demonstration only</div>`;
  const title = `${esc(spec.meta.businessName)} — Concept Website Preview`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${title}</title><style>${styles}</style></head><body><main>${parts}</main>${disclaimerBar}${attribution}</body></html>`;
  return { html, css: styles };
}
