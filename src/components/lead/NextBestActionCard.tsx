import Link from "next/link";
import { Sparkles, ArrowRight, Clock } from "lucide-react";
import type { NextAction, NextActionKind } from "@/lib/outreach/types";

// Where the primary CTA takes the operator — the relevant existing surface.
const HREF: Partial<Record<NextActionKind, (leadId: string) => string>> = {
  "prepare-review": () => "#deliverable",
  "record-video": () => "#video",
  "send-intro": (id) => `/leads/${id}/send`,
  "send-followup": () => "#outreach-kit",
  call: () => "#outreach-kit",
  "schedule-discovery": () => "#outreach-kit",
  "prepare-discovery": (id) => `/leads/${id}/discovery`,
};
const NO_BUTTON: NextActionKind[] = ["wait", "blocked", "nurture"];

/**
 * The momentum spine of the lead experience: one imperative, one why, one
 * invitation-style action, a calm progress rail. Everything else supports this.
 */
export function NextBestActionCard({ action, leadId }: { action: NextAction; leadId: string }) {
  const href = HREF[action.kind]?.(leadId);
  const showButton = !NO_BUTTON.includes(action.kind) && !!href;

  return (
    <section className="card relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-azure-500/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5 text-azure-300">
            <Sparkles size={13} /> Next best action
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-chalk-50">{action.title}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-chalk-400">{action.why}</p>
          {action.status && (
            <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[12px] text-chalk-500">
              <Clock size={12} /> {action.status}
            </p>
          )}
          {action.detail && <p className="mt-2 text-xs text-chalk-600">{action.detail}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          {showButton ? (
            <Link href={href!} className="btn-primary inline-flex items-center gap-2 !px-5 !py-2.5 text-sm">
              {action.ctaLabel} <ArrowRight size={15} />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm text-chalk-400">
              {action.kind === "wait" && <Clock size={14} className="text-teal-300" />}
              {action.ctaLabel}
            </span>
          )}
          {action.secondary[0] && (
            <span className="text-[12px] text-chalk-600">
              or {action.secondary[0].label.toLowerCase()}
              {action.secondary[0].hint ? ` — ${action.secondary[0].hint.toLowerCase()}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Calm progress rail */}
      <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-azure-500 to-teal-400 transition-all duration-700"
          style={{ width: `${Math.round(action.progress * 100)}%` }}
        />
      </div>
    </section>
  );
}
