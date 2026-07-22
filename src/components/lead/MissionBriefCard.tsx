import { Compass, Target, MessageCircle, HelpCircle, ShieldAlert, TrendingUp, CheckCircle2 } from "lucide-react";
import type { MissionBrief } from "@/lib/outreach/mission-brief";

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">
        <span className="text-azure-300">{icon}</span> {title}
      </p>
      <div className="mt-1.5 text-[13.5px] leading-relaxed text-chalk-300">{children}</div>
    </div>
  );
}

/**
 * The Discovery Mission Brief — everything Jordan needs to walk in as the most
 * prepared person in the room. Quiet, one-page, printable.
 */
export function MissionBriefCard({ brief, businessName }: { brief: MissionBrief; businessName: string }) {
  return (
    <section className="card p-6">
      <div className="flex items-center gap-2">
        <Compass size={16} className="text-azure-300" />
        <h2 className="text-sm font-semibold text-chalk-100">Mission brief — {businessName}</h2>
        <span className="ml-auto text-[11px] text-chalk-600">Read before the conversation</span>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-chalk-200">{brief.executiveSummary}</p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Section icon={<Target size={13} />} title="What success looks like">
          {brief.meetingGoal}
        </Section>
        <Section icon={<MessageCircle size={13} />} title="How to open">
          <span className="italic text-chalk-200">“{brief.recommendedOpening}”</span>
        </Section>
      </div>

      <div className="mt-5">
        <Section icon={<HelpCircle size={13} />} title="First questions — let each answer lead the next">
          <ol className="mt-1 space-y-1.5">
            {brief.firstQuestions.map((q, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[10px] text-chalk-500">{i + 1}</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Section icon={<ShieldAlert size={13} />} title="Don't assume — verify">
          <ul className="space-y-1">
            {brief.assumptionsToAvoid.map((a, i) => <li key={i} className="text-chalk-400">· {a}</li>)}
          </ul>
        </Section>
        <Section icon={<TrendingUp size={13} />} title="Likely priorities">
          <ul className="space-y-2">
            {brief.likelyPriorities.map((p) => (
              <li key={p.label}>
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-chalk-300">{p.label}</span>
                  <span className="text-[11px] text-chalk-500">{p.confidence}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-teal-400" style={{ width: `${p.confidence}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="mt-5 rounded-xl border border-teal-400/15 bg-teal-400/[0.04] p-3.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-300"><CheckCircle2 size={13} /> Success criteria</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-200">{brief.successCriteria}</p>
      </div>
    </section>
  );
}
