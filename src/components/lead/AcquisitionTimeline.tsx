import type { TimelineEvent } from "@/lib/acquisition/timeline";
import { GitCommitVertical } from "lucide-react";

const TONE: Record<string, string> = {
  discovered: "bg-chalk-500", analyzed: "bg-azure-400", brief: "bg-indigo-400", video: "bg-indigo-400",
  concept: "bg-indigo-400", plan: "bg-amber-400", approved: "bg-teal-400", stopped: "bg-coral-400",
  outreach: "bg-azure-400", reply: "bg-teal-400", meeting: "bg-amber-400", proposal: "bg-amber-300",
  won: "bg-teal-400", lost: "bg-coral-400",
};

export function AcquisitionTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-chalk-100"><GitCommitVertical size={16} className="text-azure-300" /> Acquisition timeline</h2>
      {events.length === 0 ? (
        <p className="text-sm text-chalk-500">No activity recorded yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-white/[0.08] pl-4">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${TONE[e.kind] ?? "bg-chalk-500"}`} />
              <p className="text-sm text-chalk-200">{e.label}</p>
              <p className="text-[11px] text-chalk-500">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
