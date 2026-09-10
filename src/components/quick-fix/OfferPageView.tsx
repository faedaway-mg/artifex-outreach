import {
  BadgeCheck, ShieldCheck, Lock, KeyRound, CircleDollarSign, ClipboardCheck,
  Check, Sparkles, AlertCircle, ArrowRight, Eye, FileText, PlayCircle, Video, Wrench,
} from "lucide-react";
import { OfferCheckout } from "./OfferCheckout";
import { OfferStickyBar } from "./OfferStickyBar";
import { EvidenceGallery } from "./EvidenceGallery";
import { ValueStack } from "./ValueStack";
import { PriceReveal } from "./PriceReveal";
import type { OfferPageModel } from "@/lib/quick-fix/offer-page";

// Presentational, customer-safe rendering of the offer page model. No internal
// economics or scoring ever reaches this component. Reused by the public
// /offer/[offerId] route AND the operator "preview as customer" surface.
//
// INFORMATION ARCHITECTURE (value-before-price persuasion sequence):
//   1. EXPERIENCE hero      — the attempted-use / observed-friction framing (never SKU/price)
//   2. REAL EVIDENCE        — captured screenshots of the customer's own live site
//   3. PERSONALIZED VIDEO   — only when a real per-business video is READY (MISSING today)
//   4. WHAT THIS MEANS      — plain-language, qualitative (no metrics)
//   5. THE REPAIR           — the proposed change, in plain language
//   6. WHAT'S INCLUDED      — the honest value stack (scope.includedItems only)
//   7. HOW YOU'RE PROTECTED — real ops protections (no invented guarantees)
//   8. PRICE REVEAL         — ONE fixed server price, before the CTA (delayed, never hidden)
//   9. PURCHASE CTA         — the checkout island (email + service-terms gate)
//  10. SECONDARY            — diagnostic PDF, evergreen process video, exclusions, terms
//
// Price salience is DELAYED (it appears after the value, not in the hero) but never
// HIDDEN — it is shown in full before the CTA and before checkout. No dark patterns.
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

// How the process is protected — real operational protections that hold for every
// fixed-scope offer (mirror INTEGRITY_PRINCIPLES). No metrics, no invented guarantees.
const PROTECTION = [
  { icon: ClipboardCheck, label: "Fixed scope", desc: "You buy exactly the scope shown — nothing creeps." },
  { icon: CircleDollarSign, label: "One-time, fixed price", desc: "The price shown covers the scope shown. No subscription, no surprise charges." },
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

const PRICE_SECTION_ID = "offer-price";
const REPAIR_SECTION_ID = "offer-repair";
const HERO_ANCHOR_ID = "offer-hero";

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
  const experience = model.experience;
  const showSticky = !preview && !model.conversationOnly && model.checkout.purchasable;

  // ── Evidence bindings (purely additive; every gate is "READY-only") ──────────
  // Real screenshots of the customer's OWN live site. When none is READY we fall
  // back to the existing text evidence card — we NEVER fabricate an image.
  const evidence = model.evidenceAssets ?? null;
  const hasRealScreenshots = !!evidence && evidence.screenshotStatus === "READY";
  // The personalized diagnostic video is MISSING today (no generator). We render it
  // ONLY when a real asset is READY and we NEVER substitute the evergreen for it.
  const personalizedVideo =
    evidence && evidence.personalizedVideo.status === "READY" && evidence.personalizedVideo.url
      ? evidence.personalizedVideo
      : null;
  // The full diagnostic review PDF — shown only when a real artifact is persisted.
  const diagnosticPdf =
    evidence && evidence.diagnosticPdf.status === "READY" && evidence.diagnosticPdf.url
      ? evidence.diagnosticPdf
      : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      {preview && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-center text-[12.5px] font-medium text-amber-200">
          OPERATOR PREVIEW — no email is sent and no charge is made.
        </div>
      )}

      {/* ── 1. EXPERIENCE HERO — the attempted-use / observed-friction framing ──
          Leads with the customer's own experience, NOT a SKU, price, "Artifex", or
          any technical term. offerHeroTitle/offerHeroSubline are the SINGLE source of
          this framing (shared with the email + PDF). When no attempt is supported the
          frame returns an honest observational hero — used verbatim, never fabricated. */}
      <header id={HERO_ANCHOR_ID} className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.055] to-white/[0.02] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-azure-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-amber-400/[0.07] blur-3xl" />
        <div className="relative">
          <h1 className="text-[26px] font-bold leading-[1.12] tracking-tight text-chalk-50 md:text-[34px]">
            {experience.offerHeroTitle}
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-chalk-200 md:text-[17px]">
            {experience.offerHeroSubline}
          </p>
          {!model.conversationOnly && (
            <p className="mt-4 text-[14px] leading-relaxed text-chalk-400">
              We tested this on the pages below and documented what we found.
            </p>
          )}
        </div>
      </header>

      {model.conversationOnly ? (
        <Card className="mt-6 p-5 text-[14px] text-chalk-300">
          {model.conversationReason ?? "This one is a bit broader than a fixed-price fix — let's talk."}
        </Card>
      ) : (
        <div className="mt-8 space-y-8">
          {/* ── 2. REAL EVIDENCE — personalized proof, before any generic trust ──
              When we have real captured screenshots of the customer's own live site
              we lead with them (observed evidence). When we don't, we fall back to the
              existing text evidence card — we NEVER fabricate or show a placeholder. */}
          {hasRealScreenshots && evidence ? (
            <EvidenceGallery evidence={evidence} />
          ) : (
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
          )}

          {/* ── 3. PERSONALIZED DIAGNOSTIC VIDEO slot ───────────────────────────
              Rendered ONLY when a real per-business diagnostic video is READY. It is
              MISSING today (no generator) → nothing renders here, and we NEVER
              substitute the shared evergreen process video for it. */}
          {personalizedVideo && (
            <section aria-label="Your personalized diagnostic video">
              <Eyebrow>Your personalized walkthrough</Eyebrow>
              <Card className="relative mt-3 overflow-hidden">
                <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-azure-500/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-azure-200 ring-1 ring-azure-400/25">
                  <Video size={12} /> About your site
                </div>
                <video controls preload="metadata" className="aspect-video w-full bg-ink-975">
                  <source src={personalizedVideo.url!} type="video/mp4" />
                </video>
                <div className="border-t border-white/[0.06] px-4 py-3 text-[12.5px] text-chalk-400">
                  A short walkthrough we recorded about your specific site.
                </div>
              </Card>
            </section>
          )}

          {/* ── 4. WHAT THIS MEANS — plain-language, qualitative only (no metrics) ── */}
          <section>
            <Eyebrow>What this means</Eyebrow>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {model.impactPoints.map((p, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400/12 text-amber-200"><ArrowRight size={15} /></span>
                  <p className="mt-2.5 text-[13.5px] font-medium leading-snug text-chalk-100">{p}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 5. THE REPAIR — the proposed change, in plain language ──────────
              6. WHAT'S INCLUDED — the honest value stack (scope.includedItems ONLY,
              no invented bonuses, no fake "$X value", required work never a "bonus"). */}
          <section id={REPAIR_SECTION_ID} className="scroll-mt-24">
            <Eyebrow>The repair</Eyebrow>
            <Card className="mt-3 p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl bg-teal-400/12 text-teal-300"><Wrench size={16} /></span>
                <p className="text-[15px] leading-relaxed text-chalk-100">{model.proposedSolution}</p>
              </div>
            </Card>

            <div className="mt-6">
              <Eyebrow>What&rsquo;s included</Eyebrow>
              <ValueStack items={model.whatWeFix} />
            </div>
          </section>

          {/* ── 7. HOW THE PROCESS IS PROTECTED — real ops protections ─────────
              No invented guarantees: fixed scope/price, one-time (no subscription), no
              password, no out-of-scope work without asking, tested on the live site,
              turnaround starts after access, and the offer's own revision window. */}
          <section>
            <Eyebrow>How the process is protected</Eyebrow>
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
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] px-3.5 py-2.5 text-[12.5px] text-teal-200">
              <Check size={14} className="flex-none" /> Tested on your live site, and the turnaround starts only after you provide access. Revisions: {model.revisionPolicy}.
            </div>
          </section>

          {/* ── 8. PRICE REVEAL — ONE fixed server price, BEFORE the purchase CTA ──
              Salience is delayed (value first) but the price is never hidden: it shows
              in full here, then the purchase CTA follows immediately below. The price
              string derives from the server's offer.priceCents (model.priceLabel). */}
          <PriceReveal id={PRICE_SECTION_ID} priceLabel={model.priceLabel || "—"} turnaround={model.turnaround} />

          {/* ── 9. PURCHASE CTA — the checkout island (email + service-terms gate) ── */}
          <section id="offer-buy" className="scroll-mt-24 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-6">
            <p className="text-[13px] text-chalk-400">Ready when you are — accept the terms and check out securely.</p>
            <div className="mt-4">
              <OfferCheckout {...checkoutProps} />
            </div>
          </section>

          {/* ── 10. SECONDARY — diagnostic PDF, evergreen video, exclusions, terms ── */}

          {/* What we'll need from you (access) — required to start the turnaround. */}
          <section>
            <Eyebrow>What we&rsquo;ll need from you</Eyebrow>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-teal-400/20 bg-teal-400/[0.06] px-3.5 py-2.5 text-[12.5px] text-teal-200">
              <Lock size={14} className="flex-none" /> We never ask for your password — access is via your platform&rsquo;s native invite, which you can revoke.
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

          {/* Diagnostic PDF — shown ONLY when a real generated PDF is persisted (READY). */}
          {diagnosticPdf && (
            <section>
              <Card className="p-4">
                <a
                  href={diagnosticPdf.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[14px] font-medium text-azure-300 underline underline-offset-2 hover:text-azure-200"
                >
                  <FileText size={16} /> View the full review (PDF)
                </a>
                <p className="mt-1.5 text-[12.5px] text-chalk-500">A written review of what we found on your site, in plain language.</p>
              </Card>
            </section>
          )}

          {/* Evergreen ARTIFEX PROCESS video — the SHARED "how it works" explainer,
              clearly a separate role from any personalized video above. Always stays. */}
          <section>
            <Eyebrow>How the Artifex quick fix works</Eyebrow>
            <Card className="mt-3 overflow-hidden">
              {video.present && video.assetUrl ? (
                <div className="relative">
                  <video
                    controls playsInline preload="metadata"
                    poster={video.posterUrl ?? undefined}
                    className="aspect-video w-full bg-ink-975"
                  >
                    <source src={video.assetUrl} type="video/mp4" />
                    {/* Captions default OFF and are attached ONLY when verified against the final
                        narration (captionsUrl is null until then) — never auto-display stale cues. */}
                    {video.captionsUrl && <track kind="captions" srcLang="en" label="English" src={video.captionsUrl} />}
                  </video>
                </div>
              ) : (
                /* No RENDERED explainer video yet — show a neutral placeholder, NEVER the transcript
                   promoted to primary content. Send is independently BLOCKED upstream (Breakbot
                   presentation readiness) when the required trust/explainer video is missing, so an
                   approved customer offer always has the real video here. */
                <div className="flex items-center gap-3 p-6">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-azure-500/10 text-azure-300"><Video size={18} /></span>
                  <p className="text-[13.5px] leading-relaxed text-chalk-300">The short explainer video for how the Artifex quick fix works is being prepared.</p>
                </div>
              )}
              <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-azure-500/10 text-azure-300"><PlayCircle size={16} /></span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-chalk-100">{video.title}{video.version ? ` · v${video.version}` : ""}</p>
                  <p className="truncate text-[12px] text-chalk-500">How our process works — the same for every customer, not about your site.</p>
                </div>
              </div>
              {/* Transcript = SECONDARY / accessibility only: collapsible, never a replacement for the
                  video in the normal customer experience. */}
              {video.script ? (
                <details className="group border-t border-white/[0.06]">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12px] font-medium text-chalk-400 [&::-webkit-details-marker]:hidden">
                    <FileText size={13} /> View transcript
                    <ArrowRight size={13} className="ml-auto transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="whitespace-pre-wrap px-4 pb-4 text-[12.5px] leading-relaxed text-chalk-400">{video.script}</p>
                </details>
              ) : null}
            </Card>
          </section>

          {/* Conceptual before/after (EXAMPLE — never a measured result). */}
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

          {/* What's not included — de-emphasized accordion. */}
          <details className="group rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-chalk-300 [&::-webkit-details-marker]:hidden">
              <span>What&rsquo;s not included</span>
              <ArrowRight size={14} className="text-chalk-500 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-4 pb-4 text-[13px] text-chalk-400">
              {model.whatsExcluded.length ? (
                <ul className="list-disc space-y-1 pl-5">{model.whatsExcluded.map((e, i) => <li key={i}>{e}</li>)}</ul>
              ) : <p>Anything beyond the scope above is quoted separately, only if you want it.</p>}
            </div>
          </details>

          {/* Service terms — concise summary + full link. */}
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

          {/* Bottom CTA — never bury the transaction. */}
          <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[24px] font-extrabold tracking-tight text-chalk-50">{model.priceLabel}</span>
              <span className="text-[13px] text-chalk-400">{model.turnaround}</span>
            </div>
            <p className="mt-1 text-[13px] text-chalk-400">One-time, fixed price. Accept the terms and check out securely below.</p>
            <div className="mt-4">
              <OfferCheckout {...checkoutProps} />
            </div>
          </section>
        </div>
      )}

      <footer className="mt-10 text-center text-[11.5px] text-chalk-600">
        Artifex Labs · Los Angeles, CA · This page contains no tracking beyond what&rsquo;s needed to fulfill your order.
      </footer>

      {showSticky && (
        <OfferStickyBar
          priceLabel={model.priceLabel || "—"}
          turnaround={model.turnaround}
          priceSectionId={PRICE_SECTION_ID}
          repairSectionId={REPAIR_SECTION_ID}
          heroAnchorId={HERO_ANCHOR_ID}
        />
      )}
    </div>
  );
}
