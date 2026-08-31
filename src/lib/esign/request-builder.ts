// ─────────────────────────────────────────────────────────────────────────────
// Shared SignWell request builder (Gate 3). The SINGLE source of the two-signer request
// shape — used by test drafts, the mock simulation, and the future production send. There
// is no separate untested production-only construction.
//
// Recipient order fixes the text-tag signer numbers: provider = 1 ({{signature:1:y}} /
// {{date:1:y}}), client = 2 ({{signature:2:y}} / {{date:2:y}}). The builder validates the
// recipients (distinct, present, correct roles) and reports every issue.
// ─────────────────────────────────────────────────────────────────────────────
import type { EsignRecipient } from "./provider";
import { signwellSigTag, signwellDateTag } from "../agreement/signature-fields";
import { normalizeEmail } from "../billing/recipient-policy";

export interface TwoSigner {
  provider: { name: string; email: string };
  client: { name: string; email: string };
}

/** Build the ordered recipient list: provider (1) then client (2). */
export function buildRecipients(two: TwoSigner): EsignRecipient[] {
  return [
    { id: "provider", role: "provider", name: two.provider.name, email: two.provider.email, order: 1 },
    { id: "client", role: "client", name: two.client.name, email: two.client.email, order: 2 },
  ];
}

/** The four required text-tag fields the PDF must carry for a two-signer document. */
export function expectedSignatureFields(): Array<{ recipient: "provider" | "client"; type: "signature" | "date"; tag: string }> {
  return [
    { recipient: "provider", type: "signature", tag: signwellSigTag(1) },
    { recipient: "provider", type: "date", tag: signwellDateTag(1) },
    { recipient: "client", type: "signature", tag: signwellSigTag(2) },
    { recipient: "client", type: "date", tag: signwellDateTag(2) },
  ];
}

export interface RecipientValidation {
  ok: boolean;
  issues: string[];
}

/** Structural validation of the recipient list (distinct, complete, correctly ordered). */
export function validateRecipients(recipients: EsignRecipient[]): RecipientValidation {
  const issues: string[] = [];
  const provider = recipients.find((r) => r.role === "provider");
  const client = recipients.find((r) => r.role === "client");
  if (!provider) issues.push("missing provider recipient");
  if (!client) issues.push("missing client recipient");
  if (provider && provider.order !== 1) issues.push("provider must be recipient order 1");
  if (client && client.order !== 2) issues.push("client must be recipient order 2");
  for (const r of recipients) if (!r.email) issues.push(`${r.role} recipient has no email`);
  if (provider && client && normalizeEmail(provider.email) === normalizeEmail(client.email)) {
    issues.push("provider and client emails must be distinct (SignWell rejects duplicates)");
  }
  return { ok: issues.length === 0, issues };
}

export interface SignwellRequestBody {
  test_mode: boolean;
  draft: boolean;
  with_signature_page: boolean;
  embedded_signing: boolean;
  allow_decline: boolean;
  text_tags: boolean;
  reminders: boolean;
  apply_signing_order: boolean;
  name: string;
  subject: string;
  message: string;
  recipients: Array<{ id: string; name: string; email: string; order: number }>;
  files: Array<{ name: string; file_base64: string }>;
  metadata: Record<string, string>;
  cc_emails?: Array<{ email: string }>;
}

export interface BuildBodyInput {
  agreementNumber: string;
  pdfBase64: string;
  subject: string;
  message: string;
  recipients: EsignRecipient[];
  testMode: boolean;
  draft?: boolean;
  remindersEnabled?: boolean;
  ccEmail?: string | null;
  metadata?: Record<string, string>;
}

/** Build the SignWell "create document" body from validated inputs. Pure. */
export function buildSignwellRequestBody(input: BuildBodyInput): SignwellRequestBody {
  const body: SignwellRequestBody = {
    test_mode: input.testMode,
    draft: input.draft ?? false,
    with_signature_page: false,
    embedded_signing: false, // hosted recipient signing (not iframe)
    allow_decline: true,
    text_tags: true,
    reminders: input.remindersEnabled ?? false, // no reminders unless explicitly enabled
    apply_signing_order: false, // parallel signing (documented)
    name: `Artifex Labs — Professional Services Agreement ${input.agreementNumber}`,
    subject: input.subject,
    message: input.message,
    recipients: input.recipients
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ id: r.id, name: r.name, email: r.email, order: r.order })),
    files: [{ name: `${input.agreementNumber}.pdf`, file_base64: input.pdfBase64 }],
    metadata: input.metadata ?? {},
  };
  if (input.ccEmail) body.cc_emails = [{ email: input.ccEmail }];
  return body;
}
