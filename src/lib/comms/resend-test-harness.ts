// ─────────────────────────────────────────────────────────────────────────────
// Shared test harness for the compliant cold-outreach transport. NOT imported by any app code
// (only *.test.ts import it), vitest-free.
//
// TRANSPORT SPLIT (mandate: Resend transactional-only, Google Workspace = cold lanes):
// cold prospect outreach now rides the GOOGLE WORKSPACE lanes, never Resend. So this harness
// configures a single FAKE Google lane (so the cold transport is "configured") AND keeps the
// Resend env present (Resend is still the transactional provider, and its webhook tests use it).
// `resendFetch()` returns ONE fetch double that speaks BOTH:
//   • the Google OAuth token endpoint + Gmail users.messages.send  (the cold path), and
//   • Resend's POST /emails                                        (the transactional path).
// The OAuth token round-trip is NOT counted as a "send" so `calls.send` / `calls.all` keep the
// exact same meaning as before (one increment per actual outbound message) and existing count
// assertions (`calls.all === 0`, `=== 1`, …) stay valid across the transport switch.
// ─────────────────────────────────────────────────────────────────────────────
import { _clearGoogleTokenCache } from "./google-workspace/gmail-transport";

/** The single FAKE Google Workspace cold lane the harness configures (obviously not a real domain). */
export const GMAIL_TEST_SENDER = "outreach-a@artifex-outreach-test.com";

/** Env the compliant cold path needs: the Google lane configured (OAuth app + one sender+token), a very
 *  high per-sender cap (so multi-send integration tests never hit the daily cap), the compliant footer
 *  assemblable, and prospect delivery enabled. Resend env is kept for the transactional path/webhooks. */
export const RESEND_TEST_ENV: Record<string, string> = {
  // Transactional provider (Resend is transactional-only now; kept present for those paths).
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "Artifex Labs <hello@artifexlabs.tech>",
  // Google Workspace prospect lane (the cold transport) — fake, non-secret values.
  GOOGLE_OAUTH_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "FAKE_CLIENT_SECRET_test",
  GOOGLE_WORKSPACE_SENDER_1: GMAIL_TEST_SENDER,
  GOOGLE_WORKSPACE_REFRESH_TOKEN_1: "FAKE_REFRESH_TOKEN_1",
  GOOGLE_SENDER_DAILY_CAP: "100000",
  // Compliance + delivery
  COMMS_POSTAL_ADDRESS: "Artifex Labs Systems LLC, 1 Market St, San Francisco, CA 94105",
  COMMS_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret",
  PUBLIC_BASE_URL: "https://app.artifexlabs.tech",
  COMMS_PROSPECT_DELIVERY_ENABLED: "1",
};

export function configureResendTestEnv(over: Record<string, string> = {}): void {
  Object.assign(process.env, RESEND_TEST_ENV, over);
  // Cold sends cache a Google access token in-memory by sender id; clear it so counts are deterministic.
  _clearGoogleTokenCache();
}
export function clearResendTestEnv(): void {
  for (const k of Object.keys(RESEND_TEST_ENV)) delete process.env[k];
  _clearGoogleTokenCache();
}

export interface ResendFetchCalls { send: number; all: number; bodies: string[] }

const isOAuthToken = (url: string) => /oauth2|\/token/.test(url);
const isGmailSend = (url: string) => /gmail/.test(url);

/**
 * A fetch double for the cold-outreach transport. `send(n)` returns the HTTP status for the n-th
 * OUTBOUND MESSAGE (1-based, default 200), or { throw: true } to simulate a network fault (→ ambiguous).
 *
 * It handles three endpoints:
 *   • Google OAuth token  → always 200 { access_token }, NOT counted (so send/all counts match the old
 *                           Resend semantics of one call per message).
 *   • Gmail messages.send → counted; success returns { id: "gmail-<n>" } (the Gmail message id).
 *   • Resend POST /emails → counted; success returns { id: "resend-<n>" } (the Resend message id).
 * The request body of each COUNTED call is recorded verbatim in `bodies` (use sentBody for Resend JSON,
 * sentMime to decode the Gmail raw MIME).
 */
export function resendFetch(opts: { send?: (n: number) => number | { throw: true } } = {}): { fn: typeof fetch; calls: ResendFetchCalls } {
  const calls: ResendFetchCalls = { send: 0, all: 0, bodies: [] };
  const status = opts.send ?? (() => 200);
  const fn = (async (url: any, init?: any) => {
    const u = String(url);
    // OAuth token exchange — a prerequisite of a Gmail send, never an outbound MESSAGE. Not counted.
    if (isOAuthToken(u)) {
      return { ok: true, status: 200, json: async () => ({ access_token: "AT_test", expires_in: 3600 }), text: async () => JSON.stringify({ access_token: "AT_test", expires_in: 3600 }) };
    }
    // An actual outbound message (Gmail send or Resend /emails).
    calls.all++;
    calls.send++;
    calls.bodies.push(typeof init?.body === "string" ? init.body : "");
    const r = status(calls.send);
    if (typeof r === "object" && "throw" in r) throw new Error("simulated network fault");
    const id = isGmailSend(u) ? `gmail-${calls.send}` : `resend-${calls.send}`;
    return { ok: r < 400, status: r, json: async () => ({ id }), text: async () => `status ${r}` };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Parse the JSON body of the n-th (1-based) Resend /emails POST — for the transactional path. */
export function sentBody(calls: ResendFetchCalls, n = 1): any {
  try { return JSON.parse(calls.bodies[n - 1] ?? "{}"); } catch { return {}; }
}

/** Decode the n-th (1-based) Gmail send into its raw MIME string — for asserting cold message HEADERS
 *  (From/To/Subject/Reply-To/List-Unsubscribe/attachment Content-Type). The Gmail body is
 *  `{ raw: base64url(MIME) }`; MIME headers are plaintext, so header assertions work directly. */
export function sentMime(calls: ResendFetchCalls, n = 1): string {
  try {
    const raw = JSON.parse(calls.bodies[n - 1] ?? "{}").raw as string;
    return raw ? Buffer.from(raw, "base64url").toString("utf8") : "";
  } catch { return ""; }
}

/** Decode the first MIME part whose Content-Type contains `contentType` (base64 transfer-encoded) back
 *  to UTF-8. The MIME body is base64-encoded, so it is not greppable raw. */
function decodeMimePart(mime: string, contentType: string): string {
  const idx = mime.indexOf(`Content-Type: ${contentType}`);
  if (idx < 0) return "";
  const afterHeaders = mime.indexOf("\r\n\r\n", idx);
  if (afterHeaders < 0) return "";
  const rest = mime.slice(afterHeaders + 4);
  const end = rest.indexOf("\r\n--"); // up to the next MIME boundary
  const b64 = (end >= 0 ? rest.slice(0, end) : rest).replace(/\s+/g, "");
  try { return Buffer.from(b64, "base64").toString("utf8"); } catch { return ""; }
}

/** Decode the text/plain part of the n-th (1-based) Gmail send — for asserting the visible BODY
 *  (compliant footer, postal, legal identity). */
export function sentMimeBody(calls: ResendFetchCalls, n = 1): string {
  return decodeMimePart(sentMime(calls, n), "text/plain");
}

/** Decode the text/html part of the n-th (1-based) Gmail send — for asserting the HTML body. */
export function sentMimeHtml(calls: ResendFetchCalls, n = 1): string {
  return decodeMimePart(sentMime(calls, n), "text/html");
}
