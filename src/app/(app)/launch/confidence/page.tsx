// Phase 7 — Final Launch Confidence. Scores every dimension and gives one verdict.
import { launchConfidence } from "@/lib/launch/confidence";
import { ScoreBar, StatusPill } from "@/components/launch/LaunchUI";

export const dynamic = "force-dynamic";

export default async function ConfidencePage() {
  const c = await launchConfidence();
  const ready = c.recommendation === "READY TO LAUNCH";

  return (
    <div className="space-y-6">
      <div className={`card relative overflow-hidden p-6 ${ready ? "border-teal-400/30" : "border-coral-400/30"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="label">Overall recommendation</p>
            <p className={`mt-1 text-2xl font-semibold ${ready ? "text-teal-200" : "text-coral-200"}`}>{c.recommendation}</p>
            <p className="mt-1 text-sm text-chalk-400">
              {ready ? "Every dimension is clear of blockers." : `${c.blockingIssues.length} blocking issue(s) must be resolved first.`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-4xl font-semibold tabular-nums text-chalk-50">{c.overallScore}<span className="text-lg text-chalk-600">/100</span></p>
            <p className="text-xs text-chalk-500">confidence score</p>
          </div>
        </div>
      </div>

      {c.blockingIssues.length > 0 && (
        <div className="card border-coral-400/30 p-5">
          <p className="mb-2 text-sm font-semibold text-coral-200">Blocking issues</p>
          <ul className="space-y-2">
            {c.blockingIssues.map((b) => (
              <li key={b.id} className="flex items-start gap-2.5">
                <StatusPill status="fail" />
                <div className="min-w-0"><p className="text-sm text-chalk-100">{b.label}</p><p className="text-xs text-chalk-500">{b.detail}</p></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {c.categories.map((cat) => (
          <ScoreBar key={cat.name} name={cat.name} score={cat.score} status={cat.status} rationale={cat.rationale} />
        ))}
      </div>
      <p className="text-xs text-chalk-600">
        Testing scores appear only when the toolchain is run via <code className="text-chalk-400">pnpm launch:validate --toolchain</code>. A single failing check in any dimension makes the platform NOT READY.
      </p>
    </div>
  );
}
