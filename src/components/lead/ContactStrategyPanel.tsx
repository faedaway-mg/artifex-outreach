// Primary Contact Strategy — shown when a business shouldn't begin with email.
// It recommends the first touch (with the signals behind the call), a short
// sequence so the operator never wonders what's next, and — for a call — a
// conversation starter and a one-tap dial. Understated; no marketing.
import { Phone, Mail, FileText, Instagram, Search, ArrowRight, ExternalLink } from "lucide-react";
import type { ContactStrategy, CallBrief, StrategyIcon, SignalTone } from "@/lib/outreach/contact-strategy";
import { CallOutcomeConsole, type Continuation } from "@/components/lead/CallOutcomeConsole";

const ICONS: Record<StrategyIcon, typeof Phone> = { phone: Phone, mail: Mail, form: FileText, instagram: Instagram, search: Search };
const DOT: Record<SignalTone, string> = { good: "bg-teal-400", warn: "bg-amber-400", muted: "bg-chalk-600" };
const TEXT: Record<SignalTone, string> = { good: "text-chalk-100", warn: "text-chalk-200", muted: "text-chalk-500" };

export function ContactStrategyPanel({
  leadId,
  strategy,
  brief,
  phone,
  contactFormUrl,
  instagramUrl,
  continuation,
}: {
  leadId: string;
  strategy: ContactStrategy;
  brief: CallBrief | null;
  phone: string | null;
  contactFormUrl?: string | null;
  instagramUrl?: string | null;
  /** Passed on the lead page so the outcome card can offer "Next lead"; omitted in the batch runner. */
  continuation?: Continuation;
}) {
  const Icon = ICONS[strategy.icon];
  const isCall = strategy.kind === "call-first";
  const isForm = strategy.kind === "contact-form-first";
  const isDm = strategy.kind === "instagram-dm-first";
  const nonEmail = isCall || isForm || isDm; // every non-email channel captures an email afterward
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

      {/* Conversation starter — for a call or a DM. Never a script. */}
      {(isCall || isDm) && brief && (
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">{isDm ? "A natural opener" : "A natural way in"}</p>
          <div className="mt-1.5 space-y-1.5 text-[13.5px] leading-relaxed text-chalk-200">
            <p>“{brief.opening}</p>
            <p>{brief.observation}</p>
            <p>{brief.transition} {brief.permissionQuestion}”</p>
          </div>
        </div>
      )}

      {/* The one channel-appropriate action for the first touch. */}
      {isCall && tel && (
        <a href={`tel:${tel}`} className="btn-primary mt-4 w-full justify-center !py-3 text-[15px]">
          <Phone size={16} /> Call {phone} <ArrowRight size={16} />
        </a>
      )}
      {isForm && contactFormUrl && (
        <a href={contactFormUrl} target="_blank" rel="noreferrer" className="btn-primary mt-4 w-full justify-center !py-3 text-[15px]">
          <FileText size={16} /> Open the contact form <ExternalLink size={14} />
        </a>
      )}
      {isDm && instagramUrl && (
        <a href={instagramUrl} target="_blank" rel="noreferrer" className="btn-primary mt-4 w-full justify-center !py-3 text-[15px]">
          <Instagram size={16} /> Open Instagram <ExternalLink size={14} />
        </a>
      )}

      {/* Contact capture — where the verified email lands after the first touch. */}
      {nonEmail && <div className="mt-4"><CallOutcomeConsole leadId={leadId} continuation={continuation} /></div>}
    </section>
  );
}
