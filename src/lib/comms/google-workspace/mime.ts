// ─────────────────────────────────────────────────────────────────────────────
// MIME — build an RFC 2822 message and encode it base64url for the Gmail API
// `users.messages.send` raw field. Preserves From/To/Reply-To/Subject/custom
// headers (List-Unsubscribe, Message-ID, …), a text+html alternative body, and
// base64 attachments (e.g. the frozen Quick Review PDF). UTF-8 safe: non-ASCII
// header values are RFC 2047 encoded-words; bodies use base64 transfer-encoding.
// Pure + deterministic given an injected boundary seed (for tests).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";

export interface MimeAttachment {
  filename: string;
  /** base64-encoded content. */
  content: string;
  contentType?: string;
}

export interface MimeInput {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: MimeAttachment[];
  /** Deterministic boundary seed for tests; random when omitted. */
  boundarySeed?: string;
}

const CRLF = "\r\n";
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7F]/;

/** RFC 2047 encode a header value as a UTF-8 base64 encoded-word when it has non-ASCII. */
export function encodeHeaderValue(value: string): string {
  if (!NON_ASCII.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Wrap a base64 string to 76-char lines (RFC 2045). */
function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? [b64]).join(CRLF);
}

function b64Body(s: string): string {
  return wrap76(Buffer.from(s, "utf8").toString("base64"));
}

function boundary(seed: string | undefined, tag: string): string {
  const rand = seed ? `${seed}` : randomBytes(12).toString("hex");
  return `--artifex_${tag}_${rand}--`;
}

function textPart(b: string, text: string): string {
  return [`--${b}`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, "", b64Body(text)].join(CRLF);
}
function htmlPart(b: string, html: string): string {
  return [`--${b}`, `Content-Type: text/html; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, "", b64Body(html)].join(CRLF);
}
function attachmentPart(b: string, a: MimeAttachment): string {
  const ct = a.contentType ?? "application/octet-stream";
  return [
    `--${b}`,
    `Content-Type: ${ct}; name="${a.filename}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${a.filename}"`,
    "",
    wrap76(a.content.replace(/\s+/g, "")),
  ].join(CRLF);
}

/** Build the full MIME message text (headers + body). */
export function buildMimeMessage(input: MimeInput): string {
  const baseHeaders: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `MIME-Version: 1.0`,
  ];
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (/^(from|to|subject|mime-version|content-type|content-transfer-encoding)$/i.test(k)) continue; // never let a passthrough override structure
    baseHeaders.push(`${k}: ${NON_ASCII.test(v) ? encodeHeaderValue(v) : v}`);
  }

  const hasAttach = !!input.attachments?.length;
  const hasHtml = typeof input.html === "string" && input.html.length > 0;

  // alternative (text + html) body, optionally wrapped in mixed with attachments.
  const altB = boundary(input.boundarySeed, "alt");
  const altBody = hasHtml
    ? [textPart(altB, input.text), htmlPart(altB, input.html!), `--${altB}--`].join(CRLF)
    : null;

  if (hasAttach) {
    const mixB = boundary(input.boundarySeed ? `${input.boundarySeed}m` : undefined, "mix");
    const parts: string[] = [];
    if (altBody) {
      parts.push([`--${mixB}`, `Content-Type: multipart/alternative; boundary="${altB}"`, "", altBody].join(CRLF));
    } else {
      parts.push([`--${mixB}`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, "", b64Body(input.text)].join(CRLF));
    }
    for (const a of input.attachments!) parts.push(attachmentPart(mixB, a));
    parts.push(`--${mixB}--`);
    const headers = [...baseHeaders, `Content-Type: multipart/mixed; boundary="${mixB}"`].join(CRLF);
    return `${headers}${CRLF}${CRLF}${parts.join(CRLF)}${CRLF}`;
  }

  if (altBody) {
    const headers = [...baseHeaders, `Content-Type: multipart/alternative; boundary="${altB}"`].join(CRLF);
    return `${headers}${CRLF}${CRLF}${altBody}${CRLF}`;
  }

  // plain text only
  const headers = [...baseHeaders, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`].join(CRLF);
  return `${headers}${CRLF}${CRLF}${b64Body(input.text)}${CRLF}`;
}

/** Build the Gmail API `raw` value: base64url of the full MIME message. */
export function buildRawMessage(input: MimeInput): string {
  return Buffer.from(buildMimeMessage(input), "utf8").toString("base64url");
}
