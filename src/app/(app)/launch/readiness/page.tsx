// Phase 2 — Launch Readiness Checklist. Verifies the whole platform before live
// outreach, exercising the real intelligence engine and outreach generation, and
// ending on the explicit human sign-off.
import { readinessChecklist } from "@/lib/launch/readiness";
import { getSettings } from "@/lib/repo";
import { ChecklistSection, StatusPill, RollupBadge } from "@/components/launch/LaunchUI";
import { ManualReviewToggle } from "@/components/launch/ManualReviewToggle";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  const [result, settings] = await Promise.all([readinessChecklist(), getSettings()]);
  const confirmed = Boolean(settings.launchReviewConfirmedAt);

  return (
    <div className="space-y-6">
      <div data-testid="launch-readiness-gate" className={`card flex flex-wrap items-center justify-between gap-3 p-5 ${result.ready ? "border-teal-400/30" : "border-amber-400/30"}`}>
        <div className="flex items-center gap-3">
          <StatusPill status={result.rollup.status} label={result.ready ? "READY" : "NOT READY"} />
          <div>
            <p className="text-sm font-semibold text-chalk-100">{result.ready ? "All checks pass and the human sign-off is recorded." : "Resolve failing checks and record the sign-off before live outreach."}</p>
            <p className="text-xs text-chalk-500">{result.rollup.total} checks across {result.sections.length} sections.</p>
          </div>
        </div>
        <RollupBadge rollup={result.rollup} />
      </div>

      <ManualReviewToggle confirmed={confirmed} confirmedAt={settings.launchReviewConfirmedAt} />

      <div className="grid gap-4 lg:grid-cols-2">
        {result.sections.map((s) => <ChecklistSection key={s.name} section={s} />)}
      </div>
    </div>
  );
}
