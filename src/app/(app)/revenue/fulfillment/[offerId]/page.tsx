import Link from "next/link";
import { notFound } from "next/navigation";
import { fulfillmentPacketView } from "@/lib/quick-fix/operator-views";
import { FulfillmentWorkspace } from "@/components/quick-fix/FulfillmentWorkspace";

export const dynamic = "force-dynamic";

// OPERATOR technician workspace for ONE paid Quick-Fix job. Renders the canonical
// Fulfillment Packet (customer/scope + DO NOT TOUCH, platform-aware Access Center,
// execution runbook, QA/deploy, completion evidence) so the operator can fulfil the
// paid work without reconstructing the sale. Behind the (app) auth layout.
export default async function FulfillmentJobPage({ params }: { params: { offerId: string } }) {
  const packet = await fulfillmentPacketView(params.offerId);
  if (!packet) notFound();
  return (
    <div className="space-y-3">
      <Link href="/revenue/fulfillment" className="mx-auto block max-w-3xl text-[12px] text-chalk-500 hover:text-chalk-300">← Fulfillment</Link>
      <FulfillmentWorkspace packet={packet} />
    </div>
  );
}
