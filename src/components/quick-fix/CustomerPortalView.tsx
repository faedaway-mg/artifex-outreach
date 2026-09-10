// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER PORTAL VIEW (Customer Portal mandate CP6 · §18-19) — the external, trust-building surface a
// customer opens from their receipt/transactional link. Mobile-first. Renders ONLY the customer-safe
// projection (CustomerPortalView from lib/quick-fix/customer-portal). No internal system language
// (no Breakbot / render worker / revision hashes), no secrets, Artifex branding.
// ─────────────────────────────────────────────────────────────────────────────
import type { CustomerPortalView as PortalView } from "@/lib/quick-fix/customer-portal";
import { ARTIFEX_IDENTITY } from "@/lib/identity";

function StageRail({ stages }: { stages: PortalView["stages"] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {stages.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold " +
              (s.done ? "bg-teal-400/20 text-teal-200" : s.current ? "bg-azure-400/25 text-azure-100 ring-2 ring-azure-400/40" : "bg-white/[0.05] text-chalk-500")
            }
          >
            {s.done ? "✓" : i + 1}
          </span>
          <span className={"text-xs " + (s.current ? "font-medium text-chalk-100" : s.done ? "text-chalk-300" : "text-chalk-500")}>{s.label}</span>
          {i < stages.length - 1 && <span className="hidden text-chalk-700 sm:inline">—</span>}
        </li>
      ))}
    </ol>
  );
}

export function CustomerPortalView({ view }: { view: PortalView }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      {/* Brand + status */}
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-chalk-500">{ARTIFEX_IDENTITY.companyName}</p>
        <h1 className="text-2xl font-semibold text-chalk-50">Your {view.serviceName}</h1>
        <p className="text-sm text-chalk-400">{view.company}</p>
      </header>

      {/* Milestone progress */}
      <section className="card p-4">
        <p className="label mb-3">Status</p>
        <StageRail stages={view.stages} />
      </section>

      {/* What we're fixing (frozen purchased scope) */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold text-chalk-100">What we&apos;re fixing</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-chalk-300">{view.finding}</p>
        {view.includedItems.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {view.includedItems.map((it, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-chalk-400"><span className="text-teal-300">•</span>{it}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-chalk-500">Turnaround: {view.turnaround}</p>
      </section>

      {/* Next step for the customer (exactly one dominant action) */}
      {view.currentAction && (
        <section className="card border-azure-400/20 bg-azure-400/[0.04] p-4">
          <h2 className="text-sm font-semibold text-chalk-100">Next step</h2>
          <p className="mt-1 text-sm text-chalk-200">{view.currentAction.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-chalk-400">{view.currentAction.detail}</p>
          {view.currentAction.ctaHref && (
            <a href={view.currentAction.ctaHref} className="btn-primary mt-3 inline-flex text-sm">{view.currentAction.ctaLabel ?? "Continue"}</a>
          )}
        </section>
      )}

      {/* Access Center */}
      {view.access.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-chalk-100">Access we need</h2>
          <div className="mt-3 space-y-3">
            {view.access.map((a) => (
              <div key={a.key} className="rounded-lg border border-white/[0.06] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-chalk-200">{a.label}</p>
                  <span className={"rounded px-2 py-0.5 text-[10px] " + (a.status === "received" || a.status === "RECEIVED" ? "bg-teal-400/15 text-teal-200" : "bg-amber-400/10 text-amber-200")}>{String(a.status).toLowerCase()}</span>
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] text-chalk-400">
                  {a.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-white/[0.03] p-3 text-[12px] text-chalk-400">
            <p className="font-medium text-chalk-300">We never ask for:</p>
            <p className="mt-0.5">{view.accessNeverAskFor.join(" · ")}</p>
            <p className="mt-2 text-chalk-500">{view.screenshotCredentialWarning}</p>
          </div>
        </section>
      )}

      {/* Completion */}
      {view.completionReport && (
        <section className="card border-teal-400/20 bg-teal-400/[0.04] p-4">
          <h2 className="text-sm font-semibold text-teal-200">Your fix is complete</h2>
          <p className="mt-1 text-[13px] text-chalk-300">{view.completionReport.issue}</p>
          {view.completionReport.changes.length > 0 && (
            <>
              <p className="mt-3 text-[12px] font-medium text-chalk-300">What we changed</p>
              <ul className="mt-1 space-y-1">{view.completionReport.changes.map((c, i) => <li key={i} className="text-[12px] text-chalk-400">• {c}</li>)}</ul>
            </>
          )}
          {view.completionReport.verification.length > 0 && (
            <>
              <p className="mt-3 text-[12px] font-medium text-chalk-300">What we verified</p>
              <ul className="mt-1 space-y-1">{view.completionReport.verification.map((c, i) => <li key={i} className="text-[12px] text-teal-300">✓ {c}</li>)}</ul>
            </>
          )}
          <p className="mt-3 text-[11px] text-chalk-500">Completed {view.completionReport.completedAt} · {view.accessCloseout}</p>
        </section>
      )}

      {/* Support */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold text-chalk-100">Support</h2>
        <p className="mt-1 text-[13px] text-chalk-400">Questions about your fix? We&apos;re here to help.</p>
        <a href={ARTIFEX_IDENTITY.bookingUrl} className="btn-secondary mt-2 inline-flex text-sm">Contact Artifex</a>
      </section>

      <p className="text-center text-[11px] text-chalk-600">{ARTIFEX_IDENTITY.companyName} · {view.revisionDeadline}</p>
    </div>
  );
}
