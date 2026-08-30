// ─────────────────────────────────────────────────────────────────────────────
// SignWell completed-document retrieval (Gate 8). Implements the injectable
// CompletedDocumentFetcher used by the retention orchestrator. Production behavior
// requests the completed PDF; the audit-certificate variant appends audit_page=true.
//
// Safety: server-side API key only (never logged/exposed), exact document id, bounded
// timeout + bounded retries for safe pre-response failures, response-type validation
// (rejects empty / non-PDF), and it never logs document bytes.
//
// SignWell may return a SINGLE completed PDF that already contains the audit page. We do
// not fabricate a separate certificate file — `auditPageIncluded` records the truth.
// ─────────────────────────────────────────────────────────────────────────────
import type { CompletedDocumentFetcher, FetchedArtifact, ArtifactKind } from "../billing/retention";

const API_BASE = process.env.SIGNWELL_API_BASE ?? "https://www.signwell.com";
const DEFAULT_TIMEOUT_MS = Number(process.env.SIGNWELL_TIMEOUT_MS ?? 20_000);

export type FetchImpl = typeof fetch;

export class RetrievalError extends Error {
  readonly code: "auth" | "timeout" | "network" | "invalid" | "empty" | "not_found";
  constructor(message: string, code: RetrievalError["code"]) {
    super(message);
    this.name = "RetrievalError";
    this.code = code;
  }
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" magic.
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export interface SignwellFetcherOptions {
  apiKey?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Production fetcher. `signed_pdf` → the completed PDF; `audit_certificate` → the completed
 * PDF with the audit page (SignWell embeds the certificate). Returns the bytes; the
 * orchestrator hashes + stores them.
 */
export class SignwellCompletionFetcher implements CompletedDocumentFetcher {
  private readonly apiKey: string;
  private readonly doFetch: FetchImpl;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  /** Set true once we observe SignWell returning an audit-page-inclusive PDF. */
  public auditPageIncluded = false;

  constructor(opts: SignwellFetcherOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.SIGNWELL_API_KEY ?? "";
    this.doFetch = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  private async getJson(path: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${API_BASE}${path}`, { headers: { "X-Api-Key": this.apiKey }, signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) throw new RetrievalError("SignWell rejected the API key", "auth");
      if (res.status === 404) throw new RetrievalError("document not found", "not_found");
      if (!res.ok) throw new RetrievalError(`SignWell HTTP ${res.status}`, "network");
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async getBytes(url: string): Promise<Uint8Array> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new RetrievalError(`file HTTP ${res.status}`, "network");
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) throw new RetrievalError("empty document", "empty");
      if (!looksLikePdf(buf)) throw new RetrievalError("response is not a PDF", "invalid");
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetch(esignRequestId: string, kind: ArtifactKind): Promise<FetchedArtifact> {
    if (!this.apiKey) throw new RetrievalError("SIGNWELL_API_KEY not set", "auth");
    if (!esignRequestId) throw new RetrievalError("missing document id", "not_found");
    const auditPage = kind === "audit_certificate";
    const path = `/api/v1/documents/${encodeURIComponent(esignRequestId)}/completed_pdf/?url_only=true${auditPage ? "&audit_page=true" : ""}`;

    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const meta = await this.getJson(path);
        const fileUrl = meta?.file_url;
        if (!fileUrl || typeof fileUrl !== "string") throw new RetrievalError("no file_url in response", "invalid");
        const bytes = await this.getBytes(fileUrl);
        if (auditPage) this.auditPageIncluded = true;
        return { bytes, kind };
      } catch (e) {
        lastErr = e;
        const code = e instanceof RetrievalError ? e.code : "network";
        // Do NOT retry auth/not_found/invalid/empty — only transient network/timeout.
        if (code === "auth" || code === "not_found" || code === "invalid" || code === "empty") break;
        if (attempt > this.maxRetries) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new RetrievalError("retrieval failed", "network");
  }
}
