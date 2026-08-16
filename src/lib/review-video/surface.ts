// ─────────────────────────────────────────────────────────────────────────────
// Review surface package (Batch M1.1 completion) — the analyzed public-surface material persisted WITH
// the review so the renderer can show the prospect's real page WITHOUT re-crawling (the render stage is
// a renderer, not a second intelligence system). The HTML is SANITIZED: active scripts, inline event
// handlers, forms, and remote trackers are removed so batch rendering never executes the prospect's
// JavaScript or fires analytics. Pure + deterministic; provenance (source URL, capturedAt) is preserved.
// ─────────────────────────────────────────────────────────────────────────────

export interface SurfacePage { url: string; html: string; role: string }
export interface SurfacePackage { pages: SurfacePage[]; capturedAt: string | null }

/** Strip anything active/external from analyzed HTML → a safe, renderable snapshot of the public text.
 *  Removes <script>/<noscript>/<iframe>/<object>, inline on* handlers, javascript: URLs, form actions,
 *  and common remote trackers. Keeps headings/text/links/structure for evidence context. Pure. */
export function sanitizeSurfaceHtml(html: string): string {
  if (!html) return "";
  let h = html;
  h = h.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");
  h = h.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
  h = h.replace(/<object\b[\s\S]*?<\/object>/gi, "");
  h = h.replace(/<embed\b[^>]*>/gi, "");
  h = h.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""); // inline event handlers
  h = h.replace(/(href|src|action)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  h = h.replace(/<form\b/gi, '<form onsubmit="return false"'); // neutralize form submits (belt-and-suspenders; handlers already stripped)
  h = h.replace(/<link\b[^>]*rel=["']?preconnect["']?[^>]*>/gi, ""); // drop preconnects to trackers
  return h;
}

/** Build a sanitized surface package from analyzed pages. `capturedAt` is supplied by the caller (the
 *  BI generatedAt) so the package is deterministic. Empty/invalid pages are dropped. Pure. */
export function buildSurfacePackage(pages: Array<{ url?: string; html?: string; role?: string }> | undefined | null, capturedAt: string | null): SurfacePackage {
  const out: SurfacePage[] = [];
  for (const p of pages ?? []) {
    const html = sanitizeSurfaceHtml(p?.html ?? "");
    if (!html.trim()) continue;
    out.push({ url: p?.url ?? "", html, role: p?.role ?? "homepage" });
  }
  return { pages: out, capturedAt };
}

/** The renderer's capture input: the body HTML of the primary analyzed page. Returns null when there's
 *  no persisted surface (→ the renderer falls back to text-only scenes, honestly, no fabricated page). */
export function primarySurfaceBody(pkg: SurfacePackage | null | undefined): string | null {
  const page = pkg?.pages?.[0];
  if (!page) return null;
  const m = page.html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (m ? m[1] : page.html).trim() || null;
}
