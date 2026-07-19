// ─────────────────────────────────────────────────────────────────────────────
// SignWell e-signature provider — live implementation behind getEsignProvider().
//
// Talks to the SignWell REST API over `fetch` (no SDK), same philosophy as the
// Resend provider: small bundle, full control over timeouts + error classification.
// Auth is the X-Api-Key header. Nothing sends unless SIGNWELL_API_KEY is set AND
// the actions layer has already passed the AGREEMENT_SENDING_ENABLED gate.
//
// Field placement uses SignWell TEXT TAGS: the agreement PDF embeds {{sig_client}},
// {{date_client}}, {{sig_artifex}}, {{date_artifex}} anchors (see AgreementDocument
// signature block). We ask SignWell to auto-detect them so signature/date fields
// land without manual coordinate math. SignWell emails the signer the request.
//
// Logs never include the API key, the PDF bytes, or signer PII beyond a redacted
// email domain.
// ─────────────────────────────────────────────────────────────────────────────
import type { CreateSignatureRequestInput, CreateSignatureRequestResult, EsignProvider, EsignStatusResult } from "./provider";

const API_BASE = process.env.SIGNWELL_API_BASE ?? "https://www.signwell.com";
const SEND_TIMEOUT_MS = Number(process.env.SIGNWELL_TIMEOUT_MS ?? 20_000);
const HEALTH_TIMEOUT_MS = 8_000;

function apiKey(): string {
  return process.env.SIGNWELL_API_KEY ?? "";
}

function redactEmail(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? `***@${email.slice(at + 1)}` : "***";
}

async function apiFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "X-Api-Key": apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface SignwellDocument {
  id?: string;
  status?: string;
  test_mode?: boolean;
  recipients?: Array<{ id?: string; email?: string; status?: string; embedded_signing_url?: string }>;
  files?: Array<{ name?: string; pdf_url?: string }>;
  // completion certificate / signed file locations vary by API version.
  completed_pdf_url?: string | null;
  audit_page_url?: string | null;
}

function classifyStatus(doc: SignwellDocument): { signed: boolean; declined: boolean } {
  const s = (doc.status ?? "").toLowerCase();
  const signed = s === "completed" || s === "signed";
  const declined = s === "declined" || s === "canceled" || s === "cancelled" || s === "voided";
  return { signed, declined };
}

export function createSignwellProvider(): EsignProvider {
  const configured = Boolean(apiKey());

  const provider: EsignProvider = {
    name: "signwell",
    canSend: configured,
    meta: { name: "signwell", mode: "live", configured },

    async createSignatureRequest(input: CreateSignatureRequestInput): Promise<CreateSignatureRequestResult> {
      if (!configured) return { ok: false, requestId: null, signingUrl: null, error: "SIGNWELL_API_KEY not set.", errorCode: "auth" };

      // SignWell "create document" payload. draft:false → sends immediately and
      // emails the signer. text_tags → detect {{sig_*}} anchors in the PDF.
      const recipients: Array<Record<string, unknown>> = [
        { id: "client", name: input.signer.name, email: input.signer.email, order: 1 },
      ];
      const body: Record<string, unknown> = {
        test_mode: input.testMode,
        draft: false,
        with_signature_page: false,
        embedded_signing: false,
        allow_decline: true,
        text_tags: true,
        name: `Artifex Labs — Professional Services Agreement ${input.agreementNumber}`,
        subject: input.subject,
        message: input.message,
        recipients,
        files: [{ name: `${input.agreementNumber}.pdf`, file_base64: input.pdfBase64 }],
        metadata: { agreementId: input.agreementId, agreementNumber: input.agreementNumber, ...(input.metadata ?? {}) },
        ...(input.ccEmail ? { cc_emails: [{ email: input.ccEmail }] } : {}),
      };

      try {
        const res = await apiFetch("/api/v1/documents/", { method: "POST", body: JSON.stringify(body) }, SEND_TIMEOUT_MS);
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).slice(0, 300);
          const code = res.status === 401 || res.status === 403 ? "auth" : res.status >= 500 ? "server" : "validation";
          console.error(`[signwell] create failed status=${res.status} code=${code} signer=${redactEmail(input.signer.email)}`);
          return { ok: false, requestId: null, signingUrl: null, error: `SignWell HTTP ${res.status}: ${text}`, errorCode: code };
        }
        const doc = (await res.json().catch(() => ({}))) as SignwellDocument;
        const signingUrl = doc.recipients?.find((r) => r.id === "client")?.embedded_signing_url ?? null;
        console.info(`[signwell] created document id=${doc.id ?? "?"} test_mode=${doc.test_mode} signer=${redactEmail(input.signer.email)}`);
        return { ok: true, requestId: doc.id ?? null, signingUrl };
      } catch (e) {
        const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
        console.error(`[signwell] create error code=${code}`);
        return { ok: false, requestId: null, signingUrl: null, error: (e as Error).message, errorCode: code };
      }
    },

    async getStatus(requestId: string): Promise<EsignStatusResult> {
      if (!configured) return { ok: false, status: null, signed: false, declined: false, signedPdfUrl: null, certificateUrl: null, error: "SIGNWELL_API_KEY not set." };
      try {
        const res = await apiFetch(`/api/v1/documents/${encodeURIComponent(requestId)}/`, { method: "GET" }, HEALTH_TIMEOUT_MS);
        if (!res.ok) return { ok: false, status: null, signed: false, declined: false, signedPdfUrl: null, certificateUrl: null, error: `SignWell HTTP ${res.status}` };
        const doc = (await res.json().catch(() => ({}))) as SignwellDocument;
        const { signed, declined } = classifyStatus(doc);
        return {
          ok: true,
          status: doc.status ?? null,
          signed,
          declined,
          signedPdfUrl: doc.completed_pdf_url ?? null,
          certificateUrl: doc.audit_page_url ?? null,
        };
      } catch (e) {
        return { ok: false, status: null, signed: false, declined: false, signedPdfUrl: null, certificateUrl: null, error: (e as Error).message };
      }
    },

    async healthCheck() {
      if (!configured) return { ok: false, issues: ["SIGNWELL_API_KEY is not set."] };
      const started = Date.now();
      try {
        const res = await apiFetch("/api/v1/me/", { method: "GET" }, HEALTH_TIMEOUT_MS);
        const latencyMs = Date.now() - started;
        if (res.status === 401 || res.status === 403) return { ok: false, issues: ["SignWell rejected the API key (auth)."], latencyMs };
        // Any non-auth response means the key reached SignWell and is usable.
        return { ok: true, issues: [], latencyMs };
      } catch (e) {
        const code = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
        return { ok: false, issues: [`SignWell unreachable (${code}): ${(e as Error).message}`], latencyMs: Date.now() - started };
      }
    },
  };

  return provider;
}
