// Server component for the Client-Closing workspace. Loads persisted state from the
// repo, derives the authoritative ClosingWorkspaceView SERVER-SIDE, and renders the
// client workspace. Auth is inherited from the (app) layout (redirects to /login).
import { notFound } from "next/navigation";
import {
  getAgreement, getAgreementApproval, getLatestSendAuthorization, signedArtifactsForAgreement,
  hasLivePaymentAuthorization, invoicesForAgreement, paymentsForAgreement, auditForTarget,
} from "@/lib/repo";
import { buildClosingWorkspaceView } from "@/lib/billing/closing-workspace-view";
import { resolveProviderSignerConfig } from "@/lib/esign/provider-config";
import { ClosingWorkspace } from "@/components/closing/ClosingWorkspace";
import { nowIso } from "@/lib/store";

export const dynamic = "force-dynamic";

function envOn(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export default async function ClosingPage({ params }: { params: { id: string } }) {
  const agreement = await getAgreement(params.id);
  if (!agreement) notFound();

  const [approval, sendAuth, signedArtifacts, livePaymentAuthorized, invoices, payments, audit] = await Promise.all([
    getAgreementApproval(agreement.id, agreement.version),
    getLatestSendAuthorization(agreement.id, agreement.version),
    signedArtifactsForAgreement(agreement.id),
    hasLivePaymentAuthorization(agreement.id),
    invoicesForAgreement(agreement.id),
    paymentsForAgreement(agreement.id),
    auditForTarget("agreement", agreement.id),
  ]);

  const providerConfigReady = resolveProviderSignerConfig(process.env, true).ok;
  const productionFlagsEnabled = envOn(process.env.PRODUCTION_SIGNING_ENABLED) && envOn(process.env.AGREEMENT_SENDING_ENABLED);
  // No verified-client flag exists on the lead today; fail closed to unverified.
  const clientVerified = false;

  const view = buildClosingWorkspaceView({
    agreement, approval, sendAuth, signedArtifacts, livePaymentAuthorized, invoices, payments, audit,
    providerConfigReady, productionFlagsEnabled, clientVerified, nowIso: nowIso(),
  });

  return (
    <div className="p-4 sm:p-6">
      <ClosingWorkspace view={view} agreementId={agreement.id} />
    </div>
  );
}
