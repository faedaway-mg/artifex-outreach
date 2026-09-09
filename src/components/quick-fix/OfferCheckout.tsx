"use client";
import { useState } from "react";

// The interactive checkout island for the customer offer page. It captures the
// email, the click-accept of the service terms (bound to the current offer version),
// then asks the SERVER to create the checkout — the browser never sends price/SKU.
// A success redirect goes to Stripe; payment is only ever confirmed by the webhook.
export function OfferCheckout(props: {
  token: string; // share token or offerId in the URL
  priceLabel: string;
  turnaround: string;
  purchasable: boolean;
  stripeConfigured: boolean;
  conversationOnly: boolean;
  bookingUrl: string;
  termsVersion: string;
  hasMaintenance: boolean;
  maintenanceLabel: string | null;
  preview?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [withMaintenance, setWithMaintenance] = useState(false);
  const [maintenanceConsent, setMaintenanceConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function buy() {
    setError(null);
    if (props.preview) { setError("Preview mode — checkout is disabled."); return; }
    if (!validEmail) { setError("Enter a valid email for your receipt and updates."); return; }
    if (!agreed) { setError("Please accept the service terms to continue."); return; }
    if (withMaintenance && !maintenanceConsent) { setError("Please separately authorize the recurring maintenance charge to add it."); return; }
    setLoading(true);
    try {
      const t = await fetch(`/api/offer/${props.token}/accept-terms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), accepted: true }) });
      const tj = await t.json();
      if (!tj.ok) { setError(tj.error || "Could not record terms acceptance."); setLoading(false); return; }
      const c = await fetch(`/api/offer/${props.token}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "repair", withMaintenance, maintenanceConsent: withMaintenance ? maintenanceConsent : false, email: email.trim() }) });
      const cj = await c.json();
      if (cj.ok && cj.url) { window.location.href = cj.url; return; }
      setError(cj.error || (cj.reasons ? cj.reasons.join("; ") : "Checkout is not available right now."));
    } catch {
      setError("Something went wrong starting checkout. Please try again.");
    }
    setLoading(false);
  }

  if (props.conversationOnly) {
    return (
      <div className="mt-4">
        <a href={props.bookingUrl} className="inline-flex w-full items-center justify-center rounded-xl bg-azure-500 px-5 py-3.5 text-[15px] font-semibold text-ink-975 sm:w-auto">
          Book a conversation
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[12px] text-chalk-400">Your email (receipt + updates)</span>
        <input
          type="email" inputMode="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-[15px] text-chalk-50 outline-none placeholder:text-chalk-600 focus:border-azure-400/60"
        />
      </label>

      {props.hasMaintenance && props.maintenanceLabel && (
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[13px] text-chalk-300">
            <input type="checkbox" checked={withMaintenance} onChange={(e) => { setWithMaintenance(e.target.checked); if (!e.target.checked) setMaintenanceConsent(false); }} className="mt-0.5 h-4 w-4" />
            <span>Add optional maintenance — {props.maintenanceLabel}.</span>
          </label>
          {withMaintenance && (
            <label className="flex items-start gap-2.5 rounded-xl border border-azure-400/30 bg-azure-500/10 p-3 text-[12.5px] text-chalk-200">
              <input type="checkbox" checked={maintenanceConsent} onChange={(e) => setMaintenanceConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>I authorize Artifex Labs to charge {props.maintenanceLabel} until I cancel. I understand the subscription automatically renews and that I can cancel online before my next billing date.</span>
            </label>
          )}
        </div>
      )}

      <label className="flex items-start gap-2.5 text-[13px] text-chalk-300">
        <input id="accept-terms" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
        <span>I agree to the <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-chalk-100">Service Terms</a> and the scope shown above. <span className="text-chalk-500">({props.termsVersion})</span></span>
      </label>

      {error && <p className="rounded-lg bg-coral-500/10 px-3 py-2 text-[12.5px] text-coral-300">{error}</p>}
      {!props.stripeConfigured && !error && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-200">Secure checkout is being finalized for this environment. You can still book a conversation below.</p>
      )}

      <button
        onClick={buy} disabled={loading || !props.purchasable}
        className="btn-primary w-full !px-5 !py-3.5 !text-[15px] disabled:opacity-50"
      >
        {loading ? "Starting secure checkout…" : `Get this fixed — ${props.priceLabel}`}
      </button>
      <a href={props.bookingUrl} className="block text-center text-[13px] text-chalk-400 underline underline-offset-2 hover:text-chalk-200">
        Prefer to talk first? Book a conversation
      </a>
    </div>
  );
}
