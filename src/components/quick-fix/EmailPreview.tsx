"use client";
import { useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL AS AN EMAIL (Part C) — render From / To / Subject then the ACTUAL bodyHtml
// in a sandboxed frame (never a monospaced dump). Raw links are replaced with
// friendly labels for the reader; the real hrefs stay correct and live in a
// secondary "Links / technical details" panel. Attachment manifest is explicit:
// EMAIL ATTACHMENTS: none · AVAILABLE ON OFFER (screenshots/PDF/video). No MP4/PDF
// is ever auto-attached. This component only PREVIEWS — it never sends.
// ─────────────────────────────────────────────────────────────────────────────

interface EmailLink { label: string; href: string; kind: "buy" | "book" | "other" }
interface ManifestRow { key: string; label: string; status: string; detail: string }

export interface EmailPreviewProps {
  header: { fromName: string; fromEmail: string; to: string | null; subject: string };
  bodyHtml: string;
  bodyText: string;
  primaryCta: string;
  safe: boolean;
  links: EmailLink[];
  attachments: "none";
  /** The customer-receives manifest — surfaced as "available on the offer", NOT attached. */
  customerReceives: ManifestRow[];
}

/** Rewrite the composed bodyHtml so anchors read as friendly labels while keeping the
 *  exact href. Purely textual anchor-label substitution — no script, no new links. */
function friendlyHtml(bodyHtml: string, links: EmailLink[]): string {
  let html = bodyHtml;
  for (const l of links) {
    // Replace the visible text of the anchor pointing at this href with the label.
    const escapedHref = l.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(<a[^>]*href="${escapedHref}"[^>]*>)([\\s\\S]*?)(</a>)`, "i");
    html = html.replace(re, `$1${l.label}$3`);
  }
  return html;
}

const STATUS_CLS: Record<string, string> = {
  READY: "text-teal-300",
  MISSING: "text-chalk-500",
  STALE: "text-amber-300",
  UNVERIFIED: "text-amber-300",
  NOT_APPLICABLE: "text-chalk-500",
};

export function EmailPreview({ header, bodyHtml, bodyText, primaryCta, safe, links, customerReceives }: EmailPreviewProps) {
  const [showTech, setShowTech] = useState(false);
  const srcDoc = useMemo(() => {
    const body = friendlyHtml(bodyHtml, links);
    // Sandboxed document: no scripts, restrained typographic styling to read like mail.
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:16px;font-size:15px;line-height:1.55}
      a{color:#2C5AC4;text-decoration:none;font-weight:600}
      p{margin:0 0 12px}
    </style></head><body>${body}</body></html>`;
  }, [bodyHtml, links]);

  const available = customerReceives.filter((r) => r.key !== "email");

  return (
    <div className="space-y-3">
      {/* Envelope: From / To / Subject */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[13px]">
        <div className="flex gap-2"><span className="w-16 shrink-0 text-chalk-500">From</span><span className="text-chalk-200">{header.fromName} &lt;{header.fromEmail}&gt;</span></div>
        <div className="flex gap-2"><span className="w-16 shrink-0 text-chalk-500">To</span><span className="text-chalk-200">{header.to ?? <span className="text-amber-300">no recipient on file</span>}</span></div>
        <div className="flex gap-2"><span className="w-16 shrink-0 text-chalk-500">Subject</span><span className="font-medium text-chalk-100">{header.subject}</span></div>
      </div>

      {!safe && (
        <p className="rounded-lg bg-coral-500/10 px-3 py-2 text-[12.5px] text-coral-300">This draft failed the fabrication-safety guard and cannot be sent.</p>
      )}

      {/* The actual email body, rendered as an email (sandboxed, no scripts) */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white">
        <iframe title="Email preview" sandbox="" srcDoc={srcDoc} className="h-64 w-full" />
      </div>
      <div className="text-[11px] text-chalk-500">Primary CTA: {primaryCta} · fabrication-safe: {String(safe)}</div>

      {/* Attachment manifest — nothing is auto-attached */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-chalk-400">EMAIL ATTACHMENTS</span>
          <span className="font-medium text-chalk-200">none</span>
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wide text-chalk-500">Available on the offer (not attached)</div>
        <ul className="mt-1 space-y-1">
          {available.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3">
              <span className="text-chalk-300">{r.label}</span>
              <span className={STATUS_CLS[r.status] ?? "text-chalk-400"}>{r.status}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Secondary: raw links / technical details */}
      <button onClick={() => setShowTech((v) => !v)} className="text-[12px] text-chalk-500 hover:text-chalk-300">
        {showTech ? "Hide" : "Show"} links / technical details
      </button>
      {showTech && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[12px] space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">Real link targets</div>
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li key={l.href} className="min-w-0">
                <div className="text-chalk-300">{l.label}</div>
                <div className="truncate font-mono text-[11px] text-chalk-500">{l.href}</div>
              </li>
            ))}
          </ul>
          <div className="text-[11px] uppercase tracking-wide text-chalk-500">Plain-text body</div>
          <pre className="whitespace-pre-wrap break-words text-[11px] text-chalk-500">{bodyText}</pre>
        </div>
      )}
    </div>
  );
}
