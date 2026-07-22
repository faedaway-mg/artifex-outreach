// The explainability primitive — click backward from any conclusion to the exact
// memories behind it: what was learned, when, who confirmed it, and the confidence
// factors. Shared by the Strategist and the Roadmap so evidence always reads the same.
import { ChevronRight, Quote } from "lucide-react";
import type { RelationshipMemoryItem } from "@/lib/types";
import type { ConfidenceRead } from "@/lib/reasoning";

function fmtDate(at: string): string {
  const d = new Date(at);
  return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function EvidenceTrail({ memoryIds, items, confidence }: { memoryIds: string[]; items: RelationshipMemoryItem[]; confidence?: ConfidenceRead }) {
  const cited = memoryIds.map((id) => items.find((m) => m.id === id)).filter(Boolean) as RelationshipMemoryItem[];
  if (cited.length === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-chalk-500 hover:text-chalk-300">
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
        Why we believe this · {cited.length} {cited.length === 1 ? "memory" : "memories"}
      </summary>
      <div className="mt-2 space-y-2 border-l border-white/10 pl-3">
        {confidence && (
          <ul className="space-y-0.5">
            {confidence.factors.map((f, i) => (
              <li key={i} className="text-[11px] text-chalk-500"><span className="text-chalk-400">{f.label}</span> — {f.detail}</li>
            ))}
          </ul>
        )}
        {cited.map((m) => (
          <div key={m.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] font-medium text-chalk-200">{m.title}</p>
              <span className={`shrink-0 text-[10px] ${m.status === "Verified" ? "text-teal-300" : "text-amber-300"}`}>{m.status}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-chalk-400">{m.value}</p>
            <p className="mt-1 text-[10.5px] text-chalk-600">
              {m.confidence} confidence · via {m.source}
              {m.createdAt ? ` · learned ${fmtDate(m.createdAt)}` : ""}
            </p>
            {m.supportingContext && <p className="mt-0.5 flex gap-1 text-[10.5px] italic text-chalk-600"><Quote size={10} className="mt-0.5 shrink-0" /> “{m.supportingContext}”</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
