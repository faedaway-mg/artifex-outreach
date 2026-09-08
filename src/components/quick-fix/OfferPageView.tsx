import { OfferCheckout } from "./OfferCheckout";
import type { OfferPageModel } from "@/lib/quick-fix/offer-page";

// Presentational, customer-safe rendering of the offer page model. No internal
// economics or scoring ever reaches this component. Reused by the public
// /offer/[offerId] route AND the operator "preview as customer" surface.
const NECESSITY_LABEL: Record<string, string> = {
  REQUIRED_BEFORE_START: "Required",
  OPTIONAL: "Optional",
  ONLY_IF_NEEDED: "If needed",
};
const NECESSITY_CLASS: Record<string, string> = {
  REQUIRED_BEFORE_START: "bg-azure-500/15 text-azure-200",
  OPTIONAL: "bg-white/10 text-chalk-300",
  ONLY_IF_NEEDED: "bg-white/10 text-chalk-400",
};

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-5">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-chalk-500">{n} · {title}</h2>
      <div className="mt-2 text-[14px] leading-relaxed text-chalk-200">{children}</div>
    </section>
  );
}

export function OfferPageView({ model, token, preview = false }: { model: OfferPageModel; token: string; preview?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      {preview && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-center text-[12.5px] font-medium text-amber-200">
          OPERATOR PREVIEW — no email is sent and no charge is made.
        </div>
      )}

      {/* Hero — company, offer, price, turnaround, and the primary transaction up top. */}
      <header className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <p className="text-[12px] font-medium uppercase tracking-wide text-azure-300">Artifex Labs · Quick Fix</p>
        <h1 className="mt-1.5 text-[22px] font-semibold leading-tight text-chalk-50 md:text-[26px]">{model.headline}</h1>
        {!model.conversationOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span className="text-[24px] font-bold text-chalk-50">{model.priceLabel}</span>
            <span className="rounded-full bg-teal-400/10 px-2.5 py-1 text-[12.5px] font-medium text-teal-200">{model.turnaround}</span>
          </div>
        )}
        <p className="mt-3 text-[14px] leading-relaxed text-chalk-300">{model.whatWeFound}</p>
        <div className="mt-4">
          <OfferCheckout
            token={token}
            priceLabel={model.priceLabel || "—"}
            turnaround={model.turnaround}
            purchasable={model.checkout.purchasable}
            stripeConfigured={!model.checkout.reasons.includes("checkout is not available in this environment")}
            conversationOnly={model.conversationOnly}
            bookingUrl={model.bookingUrl}
            termsVersion={model.termsVersion}
            hasMaintenance={!!model.maintenance}
            maintenanceLabel={model.maintenance ? `$${Math.round(model.maintenance.monthlyCents / 100)}/mo — ${model.maintenance.planName}` : null}
            preview={preview}
          />
        </div>
      </header>

      {model.conversationOnly ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[14px] text-chalk-300">
          {model.conversationReason ?? "This one is a bit broader than a fixed-price fix — let's talk."}
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <Section n="01" title="What we found">
            <p>{model.whatWeFound}</p>
          </Section>

          <Section n="02" title="Evidence">
            {model.evidence.length ? (
              <ul className="list-disc space-y-1 pl-5">{model.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            ) : <p className="text-chalk-400">Based on our direct review of your site.</p>}
          </Section>

          <Section n="03" title="The fix — what's included">
            <ul className="space-y-1.5">{model.whatWeFix.map((f, i) => <li key={i} className="flex gap-2"><span className="text-teal-300">✓</span><span>{f}</span></li>)}</ul>
          </Section>

          <Section n="04" title="Fixed price & turnaround">
            <p><span className="font-semibold text-chalk-50">{model.priceLabel}</span> · {model.turnaround}. No surprise charges — the price shown covers the scope shown.</p>
          </Section>

          <Section n="05" title="How the Artifex quick fix works">
            {model.trustVideo.present && model.trustVideo.assetUrl ? (
              <video controls preload="metadata" className="w-full rounded-xl border border-white/10">
                <source src={model.trustVideo.assetUrl} />
              </video>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-[12px] font-medium uppercase tracking-wide text-chalk-500">Explainer{model.trustVideo.version ? ` · v${model.trustVideo.version}` : ""}</p>
                <p className="mt-1.5 text-[13.5px] text-chalk-300">{model.trustVideo.script || "A short explainer of how our fixed-scope, fixed-price fixes work."}</p>
              </div>
            )}
          </Section>

          <Section n="06" title="What's not included">
            {model.whatsExcluded.length ? (
              <ul className="list-disc space-y-1 pl-5 text-chalk-300">{model.whatsExcluded.map((e, i) => <li key={i}>{e}</li>)}</ul>
            ) : <p className="text-chalk-400">Anything beyond the scope above is quoted separately, only if you want it.</p>}
          </Section>

          <Section n="07" title="What we'll need from you">
            <ul className="space-y-2.5">
              {model.requirements.items.map((r) => (
                <li key={r.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-chalk-100">{r.label}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${NECESSITY_CLASS[r.necessity]}`}>{NECESSITY_LABEL[r.necessity]}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-chalk-500">We never ask for your password — access is via your platform's native invite.</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section n="08" title="When the turnaround starts">
            <p>The clock starts only after we receive the required access and confirmations above — not at purchase. An outstanding item never runs down your window.</p>
          </Section>

          <Section n="09" title="How you stay protected">
            <ul className="space-y-1.5">{model.integrityPrinciples.map((p, i) => <li key={i} className="flex gap-2"><span className="text-azure-300">•</span><span className="text-chalk-300">{p}</span></li>)}</ul>
          </Section>

          <Section n="10" title="Service terms">
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[12.5px] text-chalk-400">
              {model.termsClauses.map((c, i) => (
                <p key={i}><span className="font-semibold text-chalk-200">{c.heading}.</span> {c.body}</p>
              ))}
              <p className="pt-1 text-chalk-600">Terms version {model.termsVersion}. You accept these at checkout.</p>
            </div>
          </Section>

          {/* Repeat the transaction at the bottom so the CTA is never buried. */}
          <div className="border-t border-white/[0.06] pt-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[20px] font-bold text-chalk-50">{model.priceLabel}</span>
                <span className="text-[13px] text-chalk-400">{model.turnaround}</span>
              </div>
              <div className="mt-3">
                <OfferCheckout
                  token={token}
                  priceLabel={model.priceLabel || "—"}
                  turnaround={model.turnaround}
                  purchasable={model.checkout.purchasable}
                  stripeConfigured={!model.checkout.reasons.includes("checkout is not available in this environment")}
                  conversationOnly={model.conversationOnly}
                  bookingUrl={model.bookingUrl}
                  termsVersion={model.termsVersion}
                  hasMaintenance={!!model.maintenance}
                  maintenanceLabel={model.maintenance ? `$${Math.round(model.maintenance.monthlyCents / 100)}/mo — ${model.maintenance.planName}` : null}
                  preview={preview}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-8 text-center text-[11.5px] text-chalk-600">
        Artifex Labs · Los Angeles, CA · This page contains no tracking beyond what's needed to fulfill your order.
      </footer>
    </div>
  );
}
