// ─────────────────────────────────────────────────────────────────────────────
// GMAIL API TRANSPORT — one EmailProvider bound to a single approved Workspace
// sender. Exchanges that mailbox's refresh token for a short-lived access token
// (server-side, cached in memory only) and sends via users.messages.send with
// userId "me". Scope used: gmail.send only. No SMTP, no app passwords.
//
// SECRET SAFETY (non-negotiable): the refresh token, client secret, and access
// token are NEVER logged, serialized, returned, or embedded in an error/reason.
// Errors are sanitized to a status + a short Google error code before they leave
// this module. There is no exported helper that sends outside the canonical
// boundary — createGmailProvider is only consumed by submitCompliantDispatch.
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailMessage, EmailProvider, HealthResult, ProviderMeta, SendResult } from "../provider";
import type { SenderCredential } from "./sender-registry";
import { buildRawMessage } from "./mime";

const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SEND_TIMEOUT_MS = Number(process.env.GOOGLE_TIMEOUT_MS ?? 15_000);
const TOKEN_SKEW_MS = 60_000; // refresh a minute early

type FetchImpl = typeof fetch;

export interface GmailProviderDeps {
  fetchImpl?: FetchImpl;
  now?: () => number;
}

// In-memory access-token cache (NEVER persisted). Keyed by sender id.
const tokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

/** Test-only: clear the in-memory token cache. */
export function _clearGoogleTokenCache(): void {
  tokenCache.clear();
}

/** A pull-out of ONLY Google's non-secret error code (e.g. "invalid_grant"). Never
 *  echoes request bodies, tokens, or headers. */
function sanitizeGoogleError(status: number, rawBody: string): string {
  let code = "";
  try {
    const j = JSON.parse(rawBody);
    // token endpoint → {error, error_description}; gmail → {error:{status,message}}
    if (typeof j.error === "string") code = j.error;
    else if (j.error && typeof j.error.status === "string") code = j.error.status;
  } catch { /* body not json — ignore entirely */ }
  return code ? `google_error status=${status} code=${code}` : `google_error status=${status}`;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(timer); }
}

/** Exchange the sender's refresh token for a short-lived access token. Cached in
 *  memory until near expiry. Throws a SANITIZED error (never containing secrets). */
async function getAccessToken(cred: SenderCredential, deps: Required<GmailProviderDeps>): Promise<string> {
  const cached = tokenCache.get(cred.id);
  const now = deps.now();
  if (cached && cached.expiresAtMs - TOKEN_SKEW_MS > now) return cached.accessToken;

  const form = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    refresh_token: cred.refreshToken,
    grant_type: "refresh_token",
  });

  const res = await withTimeout(
    (signal) => deps.fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal }),
    SEND_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // sanitizeGoogleError parses only Google's own error CODE, never our request.
    throw new GoogleTransportError(sanitizeGoogleError(res.status, body), res.status, res.status === 401 || res.status === 403 || res.status === 400);
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GoogleTransportError("google_error status=200 code=no_access_token", 200, true);
  const expiresAtMs = now + (json.expires_in ? json.expires_in * 1000 : 3_000_000);
  tokenCache.set(cred.id, { accessToken: json.access_token, expiresAtMs });
  return json.access_token;
}

export class GoogleTransportError extends Error {
  constructor(message: string, public status: number, public permanent: boolean) {
    super(message); // message is already sanitized (no secrets)
    this.name = "GoogleTransportError";
  }
}

function classify(status: number): { retryable: boolean; errorCode: string } {
  if (status === 429) return { retryable: true, errorCode: "rate_limited" };
  if (status >= 500) return { retryable: true, errorCode: "server" };
  if (status === 401 || status === 403) return { retryable: false, errorCode: "auth" };
  if (status === 400 || status === 422) return { retryable: false, errorCode: "validation" };
  return { retryable: false, errorCode: "client" };
}

/** Create an EmailProvider that sends as exactly one approved Workspace mailbox. */
export function createGmailProvider(cred: SenderCredential, deps: GmailProviderDeps = {}): EmailProvider {
  const d: Required<GmailProviderDeps> = { fetchImpl: deps.fetchImpl ?? fetch, now: deps.now ?? Date.now };
  const meta: ProviderMeta = { name: "google-workspace", mode: "live", fromDomain: cred.address.split("@")[1]?.toLowerCase() ?? null, batchLimit: 1, configured: true };

  async function sendOne(msg: EmailMessage): Promise<SendResult> {
    try {
      const accessToken = await getAccessToken(cred, d);
      const raw = buildRawMessage({
        from: msg.from, to: msg.to, replyTo: msg.replyTo, subject: msg.subject,
        text: msg.text, html: msg.html, headers: msg.headers,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      const res = await withTimeout(
        (signal) => d.fetchImpl(GMAIL_SEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
          signal,
        }),
        SEND_TIMEOUT_MS,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const c = classify(res.status);
        return { sent: false, providerMessageId: null, statusCode: res.status, ...c, reason: sanitizeGoogleError(res.status, body) };
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string };
      return { sent: true, providerMessageId: json.id ?? null };
    } catch (e) {
      if (e instanceof GoogleTransportError) {
        const c = classify(e.status);
        return { sent: false, providerMessageId: null, statusCode: e.status, retryable: !e.permanent && c.retryable, errorCode: c.errorCode, reason: e.message };
      }
      const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
      // Never include the raw error message (could contain a URL with query) — fixed text.
      return { sent: false, providerMessageId: null, retryable: true, errorCode: code, reason: `google transport ${code}` };
    }
  }

  const provider: EmailProvider = {
    name: "google-workspace",
    canSend: true,
    meta,
    send: sendOne,
    sendEmail: sendOne,
    async sendBatch(msgs) { const out: SendResult[] = []; for (const m of msgs) out.push(await sendOne(m)); return out; },
    async verifyConfiguration() {
      const issues: string[] = [];
      if (!cred.clientId) issues.push("GOOGLE_OAUTH_CLIENT_ID missing");
      if (!cred.clientSecret) issues.push("GOOGLE_OAUTH_CLIENT_SECRET missing");
      if (!cred.refreshToken) issues.push(`refresh token missing for ${cred.id}`);
      return { ok: issues.length === 0, issues };
    },
    async healthCheck(): Promise<HealthResult> {
      const started = d.now();
      try { await getAccessToken(cred, d); return { ok: true, issues: [], latencyMs: d.now() - started }; }
      catch (e) { return { ok: false, issues: [e instanceof Error ? e.message : "google auth failed"], latencyMs: d.now() - started }; }
    },
  };
  return provider;
}
