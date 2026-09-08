"use client";
import { useEffect, useState } from "react";

// The success page NEVER decides payment from the redirect. It reads the confirmed
// internal state (set only by the verified webhook) and polls while the webhook may
// still be in flight. It never tells the customer they've paid unless the server
// says so.
type Status = "PAYMENT_CONFIRMING" | "PAID" | "INTAKE_REQUIRED" | "READY_FOR_FULFILLMENT" | "PAYMENT_NOT_CONFIRMED";

const COPY: Record<Status, { title: string; body: string; tone: string }> = {
  PAYMENT_CONFIRMING: { title: "Confirming your payment…", body: "This usually takes a few seconds. This page updates automatically — no need to refresh.", tone: "text-amber-200" },
  PAID: { title: "Payment received", body: "Thank you. Let's get the few things we need to start your fix.", tone: "text-teal-200" },
  INTAKE_REQUIRED: { title: "Payment received", body: "One quick step: grant the access we need so your turnaround can begin.", tone: "text-teal-200" },
  READY_FOR_FULFILLMENT: { title: "You're all set", body: "We have everything we need. Your fix is queued and the turnaround clock has started.", tone: "text-teal-200" },
  PAYMENT_NOT_CONFIRMED: { title: "No payment confirmed yet", body: "If you just completed checkout, give it a moment. If you didn't finish, you can return to the offer.", tone: "text-chalk-300" },
};

export function SuccessStatus({ token, initial, initialNext }: { token: string; initial: Status; initialNext: string | null }) {
  const [status, setStatus] = useState<Status>(initial);
  const [nextPath, setNextPath] = useState<string | null>(initialNext);

  useEffect(() => {
    if (status !== "PAYMENT_CONFIRMING" && status !== "PAYMENT_NOT_CONFIRMED") return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/offer/${token}/status`, { cache: "no-store" });
        const j = await r.json();
        if (!alive || !j.ok) return;
        setStatus(j.status);
        setNextPath(j.nextPath ?? null);
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [status, token]);

  const c = COPY[status];
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className={`text-[13px] font-semibold uppercase tracking-wide ${c.tone}`}>Order status</div>
      <h1 className="mt-2 text-[24px] font-semibold text-chalk-50">{c.title}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-chalk-300">{c.body}</p>
      {(status === "INTAKE_REQUIRED" || status === "PAID") && (
        <a href={nextPath ?? `/offer/${token}/intake`} className="mt-6 inline-flex items-center justify-center rounded-xl bg-azure-500 px-5 py-3 text-[15px] font-semibold text-ink-975 hover:bg-azure-400">
          Continue to setup
        </a>
      )}
      {status === "READY_FOR_FULFILLMENT" && (
        <a href={`/offer/${token}/intake`} className="mt-6 inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-[14px] text-chalk-200 hover:bg-white/5">
          View your order
        </a>
      )}
      {status === "PAYMENT_NOT_CONFIRMED" && (
        <a href={`/offer/${token}`} className="mt-6 inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-[14px] text-chalk-200 hover:bg-white/5">
          Back to the offer
        </a>
      )}
    </div>
  );
}
