// The call script — always visible, never behind an accordion. Typeset to be read
// aloud while holding the phone: a bold opening line, a private purpose note, the
// few questions to ask, and skimmable branches for the common turns of a call.
import type { CallScript } from "@/lib/outreach/contact-strategy";

export function CallScriptCard({ script }: { script: CallScript }) {
  return (
    <section className="card p-5">
      <p className="eyebrow text-amber-300">What to say</p>

      {/* OPENING — the loudest thing in the script; what you actually say first. */}
      <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-300/80">Opening</p>
        <p className="mt-1.5 text-[16px] font-medium leading-relaxed text-chalk-50">“{script.opening}”</p>
      </div>

      {/* QUESTIONS — only what this call needs to resolve. */}
      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Ask</p>
        <ul className="mt-1.5 space-y-1.5">
          {script.questions.map((q, i) => (
            <li key={i} className="flex gap-2 text-[14px] leading-snug text-chalk-200">
              <span className="mt-0.5 shrink-0 tabular-nums text-chalk-600">{i + 1}.</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* BRANCHES — always visible and skimmable: the situation is the index, the
          line is exactly what to say. No accordion; readable mid-call. */}
      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">If…</p>
        <ul className="mt-2 space-y-2.5">
          {script.branches.map((b, i) => (
            <li key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2">
              <p className="text-[11.5px] font-semibold text-chalk-400">{b.situation}</p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-chalk-200">“{b.line}”</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
