import Link from "next/link";
import type { DemoWalkthrough as DemoWalkthroughVM } from "@/lib/quick-fix/demo-fulfillment";

// Presentational renderer for ONE guided DEMO A/B/C walkthrough (§46–§48). Server /
// presentational only (no state): renders the ordered lifecycle steps, the unmissable
// isolation badges, a "Preview Customer Portal" link per customer-facing state, a link
// into the SAME technician workspace real jobs use, and a Reset control that re-seeds
// the scenario. Nothing here is ever mixed with a real revenue count.

export function DemoWalkthrough({ walkthrough: w }: { walkthrough: DemoWalkthroughVM }) {
  return (
    <section
      data-testid={`demo-walkthrough-${w.scenarioKey}`}
      className="card p-4 space-y-3"
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Demo {w.letter}</div>
            <h2 className="mt-0.5 text-[16px] font-semibold text-chalk-50">{w.title}</h2>
            <div className="mt-0.5 text-[12px] text-chalk-500">{w.company}</div>
          </div>
        </div>

        {/* Unmissable isolation badges — DEMO / NO REAL CUSTOMER / NO CHARGE / NO EXTERNAL MESSAGE */}
        <div className="flex flex-wrap gap-1.5">
          {w.badges.map((b) => (
            <span
              key={b}
              data-testid="demo-badge"
              className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-200"
            >
              {b}
            </span>
          ))}
        </div>

        <p className="text-[12px] leading-relaxed text-chalk-400">{w.summary}</p>
      </header>

      {/* Ordered guided steps, in lifecycle order. */}
      <ol className="space-y-1.5">
        {w.steps.map((s, i) => {
          const flag = s.isCustomerWaiting
            ? "Waiting on customer"
            : s.isAdditionalDecision
              ? "Decision needed"
              : null;
          return (
            <li
              key={s.id}
              data-testid={`demo-step-${s.id}`}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-chalk-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-chalk-100">{s.label}</span>
                    <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-chalk-500">{s.state}</span>
                    {flag ? (
                      <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">{flag}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-chalk-500">{s.detail}</p>
                  {s.showsCustomerPortal && w.portalHref ? (
                    <Link
                      href={w.portalHref}
                      className="mt-1.5 inline-block text-[11.5px] text-azure-300 hover:text-azure-200"
                    >
                      Preview Customer Portal →
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Actions: open the SAME technician workspace real jobs use + Reset. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {w.workspaceHref ? (
          <Link
            href={w.workspaceHref}
            className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-semibold text-chalk-100 hover:bg-white/[0.10]"
          >
            Open technician workspace →
          </Link>
        ) : null}
        <Link
          href={w.resetHref}
          className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] text-chalk-400 hover:text-chalk-200"
        >
          Reset demo
        </Link>
      </div>
    </section>
  );
}

export default DemoWalkthrough;
