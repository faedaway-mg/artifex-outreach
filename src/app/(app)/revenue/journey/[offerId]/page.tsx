import Link from "next/link";
import { notFound } from "next/navigation";
import { journeyView } from "@/lib/quick-fix/operator-views";
import { CustomerJourneyPreview } from "@/components/revenue/CustomerJourneyPreview";

export const dynamic = "force-dynamic";

// FULL CUSTOMER JOURNEY PREVIEW (Part P) for ONE prepared offer. Behind the (app)
// auth layout — read-only: it stitches the EXACT frozen artifacts the customer/operator
// surfaces already render (email, PDF, offer page, evidence, personalized video, price,
// checkout) in real order. It performs NO send and NO charge; the checkout step is a
// preview only. The personalized diagnostic video is placed BEFORE the evergreen
// explainer, and the evergreen video is never substituted into the personalized slot.
export default async function JourneyPage({ params }: { params: { offerId: string } }) {
  const j = await journeyView(params.offerId);
  if (!j) notFound();
  return (
    <div className="space-y-3">
      <Link href={`/revenue/opportunity/${params.offerId}`} className="mx-auto block max-w-2xl px-4 text-[12px] text-chalk-500 hover:text-chalk-300">
        ← Opportunity
      </Link>
      <CustomerJourneyPreview j={j} />
    </div>
  );
}
