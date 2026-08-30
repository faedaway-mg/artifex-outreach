// ─────────────────────────────────────────────────────────────────────────────
// Owner-approval binding (Gate 4). An immutable, version-bound record capturing EXACTLY
// what the owner approved: parties, commercial terms, scope, agreement version, the
// unsigned PDF SHA-256, the recipient order/roles, and the signing + payment modes.
//
// A canonical digest of the binding is recomputed at send time and at webhook
// completion; ANY drift (price, deposit, scope, version, PDF hash, recipients, mode)
// is rejected. Approval is one-time and version-bound: a material change requires a new
// agreement version, a new PDF hash, and a fresh approval.
//
// PURE (crypto only) — no persistence here; the record is stored by the repo layer.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { Agreement } from "../types";
import type { EsignMode } from "../esign/mode";

export type StripeMode = "test" | "live";

export interface ApprovalRecipient {
  role: "provider" | "client";
  order: number;
  email: string;
}

/** The MATERIAL terms the owner approves. The digest is computed over exactly this. */
export interface ApprovalBinding {
  approvalRecordVersion: number; // schema version of this binding shape
  agreementId: string;
  agreementVersion: number;
  // Parties
  clientLegalName: string;
  clientBusinessName: string;
  clientEmail: string;
  providerLegalEntity: string;
  providerSignerEmail: string;
  // Terms
  scope: string[];
  deliverables: string[];
  totalPriceCents: number;
  depositAmountCents: number;
  remainingBalanceCents: number;
  currency: string;
  monthlyPartnershipCents: number | null;
  // Identity of the exact document
  unsignedPdfSha256: string;
  // Recipients (order + role + email) — sorted by order for determinism
  recipients: ApprovalRecipient[];
  // Modes
  esignMode: EsignMode;
  stripeMode: StripeMode;
  // Optional lifecycle
  expiresAt: string | null;
}

/** The full persisted approval record = binding + digest + provenance. */
export interface AgreementApproval {
  id: string;
  agreementId: string;
  agreementVersion: number;
  binding: ApprovalBinding;
  digest: string; // sha256 hex of the canonical binding
  approvedBy: string; // operator/owner identity
  approvedAt: string;
  revokedAt: string | null;
}

/** An explicit, separate owner authorization to take a LIVE payment (Gate 3/10). */
export interface LivePaymentAuthorization {
  id: string;
  agreementId: string;
  agreementVersion: number;
  approvalDigest: string | null;
  authorizedBy: string;
  authorizedAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export const APPROVAL_RECORD_VERSION = 1;

/** Deterministic JSON: object keys sorted recursively; arrays preserved in order. */
export function canonicalize(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) throw new Error("cycle in approval binding");
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = norm((v as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

/** sha256 hex of the canonical binding — the drift-detection fingerprint. */
export function approvalDigest(binding: ApprovalBinding): string {
  return createHash("sha256").update(canonicalize(binding)).digest("hex");
}

export interface BuildBindingOpts {
  providerSignerEmail: string;
  clientEmail: string; // may differ from snapshot (the actual verified signer contact)
  esignMode: EsignMode;
  stripeMode: StripeMode;
  unsignedPdfSha256: string;
  expiresAt?: string | null;
}

/**
 * Build the material binding from a frozen agreement snapshot + the resolved recipients
 * and modes. Provider is recipient order 1, client is order 2 (matches the SignWell
 * text-tag signer numbers {{signature:1}} / {{signature:2}}).
 */
export function buildApprovalBinding(agreement: Agreement, opts: BuildBindingOpts): ApprovalBinding {
  const c = agreement.contentSnapshot;
  return {
    approvalRecordVersion: APPROVAL_RECORD_VERSION,
    agreementId: agreement.id,
    agreementVersion: agreement.version,
    clientLegalName: c.clientLegalName,
    clientBusinessName: c.clientBusinessName,
    clientEmail: opts.clientEmail,
    providerLegalEntity: c.artifexLegalEntity,
    providerSignerEmail: opts.providerSignerEmail,
    scope: [...c.scope],
    deliverables: [...c.deliverables],
    totalPriceCents: c.totalPriceCents,
    depositAmountCents: c.depositAmountCents,
    remainingBalanceCents: c.remainingBalanceCents,
    currency: c.currency,
    monthlyPartnershipCents: c.monthlyPartnershipCents,
    unsignedPdfSha256: opts.unsignedPdfSha256,
    recipients: [
      { role: "provider", order: 1, email: opts.providerSignerEmail },
      { role: "client", order: 2, email: opts.clientEmail },
    ],
    esignMode: opts.esignMode,
    stripeMode: opts.stripeMode,
    expiresAt: opts.expiresAt ?? null,
  };
}

/**
 * Compare a freshly-built binding against the approved one; return a reason per drifted
 * field (empty ⇒ no drift). Uses the canonical digest for the fast path but always
 * itemizes so the operator sees exactly what changed.
 */
export function bindingDriftReasons(approved: ApprovalBinding, current: ApprovalBinding): string[] {
  const reasons: string[] = [];
  const cmp = (label: string, a: unknown, b: unknown) => {
    if (canonicalize(a) !== canonicalize(b)) reasons.push(`${label} changed`);
  };
  cmp("agreement version", approved.agreementVersion, current.agreementVersion);
  cmp("client legal name", approved.clientLegalName, current.clientLegalName);
  cmp("client business name", approved.clientBusinessName, current.clientBusinessName);
  cmp("client email", approved.clientEmail, current.clientEmail);
  cmp("provider legal entity", approved.providerLegalEntity, current.providerLegalEntity);
  cmp("provider signer email", approved.providerSignerEmail, current.providerSignerEmail);
  cmp("scope", approved.scope, current.scope);
  cmp("deliverables", approved.deliverables, current.deliverables);
  cmp("total price", approved.totalPriceCents, current.totalPriceCents);
  cmp("deposit amount", approved.depositAmountCents, current.depositAmountCents);
  cmp("remaining balance", approved.remainingBalanceCents, current.remainingBalanceCents);
  cmp("currency", approved.currency, current.currency);
  cmp("monthly partnership", approved.monthlyPartnershipCents, current.monthlyPartnershipCents);
  cmp("unsigned PDF sha256", approved.unsignedPdfSha256, current.unsignedPdfSha256);
  cmp("recipients", approved.recipients, current.recipients);
  cmp("esign mode", approved.esignMode, current.esignMode);
  cmp("stripe mode", approved.stripeMode, current.stripeMode);
  return reasons;
}

/** True when the approval is usable: not revoked, not expired, digest intact. */
export function approvalValidReasons(approval: AgreementApproval, nowIso: string): string[] {
  const reasons: string[] = [];
  if (approval.revokedAt) reasons.push("approval revoked");
  if (approval.binding.expiresAt && approval.binding.expiresAt <= nowIso) reasons.push("approval expired");
  if (approvalDigest(approval.binding) !== approval.digest) reasons.push("approval digest does not match its binding (tampered)");
  return reasons;
}
