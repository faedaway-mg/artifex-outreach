// ─────────────────────────────────────────────────────────────────────────────
// E-signature provider abstraction. The agreement workflow depends ONLY on this
// interface — never on SignWell directly — exactly like the email layer depends on
// EmailProvider rather than Resend.
//
// The default provider is a no-op that refuses to send. A live provider (SignWell)
// is returned only when SIGNWELL_API_KEY is set. Nothing here decides POLICY: the
// AGREEMENT_SENDING_ENABLED production gate is enforced by the actions layer before
// createSignatureRequest is ever called, so this file can be exercised freely in
// tests/mock mode without any risk of a real send.
// ─────────────────────────────────────────────────────────────────────────────
import { createSignwellProvider } from "./signwell";
import { shouldUseFakeEsignProvider, fakeEsignProvider } from "./fake-provider";

export interface EsignSigner {
  name: string;
  email: string;
}

/** One SignWell recipient. `order` maps to the text-tag signer number ({{signature:N}}). */
export interface EsignRecipient {
  id: "provider" | "client";
  role: "provider" | "client";
  name: string;
  email: string;
  order: number; // 1 = provider, 2 = client
}

export interface CreateSignatureRequestInput {
  agreementId: string;
  agreementNumber: string;
  pdfBase64: string; // the generated agreement PDF (with {{signature:N:y}} text-tag anchors)
  subject: string;
  message: string;
  signer: EsignSigner; // legacy single-signer (still used by the test rehearsal path)
  /** Two-signer model (provider order 1, client order 2). When present, takes precedence. */
  recipients?: EsignRecipient[];
  /** Disable automatic reminders (default true — no reminders unless explicitly enabled). */
  remindersDisabled?: boolean;
  ccEmail?: string | null; // Artifex counter-signer / cc
  testMode: boolean; // SignWell test mode (no legal weight, free) — used for rehearsal
  // Embedded signing: return a signing URL and DO NOT email the recipient
  // (per-recipient send_email defaults false when embedded_signing is on). Used for
  // the in-app / rehearsal signing flow. Default false = the emailed production flow.
  embedded?: boolean;
  metadata?: Record<string, string>;
}

export interface CreateSignatureRequestResult {
  ok: boolean;
  requestId: string | null; // SignWell document id
  signingUrl: string | null; // present when embedded/redirect signing is used
  error?: string;
  errorCode?: string;
}

export interface EsignProviderMeta {
  name: string;
  mode: "live" | "disabled";
  configured: boolean;
}

export interface EsignProvider {
  readonly name: string;
  readonly canSend: boolean;
  readonly meta: EsignProviderMeta;
  createSignatureRequest(input: CreateSignatureRequestInput): Promise<CreateSignatureRequestResult>;
  healthCheck(): Promise<{ ok: boolean; issues: string[]; latencyMs?: number }>;
}

const DISABLED_REASON = "E-signature sending is disabled (SIGNWELL_API_KEY not configured).";

export const disabledEsignProvider: EsignProvider = {
  name: "disabled",
  canSend: false,
  meta: { name: "disabled", mode: "disabled", configured: false },
  async createSignatureRequest() {
    return { ok: false, requestId: null, signingUrl: null, error: DISABLED_REASON, errorCode: "disabled" };
  },
  async healthCheck() {
    return { ok: false, issues: ["E-signature disabled — SIGNWELL_API_KEY not set."] };
  },
};

let cached: EsignProvider | null = null;
let cachedForKey: string | undefined;

/**
 * Live SignWell provider when the key is set; otherwise the disabled no-op. In a
 * dev/rehearsal runtime (never production) the guarded fake double may stand in so the
 * UI click-through can exercise sending without a real SignWell call — see
 * shouldUseFakeEsignProvider (requires ESIGN_FAKE_PROVIDER + non-prod + no live key).
 */
export function getEsignProvider(): EsignProvider {
  // Guarded dev/rehearsal double (never in production; never with a live key set).
  if (shouldUseFakeEsignProvider()) return fakeEsignProvider;
  const key = process.env.SIGNWELL_API_KEY;
  if (cached && cachedForKey === key) return cached;
  cachedForKey = key;
  cached = key ? createSignwellProvider() : disabledEsignProvider;
  return cached;
}

/** Test/hot-reload seam — drop the memoized provider so a changed env is re-read. */
export function resetEsignProvider(): void {
  cached = null;
  cachedForKey = undefined;
}
