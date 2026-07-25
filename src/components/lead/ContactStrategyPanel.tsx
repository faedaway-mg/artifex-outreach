// Primary Contact Strategy — shown when a business shouldn't begin with email.
// It recommends the first touch (with the signals behind the call), a short
// sequence so the operator never wonders what's next, and — for a call — a
// conversation starter and a one-tap dial. Understated; no marketing.
import { Phone, Mail, FileText, Instagram, ArrowRight } from "lucide-react";
import type { ContactStrategy, CallBrief, StrategyIcon, SignalTone } from "@/lib/outreach/contact-strategy";
import { CallOutcomeForm } from "@/components/lead/CallOutcomeForm";

const ICONS: Record<StrategyIcon, typeof Phone> = { phone: Phone, mail: Mail, form: FileText, instagram: Instagram };
const DOT: Record<SignalTone, string> = { good: "bg-teal-400", warn: "bg-amber-400", muted: "bg-chalk-600" };
const TEXT: Record<SignalTone, string> = { good: "text-chalk-100", warn: "text-chalk-200", muted: "text-chalk-500" };

export function ContactStrategyPanel({
  leadId,
  strategy,
  callBrief,
  phone,
}: {
  leadId: string;
  strategy: ContactStrategy;
  callBrief: CallBrief | null;
  phone: string | null;
}) {
  const Icon = ICONS[strategy.icon];
  const isCall = strategy.kind === "call-first";
  const tel = phone ? phone.replace(/[^\d+]/g, "") : null;

  return (
    <section id="contact-strategy" className="card scroll-mt-4 p-5">
      <p className="eyebrow text-amber-300">Primary contact strategy</p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/12 text-amber-300"><Icon size={18} /></span>
        <h2 className="text-[1.3rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{strategy.primaryLabel}</h2>
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-300">{strategy.reason}</p>

      {/* Contact signals — action-shaped, not "missing data" */}
      <dl className="mt-4 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {strategy.signals.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-1">
            <dt className="text-[12px] text-chalk-500">{s.label}</dt>
            <dd className={`inline-flex items-center gap-1.5 text-[12.5px] ${TEXT[s.tone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.tone]}`} /> {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Recommended sequence */}
      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Recommended sequence</p>
        <ol className="mt-1.5 space-y-1">
          {strategy.sequence.map((step, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-chalk-300">
              <span className="mt-px shrink-0 tabular-nums text-chalk-600">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Call brief — a conversation starter, not a script */}
      {isCall && callBrief && (
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">A natural way in</p>
          <div className="mt-1.5 space-y-1.5 text-[13.5px] leading-relaxed text-chalk-200">
            <p>“{callBrief.opening}</p>
            <p>{callBrief.observation}</p>
            <p>{callBrief.transition} {callBrief.permissionQuestion}”</p>
          </div>
        </div>
      )}

      {/* One-tap dial for a call-first lead */}
      {isCall && tel && (
        <a href={`tel:${tel}`} className="btn-primary mt-4 w-full justify-center !py-3 text-[15px]">
          <Phone size={16} /> Call {phone} <ArrowRight size={16} />
        </a>
      )}

      {/* Contact capture — where the verified email lands after the call. */}
      {isCall && <CallOutcomeForm leadId={leadId} />}
    </section>
  );
}
