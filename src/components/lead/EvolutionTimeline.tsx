// Evolution Timeline — a calm, vertical read of a business's long-term improvement
// arc. It reinforces that Artifex is a long-term partner, not a one-off vendor:
// immediate → near-term → strategic → future, plus where completed work will land.
// A reusable server component. Given the same EvolutionPlan it renders identically.
import { GitCommitVertical } from "lucide-react";

// Local prop shape (mirrors lib/intelligence/evolution.ts EvolutionPlan, but kept
// self-contained so this component stays decoupled from the engine internals).
type Horizon = "immediate" | "near-term" | "future";

interface EvolutionOpportunity {
  id: string;
  title: string;
  horizon: Horizon;
  domain: string;
  rationale: string;
  dependsOn: string[];
  suggestedEngagement: string;
}

interface EvolutionPlan {
  narrative: string;
  recommendedSequence: string[];
  opportunities: EvolutionOpportunity[];
}

const HORIZON_DOT: Record<Horizon, string> = {
  immediate: "bg-teal-400",
  "near-term": "bg-azure-400",
  future: "bg-amber-400",
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400">
      {children}
    </span>
  );
}

function OpportunityRow({ o }: { o: EvolutionOpportunity }) {
  return (
    <li className="relative pl-6">
      <span
        className={`absolute left-[-4.5px] top-1.5 h-2 w-2 rounded-full ring-4 ring-[#0b0b0f] ${HORIZON_DOT[o.horizon]}`}
      />
      <p className="text-sm font-medium text-chalk-100">{o.title}</p>
      <p className="mt-0.5 text-sm text-chalk-400">{o.rationale}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip>{o.suggestedEngagement}</Chip>
        {o.dependsOn.length > 0 && (
          <span className="text-[11px] text-chalk-500">Depends on earlier steps</span>
        )}
      </div>
    </li>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="label mb-3">{label}</p>
      <ul className="ml-1 space-y-4 border-l border-white/[0.08] pl-4">{children}</ul>
    </div>
  );
}

export function EvolutionTimeline({
  evolution,
}: {
  evolution: EvolutionPlan | null | undefined;
}) {
  if (!evolution || !evolution.opportunities || evolution.opportunities.length === 0) {
    return (
      <div className="card p-5">
        <p className="text-sm text-chalk-500">
          No evolution plan yet — generate the intelligence profile to see the roadmap.
        </p>
      </div>
    );
  }

  const opportunities = evolution.opportunities;
  const immediate = opportunities.filter((o) => o.horizon === "immediate");
  const nearTerm = opportunities.filter((o) => o.horizon === "near-term");
  const future = opportunities.filter((o) => o.horizon === "future");

  return (
    <div className="space-y-6">
      <Section label="Immediate Opportunities">
        {immediate.length > 0 ? (
          immediate.map((o) => <OpportunityRow key={o.id} o={o} />)
        ) : (
          <li className="pl-2 text-sm text-chalk-500">Nothing immediate — a healthy sign.</li>
        )}
      </Section>

      <Section label="Near-Term Improvements">
        {nearTerm.length > 0 ? (
          nearTerm.map((o) => <OpportunityRow key={o.id} o={o} />)
        ) : (
          <li className="pl-2 text-sm text-chalk-500">None mapped yet.</li>
        )}
      </Section>

      <Section label="Strategic Opportunities">
        {future.length > 0 ? (
          future.map((o) => <OpportunityRow key={o.id} o={o} />)
        ) : (
          <li className="pl-2 text-sm text-chalk-500">None mapped yet.</li>
        )}
      </Section>

      <div>
        <p className="label mb-3">Future Possibilities</p>
        <div className="ml-1 flex gap-3 border-l border-white/[0.08] pl-4">
          <GitCommitVertical size={16} className="mt-0.5 shrink-0 text-chalk-500" />
          <p className="text-sm leading-relaxed text-chalk-400">{evolution.narrative}</p>
        </div>
      </div>

      <div>
        <p className="label mb-3">Completed Improvements</p>
        <div className="ml-1 border-l border-white/[0.08] pl-4">
          <p className="text-sm text-chalk-500">
            None yet — this is where delivered work will appear.
          </p>
        </div>
      </div>
    </div>
  );
}
