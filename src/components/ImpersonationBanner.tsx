import { Eye } from "lucide-react";
import { session } from "@/lib/operators/session";
import { shortName } from "@/lib/operators/model";
import { ROLE_LABEL, roleOf } from "@/lib/operators/roles";
import { EndImpersonationButton } from "./EndImpersonationButton";

/**
 * "Viewing as <operator>" — the whole safety mechanism of impersonation.
 *
 * It is deliberately loud, deliberately at the top of every page, and
 * deliberately unclosable. The failure mode this prevents is not malice, it is
 * FORGETTING: a manager who wandered off, came back, and started working what
 * they believed was their own queue. Every write in that state is attributed to
 * the manager, so nothing is falsified — but the manager still deserves to know.
 */
export async function ImpersonationBanner() {
  const s = await session();
  if (!s.impersonating || !s.viewing) return null;

  const minutes = s.impersonationStartedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(s.impersonationStartedAt)) / 60_000))
    : null;

  return (
    <div className="sticky top-0 z-40 border-b border-amber-400/30 bg-amber-500/10 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
        <Eye size={14} className="shrink-0 text-amber-300" />
        <span className="font-medium text-amber-200">
          Viewing as {shortName(s.viewing)} · {ROLE_LABEL[roleOf(s.viewing)]}
        </span>
        <span className="text-amber-200/70">
          Everything you do is still recorded as {s.actor ? shortName(s.actor) : s.actorId}
          {minutes != null && ` · ${minutes}m`}
          {" · ends automatically after an hour"}
        </span>
        <EndImpersonationButton />
      </div>
    </div>
  );
}
