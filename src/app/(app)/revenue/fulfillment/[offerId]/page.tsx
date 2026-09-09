import Link from "next/link";
import { notFound } from "next/navigation";
import { fulfillmentWorkspaceView } from "@/lib/quick-fix/operator-views";
import { FulfillmentWorkspace } from "@/components/quick-fix/FulfillmentWorkspace";

export const dynamic = "force-dynamic";

// OPERATOR technician workspace for ONE paid Quick-Fix job. Renders the canonical
// Fulfillment Packet (customer/scope + DO NOT TOUCH, platform-aware Access Center,
// execution runbook, QA/deploy, completion evidence) plus the PERSISTED sub-state so
// the operator resumes exactly on reload. Behind the (app) auth layout.
export default async function FulfillmentJobPage({ params }: { params: { offerId: string } }) {
  const view = await fulfillmentWorkspaceView(params.offerId);
  if (!view) notFound();
  return (
    <div className="space-y-3">
      <Link href="/revenue/fulfillment" className="mx-auto block max-w-3xl text-[12px] text-chalk-500 hover:text-chalk-300">← Fulfillment</Link>
      <FulfillmentWorkspace
        packet={view.packet}
        persisted={{
          platform: view.platform,
          runbookState: view.runbookState,
          qaState: view.qaState,
          accessState: view.accessState,
          evidence: view.evidence,
          gate: { ok: view.gate.ok, blockers: view.gate.blockers },
        }}
      />
    </div>
  );
}
