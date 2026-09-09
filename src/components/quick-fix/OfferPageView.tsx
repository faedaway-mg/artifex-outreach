import {
  BadgeCheck, ShieldCheck, Lock, KeyRound, CircleDollarSign, ClipboardCheck,
  Check, Sparkles, AlertCircle, ArrowRight, Eye, FileText, PlayCircle,
} from "lucide-react";
import { OfferCheckout } from "./OfferCheckout";
import { OfferStickyBar } from "./OfferStickyBar";
import type { OfferPageModel } from "@/lib/quick-fix/offer-page";

// Presentational, customer-safe rendering of the offer page model. No internal
// economics or scoring ever reaches this component. Reused by the public
// /offer/[offerId] route AND the operator "preview as customer" surface.
//
// Design goal (conversion redesign): a premium, highly skimmable PRODUCT PURCHASE
// experience — strong hero, visual evidence, scope cards, a motion trust-video
// centerpiece, qualitative impact, a trust grid, and a compact inline-legal summary
// — WITHOUT weakening the acceptance architecture (full terms still accepted at
// checkout and the immutable snapshot is stored server-side).
const NECESSITY_LABEL: Record<string, string> = {
  REQUIRED_BEFORE_START: "Required",
  OPTIONAL: "Optional",
  ONLY_IF_NEEDED: "If needed",
};
const NECESSITY_CLASS: Record<string, string> = {
  REQUIRED_BEFORE_START: "bg-azure-500/15 text-azure-200 ring-1 ring-azure-400/20",
  OPTIONAL: "bg-white/10 text-chalk-300",
  ONLY_IF_NEEDED: "bg-white/[0.06] text-chalk-400",
};

// The six canonical confidence items (mirror INTEGRITY_PRINCIPLES; no metrics).
const PROTECTION = [
  { icon: ClipboardCheck, label: "Fixed scope", desc: "You buy exactly the scope shown — nothing creeps." },
  { icon: CircleDollarSign, label: "Fixed price", desc: "The price shown covers the scope shown. No surprises." },
  { icon: BadgeCheck, label: "Evidence-backed", desc: "Every recommendation is backed by something we observed." },
  { icon: Lock, label: "No passwords", desc: "We never ask for your password — ever." },
  { icon: KeyRound, label: "You control access", desc: "Access is via native invites you can revoke anytime." },
  { icon: ShieldCheck, label: "No work without approval", desc: "If scope materially changes, we ask you first." },
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}>{children}</div>;
}
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk-500">{children}</p>;
}

export function OfferPageView({ model, token, preview = false }: { model: OfferPageModel; token: string; preview?: boolean }) {
  const checkoutProps = {
    token,
    priceLabel: model.priceLabel || "—",
    turnaround: model.turnaround,
    purchasable: model.checkout.purchasable,
    stripeConfigured: !model.checkout.reasons.includes("checkout is not available in this environment"),
    conversationOnly: model.conversationOnly,
    bookingUrl: model.bookingUrl,
    termsVersion: model.termsVersion,
    hasMaintenance: !!model.maintenance,
    maintenanceLabel: model.maintenance ? `$${Math.round(model.maintenance.monthlyCents / 100)}/mo — ${model.maintenance.planName}` : null,
    preview,
  };
  const video = model.trustVideo;
  const showSticky = !preview && !model.conversationOnly && model.checkout.purchasable;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      {preview && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-center text-[12.5px] font-medium text-amber-200">
          OPERATOR PREVIEW — no email is sent and no charge is made.
        </div>
      )}

      {/* ── Hero — the whole offer in seconds ─────────────────────────────── */}
      <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.055] to-white/[0.02] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-azure-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-amber-400/[0.07] blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200 ring-1 ring-amber-400/25">
              <Sparkles size={12} /> Artifex Quick-Fix
            </span>
          </div>
          <h1 className="mt-3.5 text-[25px] font-bold leading-[1.1] tracking-tight text-chalk-50 md:text-[32px]">{model.headline}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-chalk-300 md:text-[16px]">{model.whatWeFound}</p>

          {!model.conversationOnly && (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[28px] font-extrabold tracking-tight text-chalk-50 md:text-[32px]">{model.priceLabel}</span>
                <span className="rounded-full bg-teal-400/10 px-3 py-1 text-[12.5px] font-medium text-teal-200 ring-1 ring-teal-400/20">{model.turnaround}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {model.trustBadges.map((b, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[12px] font-medium text-chalk-200 ring-1 ring-white/[0.06]">
                    <Check size={13} className="text-teal-300" /> {b}
                  </span>
                ))}
              </div>
            </>
          )}

          <div id="offer-buy" className="mt-6 scroll-mt-24">
            <OfferCheckout {...checkoutProps} />
          </div>
        </div>
      </header>

      {model.conversationOnly ? (
        <Card className="mt-6 p-5 text-[14px] text-chalk-300">
          {model.conversationReason ?? "This one is a bit broader than a fixed-price fix — let's talk."}
        </Card>
      ) : (
        <div className="mt-8 space-y-8">
          {/* ── Visual evidence card ──────────────────────────────────────── */}
          <section>
            <Eyebrow>What we found</Eyebrow>
            <Card className="mt-3 overflow-hidden">
              <div className="grid gap-px bg-white/[0.06] md:grid-cols-3">
                <div className="bg-ink-975/40 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-coral-300"><AlertCircle size={13} /> Observed issue</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-100">{model.whatWeFound}</p>
                </div>
                <div className="bg-ink-975/40 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200"><Sparkles size={13} /> Why it matters</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-200">{model.impactPoints[0] ?? "It affects the experience where it counts."}</p>
                </div>
                <div className="bg-ink-975/40 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-azure-200"><Eye size={13} /> Evidence</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-200">{model.evidence[0] ?? "Based on our direct review of your site."}</p>
                </div>
              </div>
            </Card>
          </section>

          {/* ── What we'll fix — premium cards ────────────────────────────── */}
          <section>
            <Eyebrow>The fix — what's included</Eyebrow>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {model.whatWeFix.map((f, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4">
                  <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-teal-400/15 text-teal-300"><Check size={15} /></span>
                  <span className="text-[14px] font-medium leading-snug text-chalk-100">{f}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Video centerpiece ─────────────────────────────────────────── */}
          <section>
            <Eyebrow>See how it works</Eyebrow>
            <Card className="mt-3 overflow-hidden">
              {video.present && video.assetUrl ? (
                <div className="relative">
                  <video
                    controls preload="metadata"
                    poster={video.posterUrl ?? undefined}
                    className="aspect-video w-full bg-ink-975"
                  >
                    <source src={video.assetUrl} type="video/mp4" />
                    {video.captionsUrl && <track kind="captions" srcLang="en" label="English" src={video.captionsUrl} default />}
                  </video>
                </div>
              ) : (
                <div className="p-5">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-chalk-500"><PlayCircle size={14} /> Explainer{video.version ? ` · v${video.version}` : ""}</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-300">{video.script || "A short explainer of how our fixed-scope, fixed-price fixes work."}</p>
                </div>
              )}
              <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-azure-500/10 text-azure-300"><PlayCircle size={16} /></span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-chalk-100">{video.title}</p>
                  <p className="truncate text-[12px] text-chalk-500">Fixed scope · fixed price · confirmed completion — a 60-second walkthrough.</p>
                </div>
              </div>
            </Card>
          </section>

          {/* ── Why this matters (qualitative impact) ─────────────────────── */}
          <section>
            <Eyebrow>Why this matters</Eyebrow>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {model.impactPoints.map((p, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400/12 text-amber-200"><ArrowRight size={15} /></span>
                  <p className="mt-2.5 text-[13.5px] font-medium leading-snug text-chalk-100">{p}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Conceptual before/after (EXAMPLE — never a measured result) ── */}
          <section>
            <Eyebrow>What the repair addresses</Eyebrow>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-coral-500/25 bg-coral-500/[0.06] p-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-coral-300">Example · before</p>
                <p className="mt-2 text-[15px] font-semibold text-chalk-100">{model.beforeAfter.before}</p>
              </div>
              <div className="rounded-xl border border-teal-400/30 bg-teal-400/[0.07] p-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-teal-300">Example · after</p>
                <p className="mt-2 text-[15px] font-semibold text-chalk-100">{model.beforeAfter.after}</p>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-chalk-600">Illustrative interface structure — not a measured result for your site.</p>
          </section>

          {/* ── How you're protected — trust grid ─────────────────────────── */}
          <section>
            <Eyebrow>How you're protected</Eyebrow>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PROTECTION.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-400/12 text-teal-300"><Icon size={15} /></span>
                    <span className="text-[13.5px] font-semibold text-chalk-50">{label}</span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-chalk-400">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── What we'll need from you ───────────────────────────────────── */}
          <section>
            <Eyebrow>What we'll need from you</Eyebrow>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] px-3.5 py-2.5 text-[12.5px] text-teal-200">
              <Lock size={14} className="flex-none" /> We never ask for your password — access is via your platform's native invite, which you can revoke.
            </div>
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {model.requirements.items.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                  <span className="text-[13.5px] font-medium text-chalk-100">{r.label}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${NECESSITY_CLASS[r.necessity]}`}>{NECESSITY_LABEL[r.necessity]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-chalk-500">The turnaround starts only after we receive the required access — never at purchase. An outstanding item never runs down your window.</p>
          </section>

          {/* ── What's not included — de-emphasized accordion ─────────────── */}
          <details className="group rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-chalk-300 [&::-webkit-details-marker]:hidden">
              <span>What's not included</span>
              <ArrowRight size={14} className="text-chalk-500 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-4 pb-4 text-[13px] text-chalk-400">
              {model.whatsExcluded.length ? (
                <ul className="list-disc space-y-1 pl-5">{model.whatsExcluded.map((e, i) => <li key={i}>{e}</li>)}</ul>
              ) : <p>Anything beyond the scope above is quoted separately, only if you want it.</p>}
            </div>
          </details>

          {/* ── Service terms — concise summary + full link ───────────────── */}
          <section>
            <Eyebrow>Service terms</Eyebrow>
            <Card className="mt-3 p-4">
              <ul className="space-y-2 text-[13px] text-chalk-200">
                <li className="flex gap-2"><Check size={15} className="mt-0.5 flex-none text-teal-300" /> Your work is limited to the scope shown above.</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 flex-none text-teal-300" /> Turnaround begins after we receive the required access.</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 flex-none text-teal-300" /> Fixed price — no surprise charges for the scope shown.</li>
                <li className="flex gap-2"><Check size={15} className="mt-0.5 flex-none text-teal-300" /> The full Service Terms apply and are accepted at checkout.</li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3 text-[12px]">
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-azure-300 underline underline-offset-2 hover:text-azure-200"><FileText size={13} /> View full Service Terms</a>
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-chalk-500 underline underline-offset-2 hover:text-chalk-300">Privacy &amp; access notice</a>
                <span className="text-chalk-600">Terms {model.termsVersion}</span>
              </div>
            </Card>
          </section>

          {/* ── Bottom CTA — never bury the transaction ───────────────────── */}
          <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[24px] font-extrabold tracking-tight text-chalk-50">{model.priceLabel}</span>
              <span className="text-[13px] text-chalk-400">{model.turnaround}</span>
            </div>
            <p className="mt-1 text-[13px] text-chalk-400">Fixed scope, fixed price. Accept the terms and check out securely below.</p>
            <div className="mt-4">
              <OfferCheckout {...checkoutProps} />
            </div>
          </section>
        </div>
      )}

      <footer className="mt-10 text-center text-[11.5px] text-chalk-600">
        Artifex Labs · Los Angeles, CA · This page contains no tracking beyond what's needed to fulfill your order.
      </footer>

      {showSticky && <OfferStickyBar priceLabel={model.priceLabel || "—"} turnaround={model.turnaround} />}
    </div>
  );
}
