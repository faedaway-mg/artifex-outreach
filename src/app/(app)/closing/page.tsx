// Server component: overview/list of all Client-Closing agreements. Auth is inherited
// from the (app) layout (redirects to /login). Each row is derived from the SAME
// authoritative ClosingWorkspaceView the detail page uses (via a compact row summary),
// so a row can never contradict /closing/[id]. Read-only.
import Link from "next/link";
import {
  allAgreements, getAgreementApproval, getLatestSendAuthorization, signedArtifactsForAgreement,
  hasLivePaymentAuthorization, invoicesForAgreement, paymentsForAgreement, auditForTarget,
} from "@/lib/repo";
import { resolveProviderSignerConfig } from "@/lib/esign/provider-config";
import {
  buildClosingWorkspaceView, summarizeWorkspaceRow, type ClosingRowSummary,
} from "@/lib/billing/closing-workspace-view";
import { nowIso } from "@/lib/store";
import { EmptyState } from "@/components/ui";
import { FileText, ShieldCheck, ShieldAlert, TestTube2, AlertTriangle, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

function envOn(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function money(cents: number, currency = "usd"): string {
  const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "USD" ? `$${v}` : `${v} ${currency.toUpperCase()}`;
}
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function loadRows(): Promise<{ rows: ClosingRowSummary[]; error: string | null }> {
  try {
    const agreements = await allAgreements();
    const providerConfigReady = resolveProviderSignerConfig(process.env, true).ok;
    const productionFlagsEnabled = envOn(process.env.PRODUCTION_SIGNING_ENABLED) && envOn(process.env.AGREEMENT_SENDING_ENABLED);
    const now = nowIso();

    const rows = await Promise.all(
      agreements.map(async (agreement) => {
        const [approval, sendAuth, signedArtifacts, livePaymentAuthorized, invoices, payments, audit] = await Promise.all([
          getAgreementApproval(agreement.id, agreement.version),
          getLatestSendAuthorization(agreement.id, agreement.version),
          signedArtifactsForAgreement(agreement.id),
          hasLivePaymentAuthorization(agreement.id),
          invoicesForAgreement(agreement.id),
          paymentsForAgreement(agreement.id),
          auditForTarget("agreement", agreement.id),
        ]);
        // No verified-client flag exists on the lead today; fail closed to unverified,
        // exactly as the detail page does.
        const view = buildClosingWorkspaceView({
          agreement, approval, sendAuth, signedArtifacts, livePaymentAuthorized, invoices, payments, audit,
          providerConfigReady, productionFlagsEnabled, clientVerified: false, nowIso: now,
        });
        return summarizeWorkspaceRow(view);
      }),
    );

    rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "Failed to load agreements." };
  }
}

export default async function ClosingOverviewPage() {
  const { rows, error } = await loadRows();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Closing</p>
        <h1 className="text-2xl font-semibold text-chalk-50">Client-closing agreements</h1>
        <p className="mt-1 text-sm text-chalk-400">
          Every agreement in the closing pipeline — its exact status, signer progress, retention, billing eligibility, and the one next action. Read-only overview.
        </p>
      </div>

      {error ? (
        <div className="card flex items-start gap-2 border border-coral-500/30 bg-coral-500/[0.06] p-4 text-sm text-coral-200" data-testid="closing-overview-error">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load agreements.</p>
            <p className="mt-0.5 text-coral-300/80 break-words">{error}</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No closing agreements yet." hint="Generated agreements appear here once a proposal advances to closing." />
      ) : (
        <div className="space-y-2" data-testid="closing-overview-list">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/closing/${r.id}`}
              className="card group block p-4 transition hover:border-white/[0.14]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                {/* Identity + parties */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-chalk-50">{r.client}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${r.mode === "production" ? "bg-coral-500/15 text-coral-200" : "bg-violet-500/15 text-violet-200"}`}>
                      <TestTube2 className="h-3 w-3" /> {r.mode === "production" ? "PRODUCTION" : "TEST"}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${r.legallyBinding ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.06] text-chalk-400"}`}>
                      {r.legallyBinding ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                      {r.legallyBinding ? "Legally binding" : "Not binding"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-chalk-500">
                    {r.number} · {money(r.totalCents, r.currency)} total · {money(r.depositCents, r.currency)} deposit
                  </p>
                </div>

                {/* Next action + time */}
                <div className="shrink-0 sm:text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Next action</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-chalk-100">
                    {r.nextAction} <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                  </p>
                  <p className="mt-0.5 text-[11px] text-chalk-500">Updated {fmtWhen(r.updatedAt)}</p>
                </div>
              </div>

              {/* Status chips — signer progress, retention, billing */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-chalk-400">
                <span>{r.overall}</span>
                <span>{r.completedSigners} of {r.requiredSigners} signers</span>
                <span>Retention: {r.retention}</span>
                <span className={r.eligibilityBlocked ? "text-amber-300/90" : "text-emerald-300/90"}>
                  Billing: {r.eligibility}
                </span>
                {!r.clientVerified && r.mode === "production" && (
                  <span className="inline-flex items-center gap-1 text-coral-300"><ShieldAlert className="h-3 w-3" /> Client unverified</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
