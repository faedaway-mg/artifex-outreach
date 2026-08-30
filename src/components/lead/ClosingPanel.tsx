"use client";
// Operator closing surface. Renders the server-computed closing view-model and the
// gated actions. Buttons that move money externally are visually distinct from
// draft-preparation, a test-mode badge is always shown, and authorization is
// enforced server-side (a denied action returns a reason; the button is not the gate).
import { CircleDollarSign, FileText, CheckCircle2, Clock, AlertTriangle, ShieldAlert, TestTube2, ExternalLink, Receipt } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  prepareMilestoneInvoiceAction,
  issueMilestoneInvoiceAction,
  recordMilestoneAcceptanceAction,
} from "@/lib/billing/closing-actions";
import type { ClosingView, ScheduleRow } from "@/lib/billing/closing-view";

function money(cents: number, currency = "usd"): string {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${v}` : `${v} ${currency.toUpperCase()}`;
}

const STATE_STYLE: Record<string, string> = {
  "not-created": "bg-neutral-100 text-neutral-600",
  "paid-via-checkout": "bg-emerald-100 text-emerald-800",
  draft: "bg-amber-100 text-amber-800",
  issued: "bg-blue-100 text-blue-800",
  processing: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  void: "bg-neutral-200 text-neutral-600",
  refunded: "bg-orange-100 text-orange-800",
  partially_refunded: "bg-orange-100 text-orange-800",
  disputed: "bg-red-100 text-red-800",
  uncollectible: "bg-red-100 text-red-800",
};

export function ClosingPanel({ view, agreementId }: { view: ClosingView; agreementId: string }) {
  const { entity, agreement, schedule, money: m, retainer, mode, nextAction, payoutCaveat } = view;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5" data-testid="closing-panel">
      {/* Header: entity + version + mode */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <CircleDollarSign className="h-4 w-4" /> Closing &amp; billing
          </h3>
          <p className="mt-0.5 text-sm text-neutral-600">
            Issued by <span className="font-medium text-neutral-900">{entity.legalEntity}</span> · {agreement.number} v{agreement.version}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${mode === "live" ? "bg-red-100 text-red-800" : "bg-violet-100 text-violet-800"}`}>
          <TestTube2 className="h-3 w-3" /> {mode === "live" ? "LIVE MODE" : "TEST MODE"}
        </span>
      </div>

      {/* Next action */}
      <div className="mt-3 rounded-lg bg-neutral-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Next action</p>
        <p className="mt-0.5 flex items-center gap-2 text-sm font-medium text-neutral-900">
          {nextAction.kind === "await-external" ? <Clock className="h-4 w-4 text-blue-600" /> :
           nextAction.kind === "move-money" ? <CircleDollarSign className="h-4 w-4 text-emerald-600" /> :
           nextAction.kind === "none" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
           <FileText className="h-4 w-4 text-neutral-500" />}
          {nextAction.label}
        </p>
        {nextAction.blockerReason && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> {nextAction.blockerReason}</p>
        )}
      </div>

      {/* Signature gate */}
      {!agreement.signed && (
        <p className="mt-3 flex items-center gap-1 text-sm text-amber-700"><ShieldAlert className="h-4 w-4" /> Agreement not signed yet — billing is locked until signature.</p>
      )}

      {/* Schedule */}
      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Payment schedule</p>
        <ul className="mt-2 divide-y divide-neutral-100">
          {schedule.map((row) => (
            <MilestoneRow key={row.key} row={row} agreementId={agreementId} signed={agreement.signed} />
          ))}
          {schedule.length === 0 && <li className="py-2 text-sm text-neutral-500">No billable schedule on this agreement.</li>}
        </ul>
      </div>

      {/* Money view — collected vs refunds vs chargebacks vs open disputes (all distinct) */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Invoiced" value={money(m.invoicedCents, m.currency)} />
        <Stat label="Collected (net)" value={money(m.collectedCents, m.currency)} tone="emerald" />
        <Stat label="Outstanding" value={money(m.outstandingCents, m.currency)} />
        <Stat label="Refunded" value={money(m.refundedCents, m.currency)} tone={m.refundedCents ? "orange" : undefined} />
      </div>
      {(m.chargebackLostCents > 0 || m.disputedOpenCents > 0) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Chargebacks lost" value={money(m.chargebackLostCents, m.currency)} tone={m.chargebackLostCents ? "red" : undefined} />
          <Stat label="Disputes open" value={money(m.disputedOpenCents, m.currency)} tone={m.disputedOpenCents ? "red" : undefined} />
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Stat label="Payout to Relay" value="Unverified" tone="muted" />
        <Stat label="Bank receipt" value="Unverified" tone="muted" />
      </div>
      <p className="mt-1 text-xs text-neutral-500">{payoutCaveat}</p>

      {/* Retainer */}
      {retainer.present && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1 text-sm font-medium text-amber-900"><AlertTriangle className="h-4 w-4" /> Monthly retainer — activation blocked</p>
          <p className="mt-1 text-xs text-amber-800">{money(retainer.monthlyAmountCents ?? 0, retainer.currency)}/mo noted, but terms are undefined. Needed: {retainer.missingDecisions.join("; ")}.</p>
        </div>
      )}
    </section>
  );
}

function MilestoneRow({ row, agreementId, signed }: { row: ScheduleRow; agreementId: string; signed: boolean }) {
  const badge = <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[row.invoiceState] ?? "bg-neutral-100 text-neutral-600"}`}>{row.invoiceState.replace(/_/g, " ")}</span>;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900">
          {row.label}{badge}
          {row.amountRefundedCents > 0 && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">refunded {money(row.amountRefundedCents)}</span>}
          {row.disputeStatus !== "none" && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${row.disputeStatus === "lost" ? "bg-red-100 text-red-800" : row.disputeStatus === "won" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>dispute {row.disputeStatus}</span>}
        </p>
        <p className="text-xs text-neutral-500">{money(row.amountCents)} · {row.trigger.replace(/_/g, " ")}</p>
      </div>
      <div className="flex items-center gap-2">
        {row.hostedInvoiceUrl && (
          <a href={row.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
            <ExternalLink className="h-3 w-3" /> Hosted invoice
          </a>
        )}
        {signed && row.invoiceState === "not-created" && row.eligible && (
          <ActionButton onRun={async () => { await prepareMilestoneInvoiceAction(agreementId, row.key); }} className="btn-secondary text-xs">
            <FileText className="h-3 w-3" /> Prepare invoice (draft)
          </ActionButton>
        )}
        {signed && row.invoiceState === "not-created" && !row.eligible && row.key !== "deposit" && (
          <ActionButton onRun={async () => { await recordMilestoneAcceptanceAction(agreementId, row.key); }} className="btn-secondary text-xs">
            <CheckCircle2 className="h-3 w-3" /> Record acceptance
          </ActionButton>
        )}
        {row.invoiceState === "draft" && row.invoiceId && (
          <ActionButton onRun={async () => { await issueMilestoneInvoiceAction(row.invoiceId!); }} className="btn-primary text-xs" confirm="Issue this invoice at the provider (TEST mode)?">
            <Receipt className="h-3 w-3" /> Issue invoice · test
          </ActionButton>
        )}
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "orange" | "red" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "orange" ? "text-orange-700" : tone === "red" ? "text-red-700" : tone === "muted" ? "text-neutral-400" : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
