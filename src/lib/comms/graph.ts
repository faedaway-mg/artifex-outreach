// ─────────────────────────────────────────────────────────────────────────────
// Microsoft Graph transport — send as hello@artifexlabs.tech from the M365 mailbox Artifex already
// owns ($0). Behind the SAME provider-neutral EmailProvider interface as Resend; it NEVER falls back
// to another provider. Config-fail-closed (no creds → cannot send). App-only OAuth (client
// credentials); the app must be granted ONLY Mail.Send scoped to the one mailbox (Exchange Online RBAC
// for Applications) — this code requests `.default` and relies on that admin-consented scope.
//
// Safety by construction:
//   • TEST-RECIPIENT ALLOWLIST — until COMMS_PROSPECT_DELIVERY_ENABLED=1, mail may go ONLY to the
//     Artifex-controlled COMMS_TEST_RECIPIENT; every other recipient is refused IN the transport.
//   • 202 Accepted = SUBMISSION, not delivery (Graph returns no id on sendMail; we keep our
//     idempotency key as the reference and record submission).
//   • `fetch` is injectable so this is fully unit-testable with mocks — no network, no credentials.
// Secrets are read from server env only; never logged, never returned.
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailMessage, EmailProvider, HealthResult, ProviderMeta, SendResult } from "./provider";

const AUTHORITY = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 20000;

export interface GraphConfig { tenantId: string; clientId: string; clientSecret: string; sender: string; }
export function graphConfigFromEnv(): GraphConfig {
  return { tenantId: process.env.GRAPH_TENANT_ID ?? "", clientId: process.env.GRAPH_CLIENT_ID ?? "", clientSecret: process.env.GRAPH_CLIENT_SECRET ?? "", sender: process.env.GRAPH_SENDER ?? "" };
}
export function graphConfigured(c: GraphConfig = graphConfigFromEnv()): boolean {
  return !!(c.tenantId && c.clientId && c.clientSecret && c.sender);
}

/** Test-recipient allowlist. Default = TEST-ONLY: only the configured Artifex address may receive mail. */
export function allowedRecipient(to: string): { ok: boolean; reason?: string } {
  if (process.env.COMMS_PROSPECT_DELIVERY_ENABLED === "1") return { ok: true }; // owner-enabled prospect delivery
  const allow = (process.env.COMMS_TEST_RECIPIENT ?? "").toLowerCase().trim();
  if (allow && to.toLowerCase().trim() === allow) return { ok: true };
  return { ok: false, reason: "test-mode: recipient is not the configured Artifex test address" };
}

type FetchLike = (input: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

function failureFor(status: number, snippet: string): SendResult {
  const base = { sent: false as const, providerMessageId: null, statusCode: status, reason: snippet.slice(0, 300) };
  if (status === 429) return { ...base, retryable: true, errorCode: "rate_limited" };
  if (status >= 500) return { ...base, retryable: true, errorCode: "server" };
  if (status === 401 || status === 403) return { ...base, retryable: false, errorCode: "auth" };
  if (status === 400 || status === 422) return { ...base, retryable: false, errorCode: "validation" };
  return { ...base, retryable: false, errorCode: "client" };
}

async function getToken(c: GraphConfig, f: FetchLike): Promise<string> {
  const res = await f(`${AUTHORITY}/${c.tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
  });
  if (!res.ok) throw Object.assign(new Error(`graph auth ${res.status}`), { status: res.status });
  return (await res.json()).access_token as string;
}

/** JSON sendMail body. NOTE: Graph's JSON internetMessageHeaders only accepts x-* names, so
 *  List-Unsubscribe (non-x-) can't ride here — the visible body footer carries the opt-out; a
 *  List-Unsubscribe header would require MIME-format send (documented follow-up). */
export function graphMessage(msg: EmailMessage) {
  const headers = Object.entries(msg.headers ?? {}).filter(([k]) => k.toLowerCase().startsWith("x-")).map(([name, value]) => ({ name, value }));
  return {
    message: {
      subject: msg.subject,
      body: { contentType: msg.html ? "HTML" : "Text", content: msg.html ?? msg.text },
      toRecipients: [{ emailAddress: { address: msg.to } }],
      ...(msg.replyTo ? { replyTo: [{ emailAddress: { address: msg.replyTo } }] } : {}),
      ...(headers.length ? { internetMessageHeaders: headers } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType ?? "application/octet-stream", contentBytes: a.content })) } : {}),
    },
    saveToSentItems: true,
  };
}

async function sendVia(c: GraphConfig, f: FetchLike, msg: EmailMessage): Promise<SendResult> {
  const gate = allowedRecipient(msg.to);
  if (!gate.ok) return { sent: false, providerMessageId: null, retryable: false, errorCode: "test-mode", reason: gate.reason };
  try {
    const token = await getToken(c, f);
    const res = await f(`${GRAPH}/users/${encodeURIComponent(c.sender)}/sendMail`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(graphMessage(msg)),
    });
    if (res.status === 202) return { sent: true, providerMessageId: msg.idempotencyKey ?? null }; // submission, not delivery
    return failureFor(res.status, await res.text().catch(() => ""));
  } catch (e: any) {
    if (typeof e?.status === "number") return failureFor(e.status, e.message ?? "");
    return { sent: false, providerMessageId: null, retryable: true, errorCode: "network", reason: (e as Error).message };
  }
}

/** The Graph provider. `fetchImpl` is injectable for tests (defaults to a timeout-guarded global fetch). */
export function createGraphProvider(fetchImpl?: FetchLike): EmailProvider {
  const c = graphConfigFromEnv();
  const f: FetchLike = fetchImpl ?? (async (input, init) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try { return (await fetch(input, { ...init, signal: ctrl.signal })) as any; } finally { clearTimeout(t); }
  });
  const canSend = graphConfigured(c);
  const meta: ProviderMeta = { name: "microsoft-graph", mode: canSend ? "live" : "disabled", fromDomain: c.sender.split("@")[1]?.toLowerCase() ?? null, batchLimit: 1, configured: canSend };
  const send = (msg: EmailMessage) => canSend ? sendVia(c, f, msg) : Promise.resolve<SendResult>({ sent: false, providerMessageId: null, retryable: false, errorCode: "unconfigured", reason: "Microsoft Graph transport is not configured (GRAPH_* env missing)." });
  return {
    name: "microsoft-graph", canSend, meta,
    send, sendEmail: send,
    async sendBatch(msgs: EmailMessage[]) { const out: SendResult[] = []; for (const m of msgs) out.push(await send(m)); return out; },
    async verifyConfiguration() {
      if (!canSend) return { ok: false, issues: ["GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_SENDER must all be set."] };
      return { ok: true, issues: [] };
    },
    async healthCheck(): Promise<HealthResult> {
      if (!canSend) return { ok: false, issues: ["not configured"] };
      const start = Date.now();
      try { await getToken(c, f); return { ok: true, issues: [], latencyMs: Date.now() - start }; }
      catch (e) { return { ok: false, issues: [`token: ${(e as Error).message}`], latencyMs: Date.now() - start }; }
    },
  };
}
