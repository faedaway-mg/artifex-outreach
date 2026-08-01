import { UserCheck, History } from "lucide-react";
import type { Operator } from "@/lib/types";
import type { TimelineEvent } from "@/lib/operators/timeline";
import { shortName, initialsOf } from "@/lib/operators/model";
import { TransferControl } from "@/components/lead/TransferControl";
import { relativeDate } from "@/lib/utils";

const KIND_TONE: Record<TimelineEvent["kind"], string> = {
  ownership: "bg-azure-400",
  outreach: "bg-indigo-400",
  response: "bg-emerald-400",
  work: "bg-chalk-500",
  meeting: "bg-teal-400",
};

/**
 * Who is accountable for this business, and everything that has happened to it.
 *
 * The timeline is deliberately the whole operational history rather than just
 * ownership changes: someone inheriting this business needs the story, not a
 * custody log. Nothing here disappears when it changes hands.
 */
export function OwnershipPanel({
  owner,
  operators,
  leadId,
  assignedAt,
  assignmentReason,
  lastOperatorActivityAt,
  events,
}: {
  owner: Operator | null;
  operators: Operator[];
  leadId: string;
  assignedAt: string | null;
  assignmentReason: string | null;
  lastOperatorActivityAt: string | null;
  events: TimelineEvent[];
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-azure-500/15 text-xs font-semibold text-azure-200 ring-1 ring-azure-400/25">
            {owner ? initialsOf(owner) : "—"}
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-chalk-100">
              <UserCheck size={14} className="text-azure-300" />
              {owner ? `${shortName(owner)} is accountable` : "Nobody is accountable yet"}
            </p>
            <p className="mt-0.5 text-[11px] text-chalk-500">
              {assignmentReason ?? "No assignment reason recorded."}
              {assignedAt && ` · since ${relativeDate(assignedAt)}`}
              {lastOperatorActivityAt && ` · last worked ${relativeDate(lastOperatorActivityAt)}`}
            </p>
          </div>
        </div>
        <TransferControl leadId={leadId} currentOwnerId={owner?.id ?? null} operators={operators} />
      </div>

      <div className="mt-5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-chalk-300">
          <History size={13} /> Team timeline
        </h3>
        {events.length === 0 ? (
          <p className="mt-2 text-[11px] text-chalk-500">Nothing has happened with this business yet.</p>
        ) : (
          <ol className="mt-3 space-y-2.5">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-3">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND_TONE[e.kind]}`} />
                <div className="min-w-0">
                  <p className="text-xs text-chalk-200">
                    {e.label}
                    {e.actor && <span className="text-chalk-500"> · {e.actor}</span>}
                  </p>
                  {e.detail && <p className="truncate text-[11px] text-chalk-600">{e.detail}</p>}
                  <p className="text-[11px] text-chalk-600">{relativeDate(e.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
