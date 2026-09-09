"use client";
import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE STICKY CTA — value-before-price, honest at every scroll position.
//
// The bar has TWO states, switched by an IntersectionObserver on the PRICE section:
//   • BEFORE the price is on screen → it shows a scroll action ("See the fix ↓")
//     that smooth-scrolls to the repair / what's-included section. It NEVER shows the
//     price, NEVER accepts terms, and CANNOT initiate checkout — it only navigates.
//   • AT / AFTER the price section → it becomes "Get this fixed — <server price>" and
//     activates the REAL purchase flow by scrolling to the checkout island (where the
//     email + service-terms gate lives). It never bypasses that gate: the same email
//     and terms acceptance still governs the actual charge.
//
// Respects prefers-reduced-motion (smooth scroll only when motion is allowed). The bar
// only appears once the hero checkout has scrolled out of view, and its mobile safe-area
// padding keeps it clear of critical controls.
export function OfferStickyBar({
  priceLabel,
  turnaround,
  priceSectionId,
  repairSectionId,
  heroAnchorId = "offer-hero",
  checkoutId = "offer-buy",
}: {
  priceLabel: string;
  turnaround: string;
  /** IntersectionObserver anchor: the PriceReveal section. */
  priceSectionId: string;
  /** Pre-price scroll target: the repair / what's-included section. */
  repairSectionId: string;
  /** Visibility anchor: the bar appears once this (the hero) scrolls out of view. */
  heroAnchorId?: string;
  /** Post-price scroll target: the checkout island (email + terms gate). */
  checkoutId?: string;
}) {
  const [shown, setShown] = useState(false);
  // pastPrice = the price section top has reached/passed the viewport → reveal the
  // real purchase CTA. Until then the bar shows only a scroll action.
  const [pastPrice, setPastPrice] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(heroAnchorId);
    if (hero) {
      const io = new IntersectionObserver(
        ([e]) => setShown(!e.isIntersecting),
        { rootMargin: "-120px 0px 0px 0px" },
      );
      io.observe(hero);
      return () => io.disconnect();
    }
  }, [heroAnchorId]);

  useEffect(() => {
    const price = document.getElementById(priceSectionId);
    if (!price) return;
    // Once the top of the price section crosses ~70% down the viewport, the price is
    // effectively "revealed" and the CTA switches to the real purchase action.
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setPastPrice(true);
        else if (e.boundingClientRect.top > 0) setPastPrice(false); // scrolled back above it
      },
      { rootMargin: "0px 0px -30% 0px" },
    );
    io.observe(price);
    return () => io.disconnect();
  }, [priceSectionId]);

  function scrollTo(id: string, focusId?: string) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    if (focusId) {
      window.setTimeout(() => document.getElementById(focusId)?.focus(), reduce ? 0 : 420);
    }
  }

  // PRE-price: navigate to the fix. Never a checkout action.
  function seeTheFix() {
    scrollTo(repairSectionId);
  }
  // POST-price: jump to the checkout island and focus the terms gate — the real flow.
  function getFixed() {
    scrollTo(checkoutId, "accept-terms");
  }

  return (
    <div
      aria-hidden={!shown}
      className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="mx-auto max-w-2xl px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.6rem)] pt-2">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-950/85 px-4 py-3 shadow-glass-2 backdrop-blur-md">
          {pastPrice ? (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[15px] font-bold text-chalk-50">{priceLabel}</div>
                <div className="truncate text-[11.5px] text-chalk-400">{turnaround}</div>
              </div>
              <button onClick={getFixed} className="btn-primary shrink-0 !px-5 !py-2.5 !text-[14px]">
                Get this fixed — {priceLabel}
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[14px] font-semibold text-chalk-100">See what we&rsquo;ll fix</div>
                <div className="truncate text-[11.5px] text-chalk-400">Real evidence first, price after.</div>
              </div>
              <button
                onClick={seeTheFix}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-2.5 text-[14px] font-semibold text-chalk-50 hover:bg-white/[0.1]"
              >
                See the fix <ArrowDown size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
