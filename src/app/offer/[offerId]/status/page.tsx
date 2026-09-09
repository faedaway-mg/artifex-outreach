import { notFound } from "next/navigation";
import { buildCustomerPortalView } from "@/lib/quick-fix/customer-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CUSTOMER FULFILLMENT PORTAL — public, gated by the offerId/share token in the URL.
// Shows ONLY the customer's own job: a calm 5-stage journey, exactly ONE current
// action, their scope, access instructions + status, and (once delivered) the
// completion report + access-revocation guidance. Never shows the technician
// workspace, internal scoring, operator notes, or any other customer's data.
export default async function CustomerStatusPage({ params }: { params: { offerId: string } }) {
  const v = await buildCustomerPortalView(params.offerId);
  if (!v) notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-6">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-teal-500">{v.company}</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">{v.serviceName}</h1>
        <p className="mt-1 text-[14px] text-chalk-400">{v.finding}</p>
      </header>

      {/* 5-stage journey */}
      <ol className="mb-8 flex items-center gap-2">
        {v.stages.map((s, i) => (
          <li key={s.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold ${s.done ? "bg-teal-500 text-white" : s.current ? "bg-teal-500/20 text-teal-300 ring-2 ring-teal-400" : "bg-white/[0.06] text-chalk-500"}`}>{i + 1}</span>
            <span className={`text-[10.5px] ${s.current ? "text-chalk-100" : "text-chalk-500"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      {/* ONE dominant current action */}
      {v.currentAction && (
        <section className="mb-6 rounded-2xl border border-teal-400/25 bg-teal-400/[0.06] p-5">
          <h2 className="text-[15px] font-semibold text-chalk-50">{v.currentAction.headline}</h2>
          <p className="mt-1 text-[13.5px] text-chalk-300">{v.currentAction.detail}</p>
          {v.currentAction.ctaHref && (
            <a href={v.currentAction.ctaHref} className="mt-3 inline-block rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white">{v.currentAction.ctaLabel}</a>
          )}
        </section>
      )}

      {/* Access instructions (only if access is needed) */}
      {v.access.length > 0 && (
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-azure-300">Connecting access</h2>
          <p className="mt-1 text-[12.5px] text-teal-300">We never ask for your password. Access is via your platform's native invite.</p>
          {v.access.map((a) => (
            <div key={a.key} className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-chalk-100">{a.label}</p>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase text-chalk-400">{a.status}</span>
              </div>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-chalk-300">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          ))}
          <p className="mt-3 text-[11.5px] text-chalk-500">We will never ask for: {v.accessNeverAskFor.join(" · ")}.</p>
          <p className="mt-1 text-[11.5px] text-amber-400">{v.screenshotCredentialWarning}</p>
          <div className="mt-3 rounded-lg border border-azure-400/20 bg-azure-400/[0.06] p-3 text-[12.5px] text-chalk-300">
            {v.accessAssist.note} <a href={v.accessAssist.bookUrl} className="font-semibold text-azure-300 underline">Book a 15-min Access Assist</a>.
          </div>
        </section>
      )}

      {/* Scope */}
      <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-chalk-400">What's included</h2>
        <ul className="mt-2 space-y-1 text-[13px] text-chalk-200">{v.includedItems.map((x, i) => <li key={i}>· {x}</li>)}</ul>
        <p className="mt-3 text-[12px] text-chalk-500">Turnaround: {v.turnaround} · Revisions: {v.revisionPolicy}</p>
      </section>

      {/* Completion report — ONLY when delivered */}
      {v.completionReport && (
        <section className="mb-6 rounded-2xl border border-teal-400/25 bg-teal-400/[0.06] p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-teal-300">Completion report</h2>
          <p className="mt-2 text-[13.5px] text-chalk-100"><span className="text-chalk-500">Issue:</span> {v.completionReport.issue}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase text-chalk-500">What we changed</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-chalk-200">{v.completionReport.changes.map((c, i) => <li key={i}>· {c}</li>)}</ul>
          {v.completionReport.verification.length > 0 && (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase text-chalk-500">Verified</p>
              <ul className="mt-1 space-y-0.5 text-[13px] text-chalk-200">{v.completionReport.verification.map((c, i) => <li key={i}>✓ {c}</li>)}</ul>
            </>
          )}
          <p className="mt-3 rounded-lg bg-white/[0.04] p-3 text-[12.5px] text-chalk-300">{v.accessCloseout}</p>
          <p className="mt-2 text-[12px] text-chalk-500">{v.revisionDeadline}</p>
        </section>
      )}

      {!v.completionReport && (
        <p className="text-[12px] text-chalk-600">{v.revisionDeadline}</p>
      )}
    </main>
  );
}
