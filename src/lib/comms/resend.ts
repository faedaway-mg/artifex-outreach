// ─────────────────────────────────────────────────────────────────────────────
// Resend email provider — the live implementation behind getEmailProvider().
//
// Deliberately talks to the Resend REST API over `fetch` (no SDK dependency): it
// keeps the bundle small, avoids pulling a Node-only client into any edge path,
// and gives us full control over timeouts and error classification. The
// acquisition engine never imports this file — only the communication layer.
//
// Every send classifies failures as transient (retryable) vs permanent so the
// scheduler / failure-recovery layer can back off vs. give up (Phase 9). We also
// forward our idempotencyKey as Resend's `Idempotency-Key` header for
// provider-side dedup, on top of our own DB-level send ledger (Phase 2).
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailMessage, EmailProvider, HealthResult, ProviderMeta, SendResult } from "./provider";

const API_BASE = process.env.RESEND_API_BASE ?? "https://api.resend.com";
const BATCH_LIMIT = 100; // Resend batch cap
const SEND_TIMEOUT_MS = Number(process.env.RESEND_TIMEOUT_MS ?? 15_000);
const HEALTH_TIMEOUT_MS = 8_000;

function fromDomainOf(from: string | undefined): string | null {
  if (!from) return null;
  const m = from.match(/@([^\s>]+)/);
  return m ? m[1].toLowerCase() : null;
}

interface ResendConfig {
  apiKey: string;
  defaultFrom: string | undefined;
}
function config(): ResendConfig {
  return { apiKey: process.env.RESEND_API_KEY ?? "", defaultFrom: process.env.RESEND_FROM };
}

// Classify an HTTP status into a SendResult failure shape.
function failureFor(status: number, body: string): SendResult {
  const base = { sent: false as const, providerMessageId: null, statusCode: status, reason: body.slice(0, 300) };
  if (status === 429) return { ...base, retryable: true, errorCode: "rate_limited" };
  if (status >= 500) return { ...base, retryable: true, errorCode: "server" };
  if (status === 401 || status === 403) return { ...base, retryable: false, errorCode: "auth" };
  if (status === 422 || status === 400) return { ...base, retryable: false, errorCode: "validation" };
  // Unknown 4xx → treat as permanent (don't hammer the provider).
  return { ...base, retryable: false, errorCode: "client" };
}

async function apiFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function body(msg: EmailMessage) {
  return {
    from: msg.from,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
  };
}

async function sendOne(cfg: ResendConfig, msg: EmailMessage): Promise<SendResult> {
  try {
    const res = await apiFetch(
      "/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          // Provider-side idempotency (belt & suspenders with our send ledger).
          "Idempotency-Key": msg.idempotencyKey,
        },
        body: JSON.stringify(body(msg)),
      },
      SEND_TIMEOUT_MS,
    );
    if (!res.ok) return failureFor(res.status, await res.text().catch(() => ""));
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, providerMessageId: json.id ?? null };
  } catch (e) {
    // Abort (timeout) or network failure → transient.
    const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
    return { sent: false, providerMessageId: null, retryable: true, errorCode: code, reason: (e as Error).message };
  }
}

export function createResendProvider(): EmailProvider {
  const cfg = config();
  const meta: ProviderMeta = {
    name: "resend",
    mode: "live",
    fromDomain: fromDomainOf(cfg.defaultFrom),
    batchLimit: BATCH_LIMIT,
    configured: Boolean(cfg.apiKey),
  };

  const provider: EmailProvider = {
    name: "resend",
    canSend: Boolean(cfg.apiKey),
    meta,

    async send(msg) {
      if (!cfg.apiKey) return { sent: false, providerMessageId: null, retryable: false, errorCode: "auth", reason: "RESEND_API_KEY not set." };
      return sendOne(cfg, msg);
    },
    async sendEmail(msg) {
      return provider.send(msg);
    },

    async sendBatch(msgs) {
      if (!msgs.length) return [];
      if (!cfg.apiKey) return msgs.map(() => ({ sent: false as const, providerMessageId: null, retryable: false, errorCode: "auth", reason: "RESEND_API_KEY not set." }));
      const out: SendResult[] = [];
      // Chunk to the provider batch cap.
      for (let i = 0; i < msgs.length; i += BATCH_LIMIT) {
        const chunk = msgs.slice(i, i + BATCH_LIMIT);
        try {
          const res = await apiFetch(
            "/emails/batch",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(chunk.map(body)),
            },
            SEND_TIMEOUT_MS,
          );
          if (!res.ok) {
            // Whole-chunk failure: apply the same classification to each message so
            // the caller can retry the transient ones.
            const f = failureFor(res.status, await res.text().catch(() => ""));
            for (let k = 0; k < chunk.length; k++) out.push({ ...f });
            continue;
          }
          const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
          const ids = json.data ?? [];
          for (let k = 0; k < chunk.length; k++) {
            out.push({ sent: true, providerMessageId: ids[k]?.id ?? null });
          }
        } catch (e) {
          const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
          for (let k = 0; k < chunk.length; k++) out.push({ sent: false, providerMessageId: null, retryable: true, errorCode: code, reason: (e as Error).message });
        }
      }
      return out;
    },

    async verifyConfiguration() {
      const issues: string[] = [];
      if (!cfg.apiKey) issues.push("RESEND_API_KEY is not set.");
      if (!cfg.defaultFrom) issues.push("RESEND_FROM (verified sender) is not set — sends must supply an explicit, verified From address.");
      return { ok: issues.length === 0, issues };
    },

    async healthCheck() {
      if (!cfg.apiKey) return { ok: false, issues: ["RESEND_API_KEY is not set."] };
      const started = Date.now();
      try {
        // Lightweight authenticated GET to confirm the key works + reachability.
        const res = await apiFetch("/domains", { method: "GET", headers: { Authorization: `Bearer ${cfg.apiKey}` } }, HEALTH_TIMEOUT_MS);
        const latencyMs = Date.now() - started;
        if (res.ok) return { ok: true, issues: [], latencyMs };
        if (res.status === 401 || res.status === 403) return { ok: false, issues: ["Resend rejected the API key (auth)."], latencyMs };
        return { ok: false, issues: [`Resend health check returned HTTP ${res.status}.`], latencyMs };
      } catch (e) {
        const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
        return { ok: false, issues: [`Resend unreachable (${code}): ${(e as Error).message}`], latencyMs: Date.now() - started };
      }
    },
  };

  return provider;
}
