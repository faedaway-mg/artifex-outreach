import { TERMS_VERSION, CONTRACTING_ENTITY, TERMS_CLAUSES } from "@/lib/quick-fix/terms";

export const dynamic = "force-static";

// PUBLIC Quick-Fix Service Terms — rendered from the single canonical source
// (lib/quick-fix/terms.ts) so the public page can never drift from the terms a
// customer accepts at checkout. No session required.
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
      <p className="text-[12px] font-medium uppercase tracking-wide text-azure-300">Artifex Labs · Quick-Fix</p>
      <h1 className="mt-1.5 text-[22px] font-semibold text-chalk-50 md:text-[26px]">Service Terms</h1>
      <p className="mt-2 text-[13px] text-chalk-400">
        {CONTRACTING_ENTITY}. Version <span className="text-chalk-200">{TERMS_VERSION}</span>. These terms govern the
        productized Quick-Fix services. The accepted offer controls service-specific details; these terms govern
        everything else.
      </p>
      <div className="mt-6 space-y-5">
        {TERMS_CLAUSES.map((c) => (
          <section key={c.heading} className="border-t border-white/[0.06] pt-4">
            <h2 className="text-[14px] font-semibold text-chalk-100">{c.heading}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-chalk-300">{c.body}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 text-[12.5px] text-chalk-500">
        See also the <a href="/legal/privacy" className="underline underline-offset-2 hover:text-chalk-300">privacy &amp; access notice</a>.
      </p>
    </div>
  );
}
