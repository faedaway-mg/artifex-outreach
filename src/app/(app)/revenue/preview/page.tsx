import Link from "next/link";
import { OfferPageView } from "@/components/quick-fix/OfferPageView";
import { buildPublicOfferView } from "@/lib/quick-fix/page-service";
import * as store from "@/lib/quick-fix/store";
import { composeOfferOutreach } from "@/lib/quick-fix/offer-outreach";
import { ARTIFEX_IDENTITY } from "@/lib/identity";

export const dynamic = "force-dynamic";

const FUNNEL = ["Outreach email", "Diagnostic asset", "Offer page", "Evergreen trust video", "Scope", "Requirements", "Terms", "Checkout", "Success", "Intake"];

// OPERATOR preview of the full customer journey. Clearly marked. Reads the same
// models the live pages render, but records NO funnel events, sends NO email, and
// triggers NO charge (the checkout island runs in preview=disabled mode).
export default async function PreviewPage({ searchParams }: { searchParams?: { offer?: string } }) {
  const offerId = searchParams?.offer;

  if (offerId) {
    const view = await buildPublicOfferView(offerId, { preview: true });
    if (!view) {
      return <div className="mx-auto max-w-2xl p-6 text-center text-[13px] text-chalk-400">Offer not found. <Link href="/revenue/preview" className="underline">Back to preview list</Link></div>;
    }
    const email = composeOfferOutreach(view.offer, { buyUrl: `/offer/${view.offer.shareToken}`, bookingUrl: ARTIFEX_IDENTITY.bookingUrl });
    return (
      <div>
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <Link href="/revenue/preview" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Preview list</Link>
          <div className="mt-3 card p-4">
            <div className="text-[11px] uppercase text-chalk-500">Funnel</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">{FUNNEL.map((f, i) => <span key={f} className="rounded-full bg-white/5 px-2 py-0.5 text-chalk-300">{i + 1}. {f}</span>)}</div>
          </div>
          <div className="mt-3 card p-4">
            <div className="text-[11px] uppercase text-chalk-500">Step 1 · Outreach email (preview — not sent)</div>
            <div className="mt-1.5 text-[13px] font-medium text-chalk-100">{email.subject}</div>
            <pre className="mt-1 whitespace-pre-wrap text-[12px] text-chalk-400">{email.bodyText}</pre>
            <div className="mt-1 text-[11px] text-chalk-500">primary CTA: {email.primaryCta} · fabrication-safe: {String(email.safe)}</div>
          </div>
        </div>
        <OfferPageView model={view.model} token={offerId} preview />
      </div>
    );
  }

  const offers = await store.listOffers();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/revenue" className="text-[12px] text-chalk-500 hover:text-chalk-300">← Quick-Fix Revenue</Link>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Preview as Customer</h1>
        <p className="mt-1 text-[13px] text-chalk-400">Walk the full funnel for any prepared offer. Marked preview — no email, no charge, no lifecycle mutation.</p>
      </div>
      {offers.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No prepared offers yet. Prepare one from <Link href="/revenue/quick-cash" className="underline">Quick-Cash</Link>.</div>
      ) : (
        <ul className="space-y-2">
          {offers.map((o) => (
            <li key={o.offerId} className="card flex items-center justify-between p-3.5">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-chalk-100">{o.companyName}</div>
                <div className="text-[11.5px] text-chalk-500">{o.scope.offerName} · {o.approvalStatus} · {o.quickFixEligible ? `$${Math.round(o.priceCents / 100)}` : "conversation"}</div>
              </div>
              <Link href={`/revenue/preview?offer=${o.offerId}`} className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-chalk-200 hover:bg-white/5">Preview →</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
