"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, FileText, Download, CheckCircle2, Send, Ban, RefreshCw, ShieldAlert, CircleDollarSign, CalendarPlus, TestTube2 } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  acceptProposalAction,
  generateAgreementAction,
  regenerateAgreementAction,
  approveAgreementAction,
  sendAgreementForSignatureAction,
  voidAgreementAction,
  createNewAgreementVersionAction,
  sendDepositRequestAction,
  markDepositPaidAction,
  scheduleKickoffAction,
} from "@/lib/agreement-actions";
import type { Lead, Proposal, Agreement, Payment } from "@/lib/types";

function money(cents: number, currency = "usd"): string {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${v}` : `${v} ${currency.toUpperCase()}`;
}

const STATUS_LABEL: Record<Agreement["status"], string> = {
  draft: "Draft", generated: "Generated · review", approved: "Approved", sent: "Sent for signature",
  viewed: "Viewed by client", signed: "Signed", declined: "Declined", voided: "Voided",
};

export function AgreementPanel({
  lead, proposals, agreements, payments, sendingEnabled, esignConfigured, stripeConfigured,
}: {
  lead: Lead;
  proposals: Proposal[];
  agreements: Agreement[];
  payments: Payment[];
  sendingEnabled: boolean;
  esignConfigured: boolean;
  stripeConfigured: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [errors, setErrors] = useState<string[]>([]);
  const [showFields, setShowFields] = useState(false);

  const acceptedProposal = proposals.find((p) => p.status === "accepted") ?? null;
  const current = [...agreements].filter((a) => !a.supersededById).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
    ?? [...agreements].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
    ?? null;
  const deposit = payments.find((p) => p.type === "deposit" && current && p.agreementId === current.id) ?? null;

  async function runGenerate(fd: FormData) {
    if (!acceptedProposal) return;
    const res = await generateAgreementAction(lead.id, acceptedProposal.id, fd);
    if (!res.ok) setErrors(res.errors);
    else { setErrors([]); refresh(); }
  }
  async function runRegenerate(fd: FormData) {
    if (!current) return;
    const res = await regenerateAgreementAction(current.id, fd);
    if (!res.ok) setErrors(res.errors);
    else { setErrors([]); refresh(); }
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><FileSignature size={15} /> Agreement</h2>
        {current && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-chalk-300">{STATUS_LABEL[current.status]} · {current.agreementNumber} v{current.version}</span>}
      </div>

      {/* Legal-review + sending gate banner */}
      {!sendingEnabled && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200/90">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong>Live sending is OFF.</strong> The master agreement is a DRAFT and requires legal review. You can generate,
            preview, and download internally; sending to SignWell and deposit emails are blocked until{" "}
            <code>AGREEMENT_SENDING_ENABLED=true</code>{esignConfigured ? "" : " and SIGNWELL_API_KEY is set"}.
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 text-xs text-red-200/90">
          <p className="mb-1 font-semibold">Cannot generate — missing information:</p>
          <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {/* Step: accept a proposal first */}
      {!acceptedProposal && (
        <div>
          <p className="label mb-2">Proposal acceptance</p>
          {proposals.length === 0 && <p className="text-sm text-chalk-500">Record and accept a proposal before generating an agreement.</p>}
          <div className="space-y-2">
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-2.5 text-sm">
                <span className="text-chalk-300">{p.number ?? "Proposal"} · <span className="capitalize">{p.status}</span> · {money((p.amount ?? 0) * 100)}</span>
                {p.status !== "accepted" && p.status !== "declined" && (
                  <ActionButton variant="primary" onRun={() => acceptProposalAction(lead.id, p.id).then(refresh)}><CheckCircle2 size={14} /> Accept</ActionButton>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step: generate (no current agreement yet) */}
      {acceptedProposal && !current && (
        <form action={runGenerate} className="space-y-3">
          <p className="text-sm text-chalk-400">Accepted proposal <strong className="text-chalk-200">{acceptedProposal.number ?? acceptedProposal.id}</strong> · {money((acceptedProposal.amount ?? 0) * 100)}. Fields prefill from the lead, contact, brief, and proposal — adjust before generating.</p>
          <button type="button" onClick={() => setShowFields((v) => !v)} className="text-xs text-azure-300 underline">{showFields ? "Hide" : "Review / edit"} fields</button>
          {showFields && <AgreementFields />}
          <button type="submit" className="btn-primary"><FileText size={15} /> Generate agreement</button>
        </form>
      )}

      {/* Current agreement lifecycle */}
      {current && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <a href={`/api/agreement/${current.id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary"><FileText size={15} /> Preview PDF</a>
            <a href={`/api/agreement/${current.id}/pdf?download=1`} className="btn-ghost"><Download size={15} /> Download</a>
          </div>

          {/* Key terms readback */}
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.06] p-3 text-xs">
            <Term label="Client">{current.contentSnapshot.clientLegalName}</Term>
            <Term label="Signer">{current.signerName} · {current.signerEmail}</Term>
            <Term label="Proposal">{current.contentSnapshot.proposalNumber ?? current.proposalId} v{current.contentSnapshot.proposalVersion}</Term>
            <Term label="Total">{money(current.contentSnapshot.totalPriceCents, current.contentSnapshot.currency)}</Term>
            <Term label="Deposit">{money(current.contentSnapshot.depositAmountCents)} ({current.contentSnapshot.depositPercent}%)</Term>
            <Term label="Balance">{money(current.contentSnapshot.remainingBalanceCents)}</Term>
            <Term label="Timeline">{current.contentSnapshot.timeline}</Term>
            <Term label="Governing law">{current.contentSnapshot.governingLaw}</Term>
          </dl>

          {/* GENERATED → review/approve/regenerate */}
          {current.status === "generated" && (
            <div className="space-y-3 border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap gap-2">
                <ActionButton variant="primary" onRun={() => approveAgreementAction(current.id).then(refresh)} confirm="Approve and freeze this agreement? Fields will lock; material changes then require a new version.">
                  <CheckCircle2 size={15} /> Approve agreement
                </ActionButton>
                <ActionButton variant="danger" onRun={() => voidAgreementAction(current.id).then(refresh)}><Ban size={14} /> Void</ActionButton>
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-azure-300 underline">Edit &amp; regenerate before approval</summary>
                <form action={runRegenerate} className="mt-3 space-y-3"><AgreementFields snapshot={current} /><button type="submit" className="btn-secondary"><RefreshCw size={14} /> Regenerate</button></form>
              </details>
            </div>
          )}

          {/* APPROVED → send */}
          {current.status === "approved" && (
            <div className="space-y-2 border-t border-white/[0.06] pt-3">
              <ActionButton
                variant="primary"
                disabled={!sendingEnabled || !esignConfigured}
                onRun={() => sendAgreementForSignatureAction(current.id).then((r) => (r.ok ? refresh() : alert(r.error)))}
              >
                <Send size={15} /> Send through SignWell
              </ActionButton>
              {esignConfigured && (
                <ActionButton variant="ghost" onRun={() => sendAgreementForSignatureAction(current.id, { testMode: true }).then((r) => (r.ok ? refresh() : alert(r.error)))}>
                  <TestTube2 size={14} /> Send in SignWell test mode
                </ActionButton>
              )}
              {(!sendingEnabled || !esignConfigured) && (
                <p className="text-xs text-chalk-500">
                  {!esignConfigured ? "SignWell is not configured (SIGNWELL_API_KEY). " : ""}
                  {!sendingEnabled ? "Live sending is disabled (AGREEMENT_SENDING_ENABLED=false)." : ""}
                </p>
              )}
              <NewVersion current={current} onDone={refresh} />
            </div>
          )}

          {/* SENT / VIEWED → waiting */}
          {(current.status === "sent" || current.status === "viewed") && (
            <div className="space-y-2 border-t border-white/[0.06] pt-3 text-sm">
              <p className="text-chalk-300">Sent {current.sentAt ? new Date(current.sentAt).toLocaleString() : ""} · awaiting signature.</p>
              {current.status === "viewed" && <p className="text-azure-300">Client has viewed the agreement.</p>}
              {current.esignUrl && <a href={current.esignUrl} target="_blank" rel="noreferrer" className="text-xs text-azure-300 underline">Signing link</a>}
              <div className="flex gap-2"><ActionButton variant="danger" onRun={() => voidAgreementAction(current.id).then(refresh)}><Ban size={14} /> Void</ActionButton></div>
            </div>
          )}

          {/* SIGNED → deposit */}
          {current.status === "signed" && (
            <div className="space-y-3 border-t border-white/[0.06] pt-3">
              <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 size={15} /> Signed {current.signedAt ? new Date(current.signedAt).toLocaleDateString() : ""}.</p>
              <div className="flex flex-wrap gap-2">
                {current.signedPdfUrl && <a href={current.signedPdfUrl} target="_blank" rel="noreferrer" className="btn-secondary"><Download size={14} /> Signed agreement</a>}
                {current.certificateUrl && <a href={current.certificateUrl} target="_blank" rel="noreferrer" className="btn-ghost"><FileText size={14} /> Completion certificate</a>}
              </div>
              <DepositCard lead={lead} agreement={current} deposit={deposit} sendingEnabled={sendingEnabled} stripeConfigured={stripeConfigured} onDone={refresh} />
            </div>
          )}

          {(current.status === "declined" || current.status === "voided") && (
            <div className="border-t border-white/[0.06] pt-3">
              <p className="mb-2 text-sm text-chalk-400">This agreement is {current.status}. Create a new version to continue.</p>
              <NewVersion current={current} onDone={refresh} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-chalk-500">{label}</dt><dd className="text-chalk-200">{children}</dd></div>;
}

function NewVersion({ current, onDone }: { current: Agreement; onDone: () => void }) {
  async function run(fd: FormData) {
    const res = await createNewAgreementVersionAction(current.id, fd);
    if (res.ok) onDone(); else alert(res.errors.join("\n"));
  }
  return (
    <details>
      <summary className="cursor-pointer text-xs text-azure-300 underline">Create a new version (supersedes this one)</summary>
      <form action={run} className="mt-3 space-y-3"><AgreementFields snapshot={current} /><button type="submit" className="btn-secondary"><RefreshCw size={14} /> Create new version</button></form>
    </details>
  );
}

function DepositCard({
  lead, agreement, deposit, sendingEnabled, stripeConfigured, onDone,
}: {
  lead: Lead; agreement: Agreement; deposit: Payment | null; sendingEnabled: boolean; stripeConfigured: boolean; onDone: () => void;
}) {
  if (!deposit) return <p className="text-xs text-chalk-500">Deposit will unlock automatically once the signature is confirmed.</p>;
  async function sendDeposit(fd: FormData) {
    try { const r = await sendDepositRequestAction(deposit!.id, fd); if (r.ok) onDone(); else alert(r.error); }
    catch (e) { alert((e as Error).message); }
  }
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-chalk-200"><CircleDollarSign size={15} /> Deposit · {money(deposit.amountCents, deposit.currency)}</p>
      {deposit.status === "pending" && (
        <form action={sendDeposit} className="space-y-2">
          <label className="block"><span className="field-label">Stripe payment link {stripeConfigured ? "(optional — auto-created if blank)" : "(required — Stripe not configured)"}</span>
            <input name="paymentLinkUrl" placeholder="https://buy.stripe.com/…" className="input" /></label>
          <button type="submit" className="btn-primary" disabled={!sendingEnabled}><Send size={14} /> Send deposit request</button>
          {!sendingEnabled && <p className="text-xs text-chalk-500">Disabled — set AGREEMENT_SENDING_ENABLED=true to send.</p>}
        </form>
      )}
      {deposit.status === "link_sent" && (
        <div className="space-y-2 text-sm">
          <p className="text-chalk-300">Requested {deposit.sentAt ? new Date(deposit.sentAt).toLocaleString() : ""}.</p>
          {deposit.stripePaymentLinkUrl && <a href={deposit.stripePaymentLinkUrl} target="_blank" rel="noreferrer" className="text-xs text-azure-300 underline">Payment link</a>}
          <div><ActionButton variant="secondary" confirm="Mark this deposit paid manually? This is an audited fallback for payments confirmed outside Stripe." onRun={() => markDepositPaidAction(deposit.id).then(onDone)}><CheckCircle2 size={14} /> Mark paid (manual)</ActionButton></div>
        </div>
      )}
      {deposit.status === "paid" && (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 text-emerald-300"><CheckCircle2 size={15} /> Paid {deposit.paidAt ? new Date(deposit.paidAt).toLocaleDateString() : ""}.</p>
          <ActionButton variant="primary" onRun={() => scheduleKickoffAction(lead.id).then(onDone)}><CalendarPlus size={14} /> Schedule kickoff</ActionButton>
        </div>
      )}
    </div>
  );
}

// Prefill-friendly field set (all optional; blank = resolve from data).
function AgreementFields({ snapshot }: { snapshot?: Agreement }) {
  const c = snapshot?.contentSnapshot;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block"><span className="field-label">Signer name</span><input name="signerName" defaultValue={c?.clientContactName ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Signer email</span><input name="signerEmail" defaultValue={c?.clientEmail ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Client legal name</span><input name="clientLegalName" defaultValue={c?.clientLegalName ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Project name</span><input name="projectName" defaultValue={c?.projectName ?? ""} className="input" /></label>
      <label className="block sm:col-span-2"><span className="field-label">Project summary</span><textarea name="projectSummary" rows={2} defaultValue={c?.projectSummary ?? ""} className="input" /></label>
      <label className="block sm:col-span-2"><span className="field-label">Scope (one per line)</span><textarea name="scope" rows={3} defaultValue={c?.scope.join("\n") ?? ""} className="input" /></label>
      <label className="block sm:col-span-2"><span className="field-label">Deliverables (one per line)</span><textarea name="deliverables" rows={2} defaultValue={c?.deliverables.join("\n") ?? ""} className="input" /></label>
      <label className="block sm:col-span-2"><span className="field-label">Exclusions (one per line)</span><textarea name="exclusions" rows={2} defaultValue={c?.exclusions.join("\n") ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Timeline</span><input name="timeline" defaultValue={c?.timeline ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Start-date assumption</span><input name="startDateAssumption" defaultValue={c?.startDateAssumption ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Effective date</span><input name="effectiveDate" placeholder="e.g. 2026-08-01" defaultValue={c?.effectiveDate ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Deposit %</span><input name="depositPercent" type="number" defaultValue={c?.depositPercent ?? ""} className="input" /></label>
      <label className="block"><span className="field-label">Monthly partnership ($, optional)</span><input name="monthlyPartnership" type="number" defaultValue={c?.monthlyPartnershipCents != null ? c.monthlyPartnershipCents / 100 : ""} className="input" /></label>
    </div>
  );
}
