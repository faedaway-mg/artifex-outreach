import { Sparkles, Clock, PenLine } from "lucide-react";
import type { EmailQuality } from "@/lib/outreach/quality";

function Stars({ n }: { n: number }) {
  return (
    <span className="tracking-tight text-amber-300" aria-label={`${n} out of 5`}>
      {"★".repeat(n)}
      <span className="text-chalk-700">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/**
 * The approval decision-support panel: a human read on the writing so Jordan can
 * answer "would I personally send this?" in seconds. No implementation details.
 */
export function EmailQualityPanel({ quality, mode = "intro" }: { quality: EmailQuality; mode?: "intro" | "followup" }) {
  const band = quality.overall >= 80 ? "text-teal-300" : quality.overall >= 60 ? "text-amber-300" : "text-coral-300";
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-azure-300"><Sparkles size={13} /> Would I send this?</p>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-flex items-center gap-1 text-chalk-400"><Clock size={12} /> ~{quality.readingSeconds}s · {quality.wordCount} words</span>
          <span className={band}>Quality {quality.overall}/100</span>
        </div>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {quality.dimensions.map((d) => (
          <div key={d.name} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-chalk-200">{d.name}</p>
              <p className="text-[11px] leading-snug text-chalk-500">{d.detail}</p>
            </div>
            <Stars n={d.stars} />
          </div>
        ))}
      </div>

      {quality.whyItWorks.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-[11px] uppercase tracking-wide text-chalk-600">Why this {mode === "followup" ? "note" : "email"} works</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-chalk-400">
            {quality.whyItWorks.map((w) => <li key={w}>· {w}</li>)}
          </ul>
        </div>
      )}

      {quality.suggestedEdits.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-amber-300/80"><PenLine size={11} /> Worth a tweak</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-chalk-400">
            {quality.suggestedEdits.map((s) => <li key={s}>· {s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
