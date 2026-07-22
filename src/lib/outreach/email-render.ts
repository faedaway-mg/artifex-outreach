// ─────────────────────────────────────────────────────────────────────────────
// Email rendering — a restrained, professional Artifex Labs message.
//
// Table-based, inline styles, max 600px — reliable in Outlook and Gmail. A small
// signature (Jordan Jackson · Artifex Labs), an understated booking invitation,
// and a clean clickable VEED thumbnail that ALWAYS has a text-link fallback so a
// blocked image never hides the video. Plaintext is the source of truth; HTML is
// a faithful, accessible presentation of it. Nothing is fabricated: if no
// thumbnail is provided, we show a text link, never an invented preview.
// ─────────────────────────────────────────────────────────────────────────────
import type { Settings } from "../types";
import type { OutreachEmail, VeedVideo } from "./types";

const INK = "#1a1a1a";
const MUTE = "#6b7280";
const ACCENT = "#2b6cff";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Turn bare URLs into understated links (used inside body paragraphs).
function linkify(s: string): string {
  return escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${ACCENT};text-decoration:none;">${u.replace(/^https?:\/\//, "")}</a>`);
}

// The Artifex mark as a table/CSS box — renders everywhere, no image dependency.
// Pass a hosted PNG via logoUrl to upgrade it; falls back to the box if absent.
function logoMark(logoUrl?: string | null): string {
  if (logoUrl) {
    return `<img src="${logoUrl}" width="36" height="36" alt="Artifex Labs" style="display:block;border-radius:9px;">`;
  }
  return `<div style="width:36px;height:36px;border-radius:9px;background:${ACCENT};color:#ffffff;font-weight:700;font-size:16px;line-height:36px;text-align:center;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">A</div>`;
}

function signatureHtml(logoUrl?: string | null, bookingUrl?: string | null): string {
  const booking = bookingUrl
    ? `<div style="margin-top:5px;font-size:13px;line-height:1.5;"><a href="${escapeHtml(bookingUrl)}" style="color:${ACCENT};text-decoration:none;">Book a conversation</a></div>`
    : "";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;">
    <tr>
      <td valign="top" style="width:46px;">${logoMark(logoUrl)}</td>
      <td valign="top" style="padding-left:13px;">
        <div style="font-weight:600;color:${INK};font-size:15px;line-height:1.4;">Jordan Jackson</div>
        <div style="color:${MUTE};font-size:13px;line-height:1.5;">Founder, Artifex Labs</div>
        ${booking}
      </td>
    </tr>
  </table>`;
}

// A clean, clickable video preview with a guaranteed text-link fallback.
export function veedBlockHtml(veed: VeedVideo): string {
  const title = veed.title ? escapeHtml(veed.title) : "A short personal video";
  const dur = veed.durationSeconds ? `${veed.durationSeconds}-second ` : "";
  const caption = `&#9654;&nbsp; Watch the ${dur}video${veed.title ? `: ${title}` : ""}`;
  const thumb = veed.thumbnailUrl
    ? `<img src="${escapeHtml(veed.thumbnailUrl)}" width="536" alt="${title}" style="display:block;width:100%;max-width:536px;border-radius:12px;border:1px solid #e5e7eb;">`
    : "";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td>
      <a href="${escapeHtml(veed.url)}" style="text-decoration:none;color:${ACCENT};">
        ${thumb}
        <div style="margin-top:${thumb ? "8px" : "0"};font-size:14px;color:${ACCENT};">${caption}</div>
      </a>
    </td></tr>
  </table>`;
}

export interface RenderInput {
  email: OutreachEmail;
  settings: Settings;
  veed?: VeedVideo | null;
  unsubscribeUrl?: string | null;
  logoUrl?: string | null;
}

/** The final HTML the recipient will see. Content + optional video + signature. */
export function renderEmailHtml(input: RenderInput): string {
  const { email, settings, veed, unsubscribeUrl, logoUrl } = input;
  const paras = email.paragraphs.map((p) => `<p style="margin:0 0 16px;">${linkify(p)}</p>`).join("\n");
  const videoHtml = veed?.url ? veedBlockHtml(veed) : "";
  const unsub = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTE};text-decoration:underline;">unsubscribe</a>`
    : "unsubscribe";
  const addr = settings.businessAddress ? escapeHtml(settings.businessAddress) : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(email.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color-scheme:light;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.62;">
        <tr><td style="padding:8px 32px 0;">
          ${paras}
          ${videoHtml}
          ${signatureHtml(logoUrl, settings.calendarLink)}
        </td></tr>
        <tr><td style="padding:22px 32px 28px;">
          <div style="border-top:1px solid #eef0f2;padding-top:14px;color:${MUTE};font-size:12px;line-height:1.5;">
            ${addr ? `${addr}<br>` : ""}Not useful? You can ${unsub} and I won't follow up.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Plaintext fallback — content + video link + signature + unsubscribe. */
export function renderEmailText(input: RenderInput): string {
  const { email, settings, veed, unsubscribeUrl } = input;
  const parts = [...email.paragraphs];
  if (veed?.url) {
    const dur = veed.durationSeconds ? `${veed.durationSeconds}-second ` : "";
    parts.push(`Watch the ${dur}video${veed.title ? ` (${veed.title})` : ""}: ${veed.url}`);
  }
  const sig = `Jordan Jackson\nFounder, Artifex Labs${settings.calendarLink ? `\nBook a conversation: ${settings.calendarLink}` : ""}`;
  parts.push(sig);
  const footer = `${settings.businessAddress ?? ""}\nNot useful? ${unsubscribeUrl ?? "{{unsubscribe}}"} and I won't follow up.`.trim();
  parts.push(footer);
  return parts.join("\n\n");
}

/** Convenience: render an OutreachEmail to what actually gets sent. */
export function renderIntroEmail(input: RenderInput): { subject: string; html: string; text: string } {
  return { subject: input.email.subject, html: renderEmailHtml(input), text: renderEmailText(input) };
}
