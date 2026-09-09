import { notFound } from "next/navigation";
import { OfferPageView } from "@/components/quick-fix/OfferPageView";
import { buildPublicOfferView } from "@/lib/quick-fix/page-service";
import { buildEvidencePackage } from "@/lib/quick-fix/evidence-package";
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

  // Assemble the canonical evidence package (real screenshots/findings/asset refs)
  // and surface it on the page so PERSONALIZED PROOF leads the narrative. Read-only:
  // buildEvidencePackage never sends, charges, or writes. If evidence can't be built
  // (e.g. missing BI), the page still renders with its text fallback. Purely additive.
  let evidence = null;
  try {
    evidence = await buildEvidencePackage(view.offer);
  } catch {
    evidence = null;
  }
  const model = { ...view.model, evidenceAssets: evidence };

  return <OfferPageView model={model} token={params.offerId} />;
}
