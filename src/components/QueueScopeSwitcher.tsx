import Link from "next/link";
import type { ScopeOption } from "@/lib/operators/scope";

/**
 * Whose work is on screen. It is a link row, not a control panel: the queue
 * itself is the work, and switching views is a glance-and-move decision.
 *
 * Counts are always shown, including zero, because a view that silently hides
 * work is the one failure this whole system exists to prevent.
 */
export function QueueScopeSwitcher({ options, active, meaning }: { options: ScopeOption[]; active: string; meaning: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((o) => {
          const on = o.param === active;
          return (
            <Link
              key={o.param}
              href={o.param === "mine" ? "/" : `/?view=${o.param}`}
              className={
                on
                  ? "rounded-full bg-azure-500/15 px-3 py-1 text-xs font-medium text-azure-200 ring-1 ring-azure-400/30"
                  : "rounded-full px-3 py-1 text-xs text-chalk-400 hover:bg-white/[0.04] hover:text-chalk-200"
              }
            >
              {o.label}
              <span className={on ? "ml-1.5 text-azure-300/70" : "ml-1.5 text-chalk-600"}>{o.count}</span>
            </Link>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-chalk-500">{meaning}</p>
    </div>
  );
}
