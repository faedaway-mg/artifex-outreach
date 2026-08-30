"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Client-Closing workspace (Gate 3 surface). Renders ONLY the server-derived
// ClosingWorkspaceView — the browser never recomputes legal/signing/payment truth.
// Consequential actions (approve, authorize send, send, authorize live payment) are
// visually distinct, never combined, and each carries its own exact confirmation.
// Authorization is enforced SERVER-SIDE; a hidden/disabled button is never the gate —
// a denied action returns a structured reason the operator can read.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  FileText, ShieldCheck, ShieldAlert, CheckCircle2, Clock, AlertTriangle, Download,
  TestTube2, Send, PenLine, CircleDollarSign, Archive, RotateCw, User, Building2, History,
} from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import type { ClosingWorkspaceView, SignerState } from "@/lib/billing/closing-workspace-view";
import type { EligibilityState } from "@/lib/billing/eligibility";
import {
  approveAction, authorizeSendAction, sendAction, authorizePaymentAction, retryRetentionAction,
} from "@/lib/agreement/closing-ui-actions";

const APPROVE_CONFIRM = "I approve this exact agreement, pricing, scope, recipients, and PDF for signing.";
const AUTHORIZE_SEND_CONFIRM = "Send this exact agreement for signature.";
const AUTHORIZE_PAYMENT_CONFIRM = "Authorize this exact live payment/invoice.";
// Readable send-authorization badge labels. A sent agreement is "Sent" (its one-time
// authorization was consumed) — never "none".
const SEND_AUTH_LABEL: Record<string, string> = {
  none: "Not authorized",
  active: "Authorized",
  consumed: "Sent",
  revoked: "Revoked",
  expired: "Expired",
  legacy: "Legacy (imported)",
};

function money(cents: number, currency = "usd"): string {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${v}` : `${v} ${currency.toUpperCase()}`;
}
function shortHash(h: string | null): string {
  if (!h) return "—";
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

// Clear operator language for every eligibility state — distinct BLOCKED_* are NEVER
// collapsed into one "Unavailable" label.
const ELIGIBILITY_LABEL: Record<EligibilityState, string> = {
  BLOCKED_TEST_AGREEMENT: "Test agreement — no live billing",
  BLOCKED_UNSIGNED: "Blocked — agreement not signed yet",
  BLOCKED_PARTIAL_SIGNATURE: "Blocked — not all signers complete",
  BLOCKED_APPROVAL_MISSING: "Blocked — no valid owner approval",
  BLOCKED_DOCUMENT_MISMATCH: "Blocked — document drifted from approval",
  BLOCKED_RECIPIENT_MISMATCH: "Blocked — recipients differ from approval",
  BLOCKED_RETENTION_PENDING: "Blocked — signed-PDF retention pending",
  BLOCKED_RETENTION_FAILED: "Blocked — signed-PDF retention failed",
  BLOCKED_MODE_MISMATCH: "Blocked — signing mode mismatch",
  BLOCKED_AMOUNT_MISMATCH: "Blocked — amount differs from approval",
  BLOCKED_LIFECYCLE: "Blocked — agreement cancelled/superseded",
  BLOCKED_LIVE_AUTH_MISSING: "Ready — awaiting live-payment authorization",
  ELIGIBLE_TEST_PAYMENT: "Eligible for a TEST payment only",
  ELIGIBLE_LIVE_PAYMENT: "Eligible for a LIVE payment",
  PAID: "Paid — deposit collected",
  CANCELLED: "Cancelled — not billable",
};

const SIGNER_LABEL: Record<SignerState, string> = {
  not_sent: "Not sent", sent: "Sent", viewed: "Viewed", signed: "Signed",
};
const SIGNER_STYLE: Record<SignerState, string> = {
  not_sent: "bg-neutral-100 text-neutral-600",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-amber-100 text-amber-800",
  signed: "bg-emerald-100 text-emerald-800",
};

const RETENTION_LABEL: Record<ClosingWorkspaceView["retention"]["status"], string> = {
  "not-required": "Not required", pending: "Pending", retrieving: "Retrieving", retained: "Retained", failed: "Failed",
};
const RETENTION_STYLE: Record<ClosingWorkspaceView["retention"]["status"], string> = {
  "not-required": "bg-neutral-100 text-neutral-600",
  pending: "bg-amber-100 text-amber-800",
  retrieving: "bg-blue-100 text-blue-800",
  retained: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function ActionFeedback({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <p className={`mt-2 flex items-start gap-1 text-xs ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
      {result.ok ? <CheckCircle2 className="mt-px h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
      <span className="break-words">{result.message}</span>
    </p>
  );
}

function Card({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">{icon} {title}</h3>
        {badge}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-900 break-all">{children}</p>
    </div>
  );
}

export function ClosingWorkspace({ view, agreementId }: { view: ClosingWorkspaceView; agreementId: string }) {
  const [approveRes, setApproveRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [authSendRes, setAuthSendRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [sendRes, setSendRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [payRes, setPayRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [retentionRes, setRetentionRes] = useState<{ ok: boolean; message: string } | null>(null);

  const { agreement, provider, client, terms, document: doc, signing, retention, billing, readiness, audit } = view;
  const isProduction = agreement.esignMode === "production";
  const productionSendOff = isProduction && !readiness.productionFlagsEnabled;
  const showLivePaymentAuth = billing.eligibility === "BLOCKED_LIVE_AUTH_MISSING";

  // ── Derived, state-authoritative flags — every section reads these so the UI can never
  //    contradict itself. A production agreement whose client is not verified is a hard
  //    blocked (error) state that disables all consequential actions.
  const clientUnverifiedBlock = isProduction && !client.verified;
  const isSigned = agreement.status === "signed";
  const isPartiallySigned = signing.overall === "Partially signed" || signing.completedSigners === 1;
  const isSent = !isSigned && !isPartiallySigned && (!!doc.esignRequestId || agreement.status === "sent" || agreement.status === "viewed");
  const sendState = doc.sendAuthorizationState;
  // Show the pre-approval action only before approval; once approved (or drifted) we show
  // status + receipt / re-review instead.
  const approvalDrifted = !readiness.approvalCurrent && !!doc.approvalId; // had an approval that is no longer current
  const showApproveAction = !clientUnverifiedBlock && !readiness.approvalCurrent && !isSent && !isPartiallySigned && !isSigned;
  // Send section: only meaningful before the document is sent, and never when blocked.
  const sendAuthGatesPass = !clientUnverifiedBlock && readiness.approvalCurrent && !productionSendOff;
  const showSendPhase = !isSent && !isPartiallySigned && !isSigned;
  const retentionFailed = retention.status === "failed";
  const retentionInProgress = retention.status === "pending" || retention.status === "retrieving";
  const showRetryRetention = retentionFailed && retention.retryAvailable && !clientUnverifiedBlock;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="closing-workspace">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
              <FileText className="h-5 w-5" /> Agreement {agreement.number}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-600">Version {agreement.version} · {signing.overall}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="mode-badge"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${isProduction ? "bg-red-100 text-red-800" : "bg-violet-100 text-violet-800"}`}
            >
              <TestTube2 className="h-3 w-3" /> {isProduction ? "PRODUCTION" : "TEST"}
            </span>
            <span
              data-testid="binding-label"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${agreement.legallyBinding ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}
            >
              {agreement.legallyBinding ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {agreement.legallyBinding ? "Legally binding" : "Not legally binding"}
            </span>
          </div>
        </div>
        {clientUnverifiedBlock && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3" data-testid="client-unverified-block">
            <p className="flex items-center gap-1 text-sm font-semibold text-red-900"><ShieldAlert className="h-4 w-4" /> Blocked — client identity not verified</p>
            <p className="mt-1 text-xs text-red-800 break-words">
              This is a production agreement, but the client&apos;s identity has not been verified. Approval, sending, and payment are disabled until the client is verified.
            </p>
          </div>
        )}
        {readiness.nextAction && (
          <div className={`mt-3 rounded-lg p-3 ${clientUnverifiedBlock ? "bg-red-50" : "bg-neutral-50"}`}>
            <p className={`text-[11px] font-medium uppercase tracking-wide ${clientUnverifiedBlock ? "text-red-700" : "text-neutral-500"}`}>Next action</p>
            <p className={`mt-0.5 text-sm font-medium ${clientUnverifiedBlock ? "text-red-900" : "text-neutral-900"}`} data-testid="next-action">{readiness.nextAction}</p>
            {readiness.blockedReason && !clientUnverifiedBlock && (
              <p className="mt-1 flex items-start gap-1 text-xs text-amber-700"><AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {readiness.blockedReason}</p>
            )}
          </div>
        )}
      </section>

      {/* ── Review ─────────────────────────────────────────────────────────── */}
      <Card title="Review" icon={<FileText className="h-4 w-4" />}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-700">Provider</p>
            <Field label="Legal entity">{provider.legalEntity}</Field>
            <Field label="Signer">{provider.signerName ?? "—"}</Field>
            <Field label="Signer email">{provider.signerEmail ?? "—"}</Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-700">Client</p>
            <Field label="Legal name">{client.legalName}</Field>
            <Field label="Business name">{client.businessName}</Field>
            <Field label="Signer">{client.signerName}</Field>
            <Field label="Signer email">{client.signerEmail}</Field>
            <p className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${client.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {client.verified ? "Client verified" : "Client not verified"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-neutral-700">Scope</p>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-neutral-800">
              {terms.scope.map((s, i) => <li key={i} className="break-words">{s}</li>)}
              {terms.scope.length === 0 && <li className="list-none text-neutral-500">—</li>}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-neutral-700">Deliverables</p>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-neutral-800">
              {terms.deliverables.map((d, i) => <li key={i} className="break-words">{d}</li>)}
              {terms.deliverables.length === 0 && <li className="list-none text-neutral-500">—</li>}
            </ul>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Total">{money(terms.totalCents, terms.currency)}</Field>
          <Field label="Deposit">{money(terms.depositCents, terms.currency)}</Field>
          <Field label="Remaining">{money(terms.remainingCents, terms.currency)}</Field>
          <Field label="Monthly">{terms.monthlyCents != null ? money(terms.monthlyCents, terms.currency) : "—"}</Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Unsigned PDF sha256">{shortHash(doc.unsignedPdfSha256)}</Field>
          <Field label="Approval digest">{shortHash(doc.approvalDigest)}</Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={`/api/agreements/${agreementId}/artifacts/unsigned`} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
            <Download className="h-4 w-4" /> Download unsigned PDF
          </a>
          {retention.signedPdf && (
            <a href={`/api/agreements/${agreementId}/artifacts/signed`} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
              <Download className="h-4 w-4" /> Download signed PDF
            </a>
          )}
          {retention.auditPageEmbedded && (
            <span className="text-xs text-neutral-500">Includes audit page</span>
          )}
          {doc.auditPage === "separate" && (
            <a href={`/api/agreements/${agreementId}/artifacts/certificate`} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
              <Download className="h-4 w-4" /> Download audit certificate
            </a>
          )}
        </div>
      </Card>

      {/* ── Approval ───────────────────────────────────────────────────────── */}
      <Card
        title="Approval"
        icon={<CheckCircle2 className="h-4 w-4" />}
        badge={
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${readiness.approvalCurrent ? "bg-emerald-100 text-emerald-800" : approvalDrifted ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"}`}>
            {readiness.approvalCurrent ? "Approved" : approvalDrifted ? "Invalidated" : "Not approved"}
          </span>
        }
      >
        {readiness.approvalCurrent ? (
          // Already approved — show the receipt (digest), NO active approve button.
          <div className="flex items-center gap-2 text-sm text-emerald-800" data-testid="approval-receipt">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="break-all">Approved · receipt digest {shortHash(doc.approvalDigest)}</span>
          </div>
        ) : approvalDrifted ? (
          // Approval was revoked/drifted — surface status + a re-review/re-approve action.
          <>
            <p className="flex items-start gap-1 text-sm text-amber-800" data-testid="approval-drifted">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
              {clientUnverifiedBlock
                ? "Invalidated — client/recipient drift. The client verification or recipients changed after approval, so the prior approval is no longer valid. The historical approval receipt remains in the audit timeline; a new approval is required (verify the client first)."
                : "The prior approval is no longer current (revoked or drifted). The historical receipt remains in the audit timeline; re-review and re-approve before sending."}
            </p>
            <div className="mt-3">
              <ActionButton
                variant="primary"
                disabled={clientUnverifiedBlock}
                confirm={APPROVE_CONFIRM}
                onRun={async () => setApproveRes(await approveAction(agreementId, { confirmed: true }))}
              >
                <CheckCircle2 className="h-4 w-4" /> Re-review &amp; approve
              </ActionButton>
              <p className="mt-1 text-[11px] text-neutral-500 break-words">Confirmation required: “{APPROVE_CONFIRM}”</p>
              <ActionFeedback result={approveRes} />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600">This exact agreement, pricing, scope, recipients, and PDF must be approved before it can be sent.</p>
            {showApproveAction && (
              <div className="mt-3">
                <ActionButton
                  variant="primary"
                  disabled={clientUnverifiedBlock}
                  confirm={APPROVE_CONFIRM}
                  onRun={async () => setApproveRes(await approveAction(agreementId, { confirmed: true }))}
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve for signing
                </ActionButton>
                <p className="mt-1 text-[11px] text-neutral-500 break-words">Confirmation required: “{APPROVE_CONFIRM}”</p>
                <ActionFeedback result={approveRes} />
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Send authorization ─────────────────────────────────────────────── */}
      <Card
        title="Send authorization"
        icon={<Send className="h-4 w-4" />}
        badge={
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${readiness.sendAuthorizationCurrent ? "bg-emerald-100 text-emerald-800" : doc.sendAuthorizationState === "consumed" ? "bg-blue-100 text-blue-800" : "bg-neutral-100 text-neutral-700"}`}>
            {SEND_AUTH_LABEL[doc.sendAuthorizationState] ?? doc.sendAuthorizationState}
          </span>
        }
      >
        {isPartiallySigned || isSent || isSigned ? (
          // The document has already been sent (or is complete). Send-auth copy derives
          // from the CONSUMED/complete state — never "Authorize sending first".
          <p className="flex items-start gap-1 text-sm text-neutral-700" data-testid="send-consumed">
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" /> Agreement has already been sent — no further send action is needed here.
          </p>
        ) : sendState === "revoked" ? (
          <p className="flex items-start gap-1 text-sm text-red-700" data-testid="send-revoked">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" /> Send authorization was revoked. Re-authorize sending to proceed.
          </p>
        ) : sendState === "expired" ? (
          <p className="flex items-start gap-1 text-sm text-amber-800" data-testid="send-expired">
            <Clock className="mt-px h-4 w-4 shrink-0" /> Send authorization has expired. Re-authorize sending to proceed.
          </p>
        ) : productionSendOff ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="production-sending-off">
            <p className="flex items-center gap-1 text-sm font-medium text-amber-900"><ShieldAlert className="h-4 w-4" /> Production sending is OFF</p>
            <p className="mt-1 text-xs text-amber-800 break-words">
              Live agreement sending is disabled. Set the production signing + sending flags (and complete legal review) to enable sending to clients.
            </p>
          </div>
        ) : showSendPhase ? (
          <>
            <p className="text-sm text-neutral-600">Authorizing sending is a separate step from sending. Both are shown distinctly and are never combined.</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
              {/* Step 1 — authorize send (secondary) */}
              <div className="flex-1">
                <ActionButton
                  variant="secondary"
                  disabled={!sendAuthGatesPass}
                  confirm={AUTHORIZE_SEND_CONFIRM}
                  onRun={async () => setAuthSendRes(await authorizeSendAction(agreementId))}
                >
                  <PenLine className="h-4 w-4" /> Authorize send
                </ActionButton>
                <p className="mt-1 text-[11px] text-neutral-500 break-words">Confirmation: “{AUTHORIZE_SEND_CONFIRM}”</p>
                <ActionFeedback result={authSendRes} />
              </div>
              {/* Step 2 — send (primary, distinct). Shown only when send is authorized. */}
              <div className="flex-1">
                {sendState === "active" && readiness.sendAuthorizationCurrent ? (
                  <>
                    <ActionButton
                      variant="primary"
                      disabled={!sendAuthGatesPass}
                      onRun={async () => setSendRes(await sendAction(agreementId))}
                    >
                      <Send className="h-4 w-4" /> Send agreement
                    </ActionButton>
                    <ActionFeedback result={sendRes} />
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-neutral-500" data-testid="authorize-sending-first">Authorize sending first.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-600">No send action is available in the current state.</p>
        )}
      </Card>

      {/* ── Signing progress ───────────────────────────────────────────────── */}
      <Card
        title="Signing progress"
        icon={<PenLine className="h-4 w-4" />}
        badge={
          <span data-testid="signing-overall" className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
            {signing.overall}
          </span>
        }
      >
        <div className="divide-y divide-neutral-100">
          <SignerRow icon={<Building2 className="h-4 w-4 text-neutral-500" />} label="Provider" state={signing.provider} />
          <SignerRow icon={<User className="h-4 w-4 text-neutral-500" />} label="Client" state={signing.client} />
        </div>
        <p className="mt-2 text-xs text-neutral-500" data-testid="signers-count">
          {signing.completedSigners} of {signing.requiredSigners} signers complete
        </p>
        {isPartiallySigned && (
          <p className="mt-1 flex items-start gap-1 text-xs text-amber-800" data-testid="awaiting-remaining-signer">
            <Clock className="mt-px h-3 w-3 shrink-0" /> Awaiting the remaining signer.
          </p>
        )}
      </Card>

      {/* ── Retention ──────────────────────────────────────────────────────── */}
      <Card
        title="Retention"
        icon={<Archive className="h-4 w-4" />}
        badge={
          <span data-testid="retention-status" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${RETENTION_STYLE[retention.status]}`}>
            {RETENTION_LABEL[retention.status]}
          </span>
        }
      >
        <div className="flex flex-wrap gap-2 text-xs">
          <Flag on={retention.signedPdf} label="Signed PDF" />
          <Flag on={retention.certificate} label="Audit certificate" />
          <Flag on={retention.auditPageEmbedded} label="Audit page embedded" />
        </div>
        {retentionInProgress && (
          <p className="mt-2 flex items-start gap-1 text-xs text-blue-700" data-testid="retention-in-progress">
            <Clock className="mt-px h-3 w-3 shrink-0" /> Retention in progress — no retry needed.
          </p>
        )}
        {retentionFailed && retention.failureReason && (
          <p className="mt-2 flex items-start gap-1 text-xs text-red-700" data-testid="retention-failure-reason"><AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {retention.failureReason}</p>
        )}
        {showRetryRetention && (
          <div className="mt-3">
            <ActionButton variant="secondary" onRun={async () => setRetentionRes(await retryRetentionAction(agreementId))}>
              <RotateCw className="h-4 w-4" /> Retry signed-document retention
            </ActionButton>
            <ActionFeedback result={retentionRes} />
          </div>
        )}
      </Card>

      {/* ── Billing eligibility ────────────────────────────────────────────── */}
      <Card
        title="Billing eligibility"
        icon={<CircleDollarSign className="h-4 w-4" />}
        badge={
          <span data-testid="stripe-mode" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${billing.stripeMode === "live" ? "bg-red-100 text-red-800" : "bg-violet-100 text-violet-800"}`}>
            Stripe {billing.stripeMode.toUpperCase()}
          </span>
        }
      >
        <p data-testid="eligibility-label" className="text-sm font-medium text-neutral-900">{ELIGIBILITY_LABEL[billing.eligibility]}</p>
        <p className="mt-0.5 text-xs text-neutral-600 break-words">{billing.blockedReason}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Amount">{money(billing.amountCents, billing.currency)}</Field>
          <Field label="Currency">{billing.currency.toUpperCase()}</Field>
        </div>
      </Card>

      {/* ── Live-payment authorization ─────────────────────────────────────── */}
      {showLivePaymentAuth && !clientUnverifiedBlock && (
        <Card title="Live-payment authorization" icon={<CircleDollarSign className="h-4 w-4" />}>
          <p className="text-sm text-neutral-600 break-words">
            Signing completion and retention do not authorize payment. This is a separate, explicit authorization for a LIVE payment.
          </p>
          <div className="mt-3">
            <ActionButton
              variant="danger"
              /* Accessible on the white card (the app's btn-danger is tuned for dark surfaces). */
              className="!border-red-300 !bg-red-50 !text-red-700 hover:!bg-red-100"
              confirm={AUTHORIZE_PAYMENT_CONFIRM}
              onRun={async () => setPayRes(await authorizePaymentAction(agreementId))}
            >
              <CircleDollarSign className="h-4 w-4" /> Authorize live payment
            </ActionButton>
            <p className="mt-1 text-[11px] text-neutral-500 break-words">Confirmation: “{AUTHORIZE_PAYMENT_CONFIRM}”</p>
            <ActionFeedback result={payRes} />
          </div>
        </Card>
      )}

      {/* ── Audit timeline ─────────────────────────────────────────────────── */}
      <Card title="Audit timeline" icon={<History className="h-4 w-4" />}>
        <ul className="divide-y divide-neutral-100">
          {audit.map((e, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 break-words">{e.action}</p>
                {e.meta && <p className="text-xs text-neutral-500 break-all">{e.meta}</p>}
              </div>
              <p className="shrink-0 text-xs text-neutral-500 break-all">{e.actor} · {e.at}</p>
            </li>
          ))}
          {audit.length === 0 && <li className="py-2 text-sm text-neutral-500">No audit entries yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function SignerRow({ icon, label, state }: { icon: React.ReactNode; label: string; state: SignerState }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="flex items-center gap-2 text-sm text-neutral-800">{icon} {label}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${SIGNER_STYLE[state]}`}>
        {SIGNER_LABEL[state]}
      </span>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${on ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"}`}>
      {on ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />} {label}
    </span>
  );
}
