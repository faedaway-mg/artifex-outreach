"use client";
import { useEffect, useState } from "react";

// A subtle sticky purchase bar that appears once the hero CTA scrolls out of view.
// It never bypasses acceptance: clicking it scrolls to the checkout and focuses the
// terms checkbox, so the same email + terms gate still governs the actual purchase.
// Respects prefers-reduced-motion (smooth scroll only when motion is allowed).
export function OfferStickyBar({ priceLabel, turnaround }: { priceLabel: string; turnaround: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("offer-buy");
    if (!hero) return;
    // Show the bar only while the hero checkout is NOT visible (i.e. scrolled past).
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting), { rootMargin: "-120px 0px 0px 0px" });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  function jump() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = document.getElementById("offer-buy");
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    // Focus the acceptance checkbox so the customer lands on the gate, not past it.
    window.setTimeout(() => document.getElementById("accept-terms")?.focus(), reduce ? 0 : 420);
  }

  return (
    <div
      aria-hidden={!shown}
      className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-300 ease-out ${shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"}`}
    >
      <div className="mx-auto max-w-2xl px-3 pb-[calc(env(safe-area-inset-bottom)_+_0.6rem)] pt-2">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-950/85 px-4 py-3 shadow-glass-2 backdrop-blur-md">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[15px] font-bold text-chalk-50">{priceLabel}</div>
            <div className="truncate text-[11.5px] text-chalk-400">{turnaround}</div>
          </div>
          <button onClick={jump} className="btn-primary shrink-0 !px-5 !py-2.5 !text-[14px]">
            Get this fixed
          </button>
        </div>
      </div>
    </div>
  );
}
