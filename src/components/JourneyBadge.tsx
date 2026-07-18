import { cn } from "@/lib/utils";
import { JOURNEY_META, type JourneyPhase } from "@/lib/journey";

export function JourneyBadge({ phase, showMotion }: { phase: JourneyPhase | null; showMotion?: boolean }) {
  if (!phase) return <span className="inline-flex items-center rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-chalk-500">Not proceeding</span>;
  const m = JOURNEY_META[phase];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", m.tone)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {phase}
      {showMotion && <span className="text-[10px] uppercase tracking-wide opacity-70">· {m.motion}</span>}
    </span>
  );
}
