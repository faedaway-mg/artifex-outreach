import { notFound } from "next/navigation";
import { SuccessStatus } from "@/components/quick-fix/SuccessStatus";
import { paymentStatusView } from "@/lib/quick-fix/page-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Post-checkout landing. Reads CONFIRMED internal payment state only; the redirect
// itself never marks anything paid. Polls while the webhook may still be in flight.
export default async function OfferSuccessPage({ params }: { params: { offerId: string } }) {
  const view = await paymentStatusView(params.offerId);
  if (!view) notFound();
  return <SuccessStatus token={params.offerId} initial={view.status} initialNext={view.nextPath} />;
}
