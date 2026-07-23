// ─────────────────────────────────────────────────────────────────────────────
// Email rendering — the Artifex Labs branded shell.
//
// One reusable shell wraps every outbound message so the email feels like the same
// company that built the app, the PDFs, and the site: a restrained header with the
// constellation mark, a soft-ivory reading surface with deep-charcoal text, a fine
// gold constellation divider, a concise founder signature, and a restrained footer.
//
// Email-client-safe by construction: table layout, inline CSS, ~600px, a light surface
// (never a hard dark mode), a CSS brand mark that survives image-blocking, and a
// plaintext fallback that is the source of truth. Nothing is fabricated — a missing
// video thumbnail becomes a text link, never an invented preview. The in-app preview
// and the delivered message both come from this file, so they cannot drift.
// ─────────────────────────────────────────────────────────────────────────────
import type { Settings } from "../types";
import type { OutreachEmail, VeedVideo } from "./types";

// ── Palette — email-safe, light, warm. Gold is the only accent, used sparingly. ──
const SURFACE = "#ECE9E2";   // page behind the card
const PAPER = "#FCFBF8";     // the reading surface (soft ivory)
const INK = "#211C15";       // deep charcoal text
const MUTE = "#6E665A";      // muted slate secondary
const GOLD_LINK = "#A9741B"; // dark gold — readable on ivory (links, labels)
const HAIR = "#E7E2D8";      // hairline divider on paper
const TILE = "#14110C";      // brand mark tile
const GOLD = "#E8A24A";      // warm constellation gold (mark + button)
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Bare URLs → understated gold links inside body paragraphs.
function linkify(s: string): string {
  return escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${GOLD_LINK};text-decoration:none;">${u.replace(/^https?:\/\//, "")}</a>`);
}

// The constellation mark as a CSS box — renders in every client, survives image
// blocking. A hosted PNG can be passed via `logoUrl` to upgrade it; the box remains
// the reliable default so the brand is never lost to a blocked image.
function markBox(size = 40): string {
  const a = Math.round(size * 0.5);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:${size}px;height:${size}px;background:${TILE};border-radius:${Math.round(size * 0.26)}px;"><tr><td align="center" valign="middle" style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:${a}px;line-height:1;color:${GOLD};">A</td></tr></table>`;
}
function markImg(logoUrl?: string | null, size = 40): string {
  return logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="${size}" height="${size}" alt="Artifex Labs" style="display:block;border-radius:${Math.round(size * 0.26)}px;">`
    : markBox(size);
}

// A fine constellation divider: a hairline with three small gold nodes.
function constellationDivider(): string {
  const node = `<td style="width:5px;"><div style="width:5px;height:5px;border-radius:5px;background:${GOLD};opacity:0.85;"></div></td>`;
  const line = `<td><div style="height:1px;background:${HAIR};line-height:1px;font-size:0;">&nbsp;</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>${line}${node}<td style="width:34px;"><div style="height:1px;background:${HAIR};"></div></td>${node}${line}${node}${line}</tr></table>`;
}

function header(logoUrl?: string | null): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="middle" style="width:52px;">${markImg(logoUrl, 40)}</td>
      <td valign="middle" style="padding-left:12px;">
        <div style="font-weight:600;color:${INK};font-size:15px;line-height:1.25;letter-spacing:0.2px;">Artifex Labs</div>
        <div style="color:${MUTE};font-size:12px;line-height:1.35;">Business technology partner</div>
      </td>
    </tr>
  </table>`;
}

function signatureHtml(logoUrl?: string | null, bookingUrl?: string | null): string {
  const booking = bookingUrl
    ? `<div style="margin-top:6px;font-size:13px;line-height:1.5;"><a href="${escapeHtml(bookingUrl)}" style="color:${GOLD_LINK};text-decoration:none;">Book a conversation &rarr;</a></div>`
    : "";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
    <tr>
      <td valign="top" style="width:46px;">${markImg(logoUrl, 34)}</td>
      <td valign="top" style="padding-left:12px;">
        <div style="font-weight:600;color:${INK};font-size:15px;line-height:1.4;">Jordan Jackson</div>
        <div style="color:${MUTE};font-size:13px;line-height:1.5;">Artifex Labs &middot; Business technology partner</div>
        ${booking}
      </td>
    </tr>
  </table>`;
}

/** A real-action CTA — constellation gold, dark text, tap-friendly. Use sparingly. */
export function ctaButton(label: string, url: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr>
    <td align="center" bgcolor="${GOLD}" style="border-radius:10px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#14100B;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

// A clean, clickable video preview with a guaranteed text-link fallback.
export function veedBlockHtml(veed: VeedVideo, businessName?: string | null): string {
  const title = veed.title ? escapeHtml(veed.title) : "A short personal video";
  const dur = veed.durationSeconds ? `${veed.durationSeconds}-second ` : "";
  const label = businessName ? escapeHtml(businessName) : "";
  const caption = `&#9654;&nbsp; Watch the ${dur}video${veed.title ? `: ${title}` : ""}`;
  const thumb = veed.thumbnailUrl
    ? `<a href="${escapeHtml(veed.url)}" style="text-decoration:none;"><img src="${escapeHtml(veed.thumbnailUrl)}" width="536" alt="${label ? `Video for ${label}` : title}" style="display:block;width:100%;max-width:536px;border-radius:12px;border:1px solid ${HAIR};"></a>`
    : "";
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td style="border:1px solid ${HAIR};border-radius:14px;padding:12px;background:#ffffff;">
      ${label ? `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${GOLD_LINK};margin-bottom:8px;">A note for ${label}</div>` : ""}
      ${thumb}
      <div style="margin-top:${thumb ? "10px" : "0"};font-size:14px;"><a href="${escapeHtml(veed.url)}" style="color:${GOLD_LINK};text-decoration:none;font-weight:600;">${caption}</a></div>
    </td></tr>
  </table>`;
}

export interface RenderInput {
  email: OutreachEmail;
  settings: Settings;
  veed?: VeedVideo | null;
  unsubscribeUrl?: string | null;
  logoUrl?: string | null;
  /** Business name for the video card. */
  businessName?: string | null;
  /** A real CTA where one genuinely helps (e.g. Book a conversation). Optional. */
  cta?: { label: string; url: string } | null;
}

/** The final HTML the recipient sees — and the exact HTML previewed in the app. */
export function renderEmailHtml(input: RenderInput): string {
  const { email, settings, veed, unsubscribeUrl, logoUrl, businessName } = input;
  const paras = email.paragraphs.map((p) => `<p style="margin:0 0 15px;">${linkify(p)}</p>`).join("\n");
  const videoHtml = veed?.url ? veedBlockHtml(veed, businessName) : "";
  const ctaHtml = input.cta ? ctaButton(input.cta.label, input.cta.url) : "";
  const addr = settings.businessAddress ? escapeHtml(settings.businessAddress) : "";
  // Restrained footer. Unsubscribe appears only for commercial/sequenced mail (when a
  // URL is supplied); a truly manual note gets a minimal footer, never invented opt-out.
  const footerCore = `<a href="${escapeHtml(settings.website || "https://artifexlabs.tech")}" style="color:${MUTE};text-decoration:none;">artifexlabs.tech</a>`;
  const footer = unsubscribeUrl
    ? `${addr ? `${addr}<br>` : ""}Prefer not to hear from me? <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTE};text-decoration:underline;">Unsubscribe</a> and I won't follow up. &middot; ${footerCore}`
    : `Artifex Labs &middot; ${footerCore}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};color-scheme:light;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};">
    <tr><td align="center" style="padding:26px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:${FONT};color:${INK};font-size:15.5px;line-height:1.62;">
        <tr><td style="background:${PAPER};border:1px solid ${HAIR};border-radius:16px;padding:26px 30px;">
          ${header(logoUrl)}
          ${constellationDivider()}
          ${paras}
          ${videoHtml}
          ${ctaHtml}
          ${signatureHtml(logoUrl, settings.calendarLink)}
        </td></tr>
        <tr><td style="padding:16px 34px 4px;color:${MUTE};font-size:11.5px;line-height:1.6;">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Plaintext fallback — content + video link + signature + unsubscribe. Source of truth. */
export function renderEmailText(input: RenderInput): string {
  const { email, settings, veed, unsubscribeUrl } = input;
  const parts = [...email.paragraphs];
  if (input.cta) parts.push(`${input.cta.label}: ${input.cta.url}`);
  if (veed?.url) {
    const dur = veed.durationSeconds ? `${veed.durationSeconds}-second ` : "";
    parts.push(`Watch the ${dur}video${veed.title ? ` (${veed.title})` : ""}: ${veed.url}`);
  }
  parts.push(`Jordan Jackson\nArtifex Labs — Business technology partner${settings.calendarLink ? `\nBook a conversation: ${settings.calendarLink}` : ""}`);
  const site = settings.website || "https://artifexlabs.tech";
  const footer = unsubscribeUrl
    ? `${settings.businessAddress ?? ""}\nPrefer not to hear from me? Unsubscribe: ${unsubscribeUrl} — and I won't follow up.\n${site}`.trim()
    : `Artifex Labs · ${site}`;
  parts.push(footer);
  return parts.join("\n\n");
}

/** Convenience: render an OutreachEmail to exactly what gets sent. */
export function renderIntroEmail(input: RenderInput): { subject: string; html: string; text: string } {
  return { subject: input.email.subject, html: renderEmailHtml(input), text: renderEmailText(input) };
}
