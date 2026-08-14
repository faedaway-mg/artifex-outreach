// ─────────────────────────────────────────────────────────────────────────────
// The work queue — today's work, grouped into focused batches.
//
// Each card is one kind of work: what it is, how many, how long it'll take, and one
// button that drops straight into a batch flow. Sorted so the most urgent sits on top.
// Big tap targets, one-handed, nothing to decide — just pick a batch and go.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { Video, Mail, RotateCcw, FileText, Phone, CalendarClock, Compass, ArrowRight, Coffee, Clock, Instagram, MessageSquare } from "lucide-react";
import type { WorkCategory, WorkKind } from "@/lib/work-queue";
import { minutesLabel } from "@/lib/work-queue";

const ICON: Record<WorkKind, typeof Video> = {
  reply: MessageSquare, discovery: CalendarClock, "follow-up": RotateCcw, email: Mail, report: FileText, call: Phone,
  "contact-form": FileText, "instagram-dm": Instagram, video: Video, understand: Compass,
};

export function WorkQueue({ categories }: { categories: WorkCategory[] }) {
  if (categories.length === 0) {
    return (
      <section className="card p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.05] text-chalk-400"><Coffee size={26} strokeWidth={1.8} /></span>
        <h1 className="mt-4 text-xl font-semibold text-chalk-50">You're clear.</h1>
        <p className="mt-1.5 text-[14px] text-chalk-400">No work is waiting right now. Get ahead by understanding a few new businesses.</p>
        <Link href="/discover" className="btn-primary mt-5 justify-center !py-2.5"><Compass size={16} /> Find businesses</Link>
      </section>
    );
  }

  const totalMin = categories.reduce((s, c) => s + c.estMinutes, 0);

  return (
    <div className="space-y-3">
      <p className="px-1 text-[12.5px] text-chalk-500">
        {categories.reduce((s, c) => s + c.count, 0)} things to do today{totalMin > 0 && <> · about {minutesLabel(totalMin)}</>}
      </p>
      {categories.map((c) => {
        const Icon = ICON[c.kind];
        return (
          <Link
            key={c.kind}
            href={c.href}
            className="card group flex items-center gap-4 p-4 transition-colors hover:border-white/15 hover:bg-white/[0.02] sm:p-5"
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${c.timeBound ? "bg-teal-400/12 text-teal-300" : "bg-azure-400/10 text-azure-300"}`}>
              <Icon size={20} strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-chalk-50">{c.title}</h2>
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-chalk-200">{c.count}</span>
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-chalk-500">{c.blurb}</p>
              {c.estMinutes > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-chalk-600"><Clock size={11} /> about {minutesLabel(c.estMinutes)}</p>
              )}
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-azure-500/10 px-3 py-2 text-[12.5px] font-medium text-azure-200 transition-colors group-hover:bg-azure-500/20 sm:inline-flex">
              {c.ctaLabel} <ArrowRight size={14} />
            </span>
            <ArrowRight size={18} className="shrink-0 text-chalk-500 sm:hidden" />
          </Link>
        );
      })}
    </div>
  );
}
