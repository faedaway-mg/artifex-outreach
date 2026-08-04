"use client";
// The live call assistant.
//
// A cold call forks on the second word, so a script read top to bottom is useless
// the moment reception says something unexpected. Here the operator taps what just
// happened and the words to say next appear — large enough to read aloud while
// holding a phone, with nothing else competing for the eye.
//
// Everything on this panel is a DRAFT (see call-conversation.ts). Tapping writes
// nothing. That is deliberate: the operator is mid-call, guessing at what the person
// on the other end meant, and will tap the wrong thing. Back and Undo are free.
import { ChevronDown, CornerUpLeft, RotateCcw, Quote } from "lucide-react";
import {
  EVENT_LABEL,
  toneOf,
  guidanceFor,
  type CallEvent,
  type CallSession,
  type CallCaptured,
  type CaptureField,
} from "@/lib/outreach/call-conversation";
import { CallScriptCard } from "@/components/lead/CallScriptCard";
import type { CallScript } from "@/lib/outreach/contact-strategy";

const TONE_BTN: Record<"good" | "neutral" | "bad", string> = {
  good: "border-teal-400/40 bg-teal-400/[0.08] text-teal-200 hover:bg-teal-400/[0.14]",
  neutral: "border-white/10 text-chalk-300 hover:border-white/25 hover:text-chalk-100",
  bad: "border-coral-400/35 bg-coral-400/[0.06] text-coral-200 hover:bg-coral-400/[0.12]",
};

const FIELD_LABEL: Record<CaptureField, string> = {
  generalEmail: "General email",
  directEmail: "Direct email",
  contactName: "Their name",
  contactRole: "Their role",
  transferTo: "Transferred to",
  callbackWindow: "Best time to call back",
  languageOther: "Which language",
  interest: "What they said, in their words",
  notes: "Notes",
};

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

const chip = (active: boolean) =>
  `rounded-lg border px-2.5 py-1.5 text-[12.5px] capitalize ${active ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-chalk-400 hover:text-chalk-200"}`;

export function CallConversation({
  session,
  businessName,
  observation,
  script,
  onEvent,
  onTruncate,
  onUndo,
  onCapture,
}: {
  session: CallSession;
  businessName: string;
  observation?: string | null;
  /** The full written guide, kept as collapsed reference beneath the live assistant. */
  script: CallScript;
  onEvent: (e: CallEvent) => void;
  onTruncate: (index: number) => void;
  onUndo: () => void;
  onCapture: (patch: CallCaptured) => void;
}) {
  const g = guidanceFor(session.path, { businessName, observation });
  const c = session.captured;
  const started = session.path.length > 0;

  const field = (f: CaptureField) => {
    switch (f) {
      case "contactRole":
        return (
          <div key={f}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">{FIELD_LABEL[f]}</p>
            <div className="flex flex-wrap gap-1.5">
              {(["owner", "manager", "assistant"] as const).map((r) => (
                <button key={r} type="button" onClick={() => onCapture({ contactRole: c.contactRole === r ? undefined : r })} className={chip(c.contactRole === r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        );
      case "transferTo":
        return (
          <div key={f}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">{FIELD_LABEL[f]}</p>
            <div className="flex flex-wrap gap-1.5">
              {(["owner", "manager", "department", "unknown"] as const).map((r) => (
                <button key={r} type="button" onClick={() => onCapture({ transferTo: c.transferTo === r ? undefined : r })} className={chip(c.transferTo === r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        );
      case "notes":
      case "interest":
        return (
          <textarea
            key={f}
            value={(f === "notes" ? c.notes : c.interest) ?? ""}
            onChange={(e) => onCapture(f === "notes" ? { notes: e.target.value } : { interest: e.target.value })}
            placeholder={FIELD_LABEL[f]}
            rows={2}
            className={input}
          />
        );
      default: {
        const isEmail = f === "generalEmail" || f === "directEmail";
        return (
          <input
            key={f}
            value={(c[f] as string | undefined) ?? ""}
            onChange={(e) => onCapture({ [f]: e.target.value } as CallCaptured)}
            placeholder={FIELD_LABEL[f]}
            type={isEmail ? "email" : "text"}
            inputMode={isEmail ? "email" : undefined}
            autoCapitalize={isEmail ? "none" : undefined}
            className={input}
          />
        );
      }
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <p className="eyebrow text-azure-300">On the call</p>
        {started && (
          <button
            type="button"
            onClick={onUndo}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11.5px] text-chalk-500 hover:border-white/25 hover:text-chalk-200"
          >
            <CornerUpLeft size={12} /> Undo
          </button>
        )}
      </div>

      {/* WHERE YOU ARE — tap any step to go back to it. Nothing is lost either way. */}
      {started && (
        <ol className="mt-2.5 flex flex-wrap items-center gap-1 text-[11.5px]">
          <li>
            <button type="button" onClick={() => onTruncate(0)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-chalk-600 hover:bg-white/[0.06] hover:text-chalk-300">
              <RotateCcw size={11} /> Start
            </button>
          </li>
          {session.path.map((e, i) => (
            <li key={`${e}-${i}`} className="flex items-center gap-1">
              <span className="text-chalk-700">›</span>
              <button
                type="button"
                onClick={() => onTruncate(i + 1)}
                className={`rounded-md px-1.5 py-0.5 ${i === session.path.length - 1 ? "bg-white/[0.06] text-chalk-200" : "text-chalk-500 hover:bg-white/[0.06] hover:text-chalk-300"}`}
              >
                {EVENT_LABEL[e]}
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* WHAT TO SAY — the loudest thing on the screen, because it is the only thing
          the operator needs while a person is waiting on the line. */}
      <p className="mt-4 text-[12px] text-chalk-500">{g.objective}</p>
      <blockquote className="mt-2 flex gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
        <Quote size={15} className="mt-1 shrink-0 text-amber-300/80" aria-hidden />
        <p className="text-[16px] leading-relaxed text-chalk-100">{g.say}</p>
      </blockquote>
      {g.note && <p className="mt-2 text-[12.5px] leading-relaxed text-chalk-500">{g.note}</p>}

      {/* What this moment might need written down. */}
      {g.capture.length > 0 && <div className="mt-4 space-y-3">{g.capture.map(field)}</div>}

      {/* WHAT JUST HAPPENED — only the handful of things that plausibly come next. */}
      {g.next.length > 0 && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What just happened?</p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {g.next.map((e) => (
              <button key={e} type="button" onClick={() => onEvent(e)} className={`rounded-lg border px-3 py-2.5 text-left text-[13px] leading-tight transition ${TONE_BTN[toneOf(e)]}`}>
                {EVENT_LABEL[e]}
              </button>
            ))}
          </div>
          {/* Always available, never in the way: the call can end from anywhere. */}
          {!g.next.includes("end-call") && (
            <button type="button" onClick={() => onEvent("end-call")} className="mt-2 w-full rounded-lg border border-white/10 px-3 py-2 text-[12.5px] text-chalk-500 hover:border-white/20 hover:text-chalk-300">
              End the call
            </button>
          )}
        </div>
      )}

      {/* Reference, collapsed: the full written guide the assistant is drawn from. */}
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-chalk-500 hover:text-chalk-300">
          <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> The full script
        </summary>
        <div className="mt-3">
          <CallScriptCard script={script} />
        </div>
      </details>
    </section>
  );
}
