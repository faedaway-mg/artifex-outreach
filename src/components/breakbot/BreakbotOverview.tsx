// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — RELEASE QA cockpit (§25). Server component (no interactivity): renders the
// synthetic journeys, business invariants, escaped-defect regressions and explainer
// coverage. The product rule (§28): the operator is not the routine final QA engineer —
// this shows what Breakbot catches so escaped defects become permanent regressions.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ShieldCheck, Users, ScrollText, Ban, Film, ArrowRight } from "lucide-react";
import type { EscapedDefect } from "@/lib/breakbot/escaped-defects";
import type { BusinessInvariant } from "@/lib/breakbot/business-invariants";

interface JourneyRow { id: string; persona: string; title: string; mandateRef: string; viewport: string; steps: number }
interface Coverage { total: number; healthy: number; blocked: number; missing: number; reviewed: number; notRun: number }

export function BreakbotOverview({
  escaped, escapedSummary, invariants, journeys, personaCount, coverage,
}: {
  escaped: EscapedDefect[];
  escapedSummary: { total: number; pendingDeploy: number };
  invariants: BusinessInvariant[];
  journeys: JourneyRow[];
  personaCount: number;
  coverage: Coverage;
}) {
  return (
    <div data-testid="breakbot-overview" className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-teal-300" />
          <h2 className="text-lg font-semibold text-chalk-50">Breakbot — Release QA authority</h2>
        </div>
        <p className="mt-1 text-sm text-chalk-400">
          Before a release reaches production, synthetic users exercise the candidate, media is sampled across full runtimes, business
          invariants are asserted, and every escaped defect is a permanent regression. Deploy is held unless the release-preflight passes;
          production gets a second safe smoke after. You are not the routine final QA engineer.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<Users size={14} />} n={`${journeys.length}`} label={`journeys · ${personaCount} personas`} />
          <Stat icon={<ScrollText size={14} />} n={`${invariants.length}`} label="business invariants" />
          <Stat icon={<Ban size={14} />} n={`${escapedSummary.total}`} label="escaped-defect regressions" />
          <Stat icon={<Film size={14} />} n={`${coverage.healthy}/${coverage.total}`} label="explainers healthy" />
        </div>
        <Link href="/launch/explainers" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 hover:text-teal-200">
          Open the Explainer QA Gallery <ArrowRight size={13} />
        </Link>
      </div>

      {/* Synthetic journeys (§3–§13). */}
      <Section title="Synthetic user journeys" subtitle="Breakbot drives the running release candidate as each persona (read-only; no sends, charges, or published content).">
        <div className="grid gap-2 sm:grid-cols-2">
          {journeys.map((j) => (
            <div key={j.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-chalk-100">{j.title}</p>
                <span className="shrink-0 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-chalk-400">{j.mandateRef}</span>
              </div>
              <p className="mt-1 text-[11px] text-chalk-500">{j.persona} · {j.viewport} · {j.steps} steps</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Business invariants (§15). */}
      <Section title="Business-contract invariants" subtitle="Asserted on every relevant release.">
        <ul className="space-y-1.5">
          {invariants.map((inv) => (
            <li key={inv.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-teal-300">✓</span>
              <span className="text-chalk-300">{inv.rule}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Escaped-defect registry (§29). */}
      <Section title="Escaped-defect registry" subtitle={`Every escaped defect is now a permanent regression (${escapedSummary.pendingDeploy} pending this deploy).`}>
        <div className="space-y-2">
          {escaped.map((d) => (
            <div key={d.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-chalk-100">{d.id}</p>
                <span className="shrink-0 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-chalk-400">{d.surface} · {d.firstCovered}</span>
              </div>
              <p className="mt-1 text-xs text-chalk-400">{d.defectClass}</p>
              <p className="mt-1 text-[11px] text-chalk-600">covered by {d.coveredBy.length} guard(s)</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Stat({ icon, n, label }: { icon: React.ReactNode; n: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-chalk-400">{icon}<span className="text-[11px]">{label}</span></div>
      <p className="mt-1 text-xl font-semibold text-chalk-50">{n}</p>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-chalk-100">{title}</p>
      <p className="mt-0.5 text-xs text-chalk-500">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
