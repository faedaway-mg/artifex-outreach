import { notFound } from "next/navigation";
import { IntakeForm } from "@/components/quick-fix/IntakeForm";
import { buildIntakeView } from "@/lib/quick-fix/page-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NECESSITY_LABEL: Record<string, string> = { REQUIRED_BEFORE_START: "Required", OPTIONAL: "Optional", ONLY_IF_NEEDED: "If needed" };

// Post-purchase secure intake. Shown only for a paid job. Never asks for a password.
export default async function OfferIntakePage({ params }: { params: { offerId: string } }) {
  const view = await buildIntakeView(params.offerId);
  if (!view) notFound();

  if (!view.paid) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-[22px] font-semibold text-chalk-50">No order found yet</h1>
        <p className="mt-2 text-[14px] text-chalk-300">Once your payment is confirmed, your setup checklist will appear here.</p>
        <a href={`/offer/${params.offerId}`} className="mt-6 inline-flex rounded-xl border border-white/15 px-5 py-3 text-[14px] text-chalk-200 hover:bg-white/5">Back to the offer</a>
      </div>
    );
  }

  const { offer, requirements } = view;
  const blocking = requirements.items.filter((i) => i.necessity === "REQUIRED_BEFORE_START");
  const optional = requirements.items.filter((i) => i.necessity !== "REQUIRED_BEFORE_START");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-azure-300">Your order</p>
      <h1 className="mt-1 text-[24px] font-semibold text-chalk-50">{offer.scope.offerName}</h1>
      <p className="mt-1.5 text-[14px] text-chalk-300">{offer.scope.problemBeingSolved}</p>

      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-chalk-500">Scope</h2>
        <ul className="mt-2 space-y-1.5 text-[13.5px] text-chalk-200">{offer.scope.includedItems.map((f, i) => <li key={i} className="flex gap-2"><span className="text-teal-300">✓</span>{f}</li>)}</ul>
      </section>

      <section className="mt-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-chalk-500">What we need to begin</h2>
        <p className="mt-1 text-[12.5px] text-chalk-500">Grant access using your platform's native invite. We never ask for your password.</p>
        <div className="mt-3">
          <IntakeForm token={params.offerId} items={requirements.items} alreadyStarted={view.clockStarted} initialTargetDelivery={view.targetDeliveryAt} />
        </div>
      </section>

      {optional.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-chalk-500">Optional / only if needed</h2>
          <ul className="mt-2 space-y-2">
            {optional.map((i) => (
              <li key={i.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] text-chalk-200">{i.label}</span>
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-chalk-400">{NECESSITY_LABEL[i.necessity]}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-center text-[12px] text-chalk-500">Blocking items: {blocking.length}. The turnaround starts once these are satisfied.</p>
    </div>
  );
}
