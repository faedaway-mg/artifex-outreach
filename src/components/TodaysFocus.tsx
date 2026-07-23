// ─────────────────────────────────────────────────────────────────────────────
// Today's Focus — the command center, not an information center.
//
// One task. One reason it matters. One button. Nothing competes with it. This is the
// chief-of-staff moment: "I've looked through everything — here's what to do next."
// Built mobile-first: the whole first screen is this single decision.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { Video, Mail, Phone, RotateCcw, Compass, CalendarClock, FileText, Coffee, ArrowRight } from "lucide-react";
import type { TodaysFocus as Focus, FocusKind } from "@/lib/today";

const ICON: Record<FocusKind, typeof Video> = {
  conversation: CalendarClock, video: Video, approve: Mail, call: Phone, "follow-up": RotateCcw,
  review: Compass, "prepare-meeting": Compass, "prepare-proposal": FileText, clear: Coffee,
};

export function TodaysFocus({ focus, dateLabel }: { focus: Focus; dateLabel: string }) {
  const Icon = ICON[focus.kind];
  const clear = focus.kind === "clear";

  return (
    <section className="card relative overflow-hidden p-6 md:p-10">
      <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-azure-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-48 rounded-full bg-indigo-500/[0.07] blur-3xl" />

      <div className="relative mx-auto flex max-w-lg flex-col items-center py-4 text-center md:py-8">
        <p className="eyebrow">{dateLabel}</p>

        <span className={`mt-5 grid h-14 w-14 place-items-center rounded-2xl ${clear ? "bg-white/[0.05] text-chalk-400" : "bg-gradient-to-br from-azure-400/90 to-indigo-500/90 text-white shadow-glow-azure"}`}>
          <Icon size={26} strokeWidth={1.8} />
        </span>

        <h1 className="mt-5 text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-chalk-50 md:text-[2rem]">
          {focus.headline}
        </h1>
        <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-chalk-300">{focus.why}</p>

        <Link
          href={focus.ctaHref}
          className="btn-primary mt-7 w-full justify-center !py-3 text-[15px] sm:w-auto sm:!px-8"
        >
          {focus.ctaLabel} <ArrowRight size={17} />
        </Link>

        {focus.remaining > 0 ? (
          <a href="#everything" className="mt-4 text-[12.5px] text-chalk-500 underline-offset-4 hover:text-chalk-300 hover:underline">
            {focus.remaining} more {focus.remaining === 1 ? "thing" : "things"} after this — I'll bring them up when you're ready
          </a>
        ) : (
          !clear && <p className="mt-4 text-[12.5px] text-chalk-600">This is the last thing on your list.</p>
        )}
      </div>
    </section>
  );
}
