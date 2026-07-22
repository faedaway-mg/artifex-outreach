import { Mail, Video, Phone, Compass, Gauge, User2, ChevronRight, MessageSquare } from "lucide-react";
import type { OutreachKit, ConfidenceScore } from "@/lib/outreach/types";

function bandColor(band: ConfidenceScore["band"]): string {
  return band === "Strong" ? "text-teal-300" : band === "Adequate" ? "text-amber-300" : "text-coral-300";
}
function barColor(band: ConfidenceScore["band"]): string {
  return band === "Strong" ? "bg-teal-400" : band === "Adequate" ? "bg-amber-400" : "bg-coral-400";
}

function Section({ icon, title, meta, children, open = false }: { icon: React.ReactNode; title: string; meta?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-t border-white/[0.06] py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm font-medium text-chalk-200 marker:hidden">
        <ChevronRight size={15} className="text-chalk-500 transition-transform group-open:rotate-90" />
        <span className="text-chalk-400">{icon}</span>
        {title}
        {meta && <span className="ml-auto text-[12px] font-normal text-chalk-500">{meta}</span>}
      </summary>
      <div className="mt-3 pl-[26px] text-sm leading-relaxed text-chalk-300">{children}</div>
    </details>
  );
}

function EmailBlock({ subject, alternatives, body }: { subject: string; alternatives: string[]; body: string }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-chalk-600">Subject</p>
        <p className="text-chalk-100">{subject}</p>
        {alternatives.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[12px] text-chalk-500">
            {alternatives.map((a) => (
              <li key={a}>· {a}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[13px] text-chalk-300">{body}</div>
    </div>
  );
}

/**
 * Everything the operator might want — collapsed by default so it supports the
 * action instead of competing with it. Read less, do more.
 */
export function OutreachKitPanel({ kit }: { kit: OutreachKit }) {
  const dm = kit.decisionMaker;
  const conf = kit.confidence;

  return (
    <section id="outreach-kit" className="card p-5 scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-chalk-100">
          <Mail size={15} className="text-azure-300" /> Outreach kit
        </h3>
        <span className={`text-[12px] ${conf.overall >= 70 ? "text-teal-300" : conf.overall >= 45 ? "text-amber-300" : "text-coral-300"}`}>
          Readiness {conf.overall}/100
        </span>
      </div>
      <p className="mt-1 text-[13px] text-chalk-500">{conf.summary}</p>

      <div className="mt-3">
        <Section icon={<User2 size={14} />} title="Decision maker" meta={dm.identified ? `${dm.confidence}/100` : "not identified"}>
          <p className="text-chalk-300">{dm.note}</p>
          {dm.primary && dm.identified && (
            <div className="mt-2 space-y-0.5 text-[13px] text-chalk-400">
              <p className="text-chalk-200">{dm.primary.name} · {dm.primary.role}</p>
              <p>Reach in order: {dm.primary.preferredContactOrder.join(" → ") || "no public route"}</p>
              {dm.primary.officeEmail && <p>Office: {dm.primary.officeEmail}</p>}
              {dm.primary.linkedinUrl && <p>LinkedIn: {dm.primary.linkedinUrl}</p>}
            </div>
          )}
        </Section>

        <Section icon={<Mail size={14} />} title="Introduction email" meta={`${kit.email.wordCount} words`} open>
          <EmailBlock subject={kit.email.subject} alternatives={kit.email.subjectAlternatives} body={kit.email.body} />
        </Section>

        <Section icon={<MessageSquare size={14} />} title="Follow-up email">
          <EmailBlock subject={kit.followUp.subject} alternatives={kit.followUp.subjectAlternatives} body={kit.followUp.body} />
        </Section>

        {kit.video && (
          <Section icon={<Video size={14} />} title="Personal video script" meta={`~${kit.video.estimatedSeconds}s to record`}>
            <div className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[13px] text-chalk-300">{kit.video.script}</div>
            <p className="mt-2 text-[12px] text-chalk-500">Email note: {kit.video.emailVariant}</p>
          </Section>
        )}

        <Section icon={<Phone size={14} />} title="Phone guide" meta="follow-up conversation">
          <p className="mb-2 text-[12px] italic text-chalk-500">If asked what it's about: “{kit.phone.whatThisIsAbout}”</p>
          <div className="space-y-3">
            {kit.phone.stages.map((st) => (
              <div key={st.audience} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[12px] font-medium text-chalk-200">{st.title}</p>
                <p className="text-[11px] text-chalk-600">{st.goal}</p>
                {st.steps.map((step, i) => (
                  <div key={i} className="mt-2">
                    <p className="text-[13px] text-chalk-300">{step.say}</p>
                    {step.branches.map((b, j) => (
                      <p key={j} className="mt-1 pl-3 text-[12px] text-chalk-500">
                        <span className="text-chalk-600">{b.when}:</span> {b.say}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<Compass size={14} />} title="Discovery questions" meta={`${kit.discovery.questions.length}`}>
          <p className="mb-2 text-[12px] italic text-chalk-500">{kit.discovery.opening}</p>
          <ul className="space-y-1.5">
            {kit.discovery.questions.map((q, i) => (
              <li key={i} className="text-[13px] text-chalk-300">
                {q.question}
                <span className="block text-[11px] text-chalk-600">{q.intent}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={<Gauge size={14} />} title="Operator confidence" meta={`${conf.overall}/100`}>
          <div className="space-y-2">
            {conf.scores.map((s) => (
              <div key={s.dimension}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-chalk-400">{s.dimension}{s.betterIsLower ? " (lower is better)" : ""}</span>
                  <span className={bandColor(s.band)}>{s.score} · {s.band}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={`h-full rounded-full ${barColor(s.band)}`} style={{ width: `${s.betterIsLower ? 100 - s.score : s.score}%` }} />
                </div>
                {s.howToImprove && <p className="mt-0.5 text-[11px] text-chalk-600">Fix: {s.howToImprove}</p>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </section>
  );
}
