import { notFound } from "next/navigation";
import { OfferPageView } from "@/components/quick-fix/OfferPageView";
import { buildPublicOfferView } from "@/lib/quick-fix/page-service";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC customer offer page. Reached with NO session — the unguessable share token
// (or the hash-derived offerId) in the URL is the capability. Only customer-safe
// fields are rendered. Building the page triggers no charge and no send.
export default async function OfferPage({ params }: { params: { offerId: string } }) {
  const view = await buildPublicOfferView(params.offerId);
  if (!view) notFound();

  // Record a measurable offer-page view (real event; never fabricated).
  await store.recordFunnelEvent("quickfix.offer_page_viewed", { offerId: view.offer.offerId });

  return <OfferPageView model={view.model} token={params.offerId} />;
}
