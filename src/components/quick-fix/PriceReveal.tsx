import { CircleDollarSign } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// PRICE REVEAL — the single, fixed, server-derived price.
//
// This is the value-before-price payoff: after the buyer has seen the real evidence,
// the plain-language repair, and the full included scope, ONE fixed price is revealed.
// The price string is derived from the server's offer.priceCents (via the model's
// priceLabel — never a hard-coded marketing number). One-time, no subscription; the
// turnaround and when-the-clock-starts are stated plainly.
//
// NO dark patterns: no countdown, no scarcity, no crossed-out "was" price, no fake
// savings. Salience is DELAYED (the price lives here, after the value) but never HIDDEN
// — it is shown in full BEFORE the purchase CTA that follows it, and before checkout.
// The `id` is the IntersectionObserver anchor the progressive sticky bar watches to
// flip from "See the fix ↓" to the real "Get this fixed — <price>" purchase action.
// ─────────────────────────────────────────────────────────────────────────────
export function PriceReveal({
  id,
  priceLabel,
  turnaround,
}: {
  id: string;
  priceLabel: string;
  turnaround: string;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-500">The price</p>
      <div className="mt-3 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6">
        <div className="flex items-start gap-3">
          <span className="mt-1 grid h-9 w-9 flex-none place-items-center rounded-xl bg-teal-400/12 text-teal-300">
            <CircleDollarSign size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] text-chalk-300">Everything above —</p>
            <p className="mt-0.5 text-[34px] font-extrabold leading-none tracking-tight text-chalk-50 md:text-[38px]">
              {priceLabel}
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-chalk-300">
              One-time payment. No subscription, no recurring charge for this fix.
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-chalk-300">
              {turnaround} The turnaround clock starts only after you provide the required
              access — never at purchase.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
