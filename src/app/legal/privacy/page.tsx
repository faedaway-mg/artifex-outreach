import { CONTRACTING_ENTITY } from "@/lib/quick-fix/terms";
import { ARTIFEX_IDENTITY } from "@/lib/identity";

export const dynamic = "force-static";

// PUBLIC privacy & access notice. Deliberately SMALL and accurate: it describes only
// how the system actually behaves. No invented certifications, no data practices the
// product does not perform. No session required.
const SECTIONS: Array<{ h: string; b: string }> = [
  {
    h: "Who we are",
    b: `${CONTRACTING_ENTITY}. This notice covers information handled through Artifex Labs outreach and the Quick-Fix services.`,
  },
  {
    h: "What we collect",
    b: "Publicly available business contact information used to reach a business; information you provide for an engagement (your email, the details, materials, and access needed to do the scoped work); and a record of your terms acceptance (the terms version, the scope you agreed to, a timestamp, and a cryptographic digest of that acceptance).",
  },
  {
    h: "Payment information",
    b: "Payments are processed by Stripe. Your payment card details are entered on Stripe's secure checkout and are handled by Stripe. Artifex does not store your card number.",
  },
  {
    h: "How we use it",
    b: "To perform the service you purchased, administer the engagement, provide support, send you receipts and engagement updates, and keep the business, payment, and acceptance records we are required to keep.",
  },
  {
    h: "Access to your systems",
    b: "Where the work requires access to your website or accounts, we use each platform's native collaborator/invite/authorization system. We do not ask for your passwords, and access you grant can be revoked by you at any time.",
  },
  {
    h: "Who we share it with",
    b: "Service providers that help us operate — for example Stripe for payments and our email provider for delivering messages — and only as needed to provide the service or as required by law. We do not sell your information.",
  },
  {
    h: "Outreach and opt-out",
    b: "Business outreach messages identify Artifex Labs, state that they are commercial messages, include our mailing address, and carry a one-click unsubscribe link. Unsubscribing stops further outreach.",
  },
  {
    h: "Contact",
    b: `Questions about this notice: ${ARTIFEX_IDENTITY.publicEmail}.`,
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
      <p className="text-[12px] font-medium uppercase tracking-wide text-azure-300">Artifex Labs</p>
      <h1 className="mt-1.5 text-[22px] font-semibold text-chalk-50 md:text-[26px]">Privacy &amp; Access Notice</h1>
      <p className="mt-2 text-[13px] text-chalk-400">A plain-language summary of what we collect and how we use it. It describes only what the system actually does.</p>
      <div className="mt-6 space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.h} className="border-t border-white/[0.06] pt-4">
            <h2 className="text-[14px] font-semibold text-chalk-100">{s.h}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-chalk-300">{s.b}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 text-[12.5px] text-chalk-500">
        See also the <a href="/legal/terms" className="underline underline-offset-2 hover:text-chalk-300">Quick-Fix service terms</a>.
      </p>
    </div>
  );
}
