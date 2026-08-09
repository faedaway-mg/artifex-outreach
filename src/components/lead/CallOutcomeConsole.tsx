"use client";
// The call outcome console. The operator picks ONE outcome, and only the fields
// that outcome needs appear. Saving records real state (see saveCallOutcomeAction):
// an email unblocks the review send, a follow-up becomes a task, a decline closes
// the lead. This is the "what do I record when the call ends" half of the workspace.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, ArrowRight, PhoneOff, Voicemail, CalendarClock, UserCheck, Mail, Ban, ChevronDown, Clock } from "lucide-react";
import { saveCallOutcomeAction, type CallOutcome, type CallOutcomeResult, type VoicemailStatus } from "@/lib/outreach/call-outcome";
import type { CallSession } from "@/lib/outreach/call-conversation";
import { resolveNextLead } from "@/lib/outreach/next-lead";

/** Batch/queue context carried from the lead page so "Next lead" can continue the loop. */
export interface Continuation {
  ids?: string[];
  kind?: string;
}

/** What the tapped-through call says the outcome is — a proposal the operator can
 *  still override, never a decision made on their behalf. */
export interface SuggestedOutcome {
  outcome: CallOutcome;
  because: string;
  email: string | null;
  contactName: string | null;
  role: "owner" | "manager" | "assistant" | "reception" | null;
  bestTime: string | null;
  voicemail: VoicemailStatus | null;
}

type Field = "role" | "name" | "email" | "method" | "bestTime" | "followUp" | "voicemail" | "hours" | "notes";

// Voicemail is independent of the outcome — a "no answer" call may simply have no
// voicemail to leave. Optional; never blocks a save.
const VOICEMAIL_OPTS: { value: VoicemailStatus; label: string }[] = [
  { value: "left", label: "Left voicemail" },
  { value: "none-available", label: "No voicemail available" },
  { value: "mailbox-full", label: "Mailbox full" },
  { value: "not-left", label: "Didn't leave one" },
];

interface OutcomeDef {
  value: CallOutcome;
  label: string;
  tone: "good" | "neutral" | "bad";
  fields: Field[];
  Icon: typeof UserCheck;
  /** What the system will DO with this outcome — shown before saving, so two
   *  similar-sounding outcomes can never be confused (collected ≠ permission). */
  consequence: string;
}

// Grouped by how the call went — good (a door opened), neutral (try again), bad
// (close it out). Each outcome names exactly the fields it needs afterward.
const OUTCOMES: OutcomeDef[] = [
  { value: "reached-dm", label: "Decision-maker reached", tone: "good", Icon: UserCheck, fields: ["role", "name", "email", "method", "bestTime", "notes"], consequence: "→ opens the relationship and schedules a follow-up call" },
  { value: "contact-collected", label: "Contact info collected", tone: "good", Icon: Mail, fields: ["name", "email", "method", "notes"], consequence: "→ saves the contact and schedules ANOTHER CALL (no email goes out)" },
  { value: "asked-to-send", label: "Asked to send the review", tone: "good", Icon: ArrowRight, fields: ["name", "email", "notes"], consequence: "→ queues the personalized review to SEND to this address" },
  { value: "follow-up", label: "Follow up later", tone: "neutral", Icon: CalendarClock, fields: ["followUp", "notes"], consequence: "→ schedules the next call at the time you pick" },
  { value: "voicemail", label: "Left voicemail", tone: "neutral", Icon: Voicemail, fields: ["voicemail", "notes"], consequence: "→ schedules a call-back in ~2 days" },
  { value: "no-answer", label: "No answer", tone: "neutral", Icon: PhoneOff, fields: ["voicemail", "notes"], consequence: "→ schedules a retry call tomorrow" },
  { value: "closed-now", label: "Closed right now", tone: "neutral", Icon: Clock, fields: ["hours", "notes"], consequence: "→ reschedules the call for the next time they're open — the lead is kept, not burned" },
  { value: "wrong-number", label: "Wrong number", tone: "bad", Icon: Ban, fields: ["notes"], consequence: "→ stops dialing this number; research keeps the lead" },
  { value: "not-interested", label: "Not interested", tone: "bad", Icon: Ban, fields: ["notes"], consequence: "→ closes the lead as Lost" },
  { value: "business-closed", label: "Permanently closed / invalid", tone: "bad", Icon: Ban, fields: ["notes"], consequence: "→ disqualifies the lead" },
];

const TONE_BTN: Record<OutcomeDef["tone"], string> = {
  good: "border-teal-400/40 bg-teal-400/10 text-teal-200",
  neutral: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  bad: "border-coral-400/40 bg-coral-400/10 text-coral-200",
};

export function CallOutcomeConsole({
  leadId,
  collapsedLabel,
  continuation,
  session,
  suggested,
  onReset,
}: {
  leadId: string;
  collapsedLabel?: string;
  continuation?: Continuation;
  /** The tapped-through call, when there was one. Carried to the save so it is
   *  idempotent and so the structured record of the call is written with it. */
  session?: CallSession | null;
  suggested?: SuggestedOutcome | null;
  onReset?: () => void;
}) {
  const router = useRouter();
  const [advancing, startAdvance] = useTransition();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [role, setRole] = useState<"owner" | "manager" | "assistant" | "reception">("owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"email" | "phone" | "text">("email");
  const [bestTime, setBestTime] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [hours, setHours] = useState("");
  const [voicemail, setVoicemail] = useState<VoicemailStatus | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CallOutcomeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const def = OUTCOMES.find((o) => o.value === outcome) ?? null;
  const has = (f: Field) => !!def?.fields.includes(f);

  // The call answers this form. As the operator taps through the conversation the
  // outcome and the fields it needs follow along, so nothing has to be re-entered
  // when they hang up. Only fields the call actually learned are written — anything
  // typed here by hand survives.
  const signature = suggested ? `${suggested.outcome}|${suggested.email ?? ""}|${suggested.contactName ?? ""}|${suggested.role ?? ""}|${suggested.bestTime ?? ""}|${suggested.voicemail ?? ""}` : "";
  useEffect(() => {
    if (!suggested) return;
    setOutcome(suggested.outcome);
    if (suggested.email) setEmail(suggested.email);
    if (suggested.contactName) setName(suggested.contactName);
    if (suggested.role) setRole(suggested.role);
    if (suggested.bestTime) setBestTime(suggested.bestTime);
    setVoicemail(suggested.voicemail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function onSave() {
    if (!outcome || saving) return;
    setSaving(true); setErr(null);
    try {
      const res = await saveCallOutcomeAction(leadId, {
        outcome,
        reachedRole: has("role") ? role : null,
        contactName: has("name") ? name : undefined,
        verifiedEmail: has("email") ? email : undefined,
        preferredMethod: has("method") ? method : undefined,
        bestTime: has("bestTime") ? bestTime : undefined,
        followUpAt: has("followUp") && followUp ? new Date(followUp).toISOString() : undefined,
        voicemail: has("voicemail") ? voicemail : undefined,
        hours: has("hours") && hours.trim() ? hours.trim() : undefined,
        notes: notes || undefined,
      }, session ?? null);
      if (res.ok) { setResult(res); router.refresh(); }
      else setErr(res.reason ?? "Couldn't save the outcome.");
    } catch {
      setErr("Something went wrong saving the outcome.");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  // Continue the operator loop. The SERVER decides the next actionable business
  // (skipping completed-today and closed leads) — resolving is read-only, so this
  // never records another outcome. Guarded by the transition's pending flag so a
  // double-click can't navigate (or resolve) twice.
  function goNext() {
    if (advancing) return;
    startAdvance(async () => {
      const res = await resolveNextLead(leadId, continuation ?? {});
      const carry = continuation?.ids?.length
        ? `?ids=${encodeURIComponent(continuation.ids.join(","))}${continuation.kind ? `&kind=${continuation.kind}` : ""}`
        : "";
      if (res.nextLeadId) {
        router.push(`/leads/${res.nextLeadId}${carry}`);
      } else if (continuation?.ids?.length && continuation.kind) {
        // Batch complete — reuse the batch runner's completion screen.
        router.push(`/work/${continuation.kind}?ids=${encodeURIComponent(continuation.ids.join(","))}&i=${continuation.ids.length}`);
      } else {
        router.push("/"); // no batch context → back to Today's board
      }
    });
  }

  // After a successful save: confirm what changed, then the ONE clear continuation —
  // on to the next business. (When permission was earned, sending the review is the
  // immediate work on THIS lead, so it stays primary and "Next lead" is secondary.)
  if (result?.ok) {
    const showNext = !!continuation;
    return (
      <div className="rounded-xl border border-teal-400/25 bg-teal-400/[0.06] p-5">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-teal-200"><Check size={16} /> Call outcome recorded</p>
        <ul className="mt-2 space-y-1 text-[13px] text-chalk-300">
          {result.savedEmail && !result.readyToSend && <li>Email saved to the contact — you still need permission before sending.</li>}
          {result.readyToSend && <li>Permission received — the personalized review can go out.</li>}
          {result.stage && <li>Moved to <span className="text-chalk-100">{result.stage}</span>.</li>}
          {result.scheduledFor && <li>Next attempt: {new Date(result.scheduledFor).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}.</li>}
        </ul>

        {/* Primary continuation. readyToSend keeps "Send the review" primary (immediate
            work on this lead); otherwise the loop's one action is the next business. */}
        <div className="mt-4 space-y-2">
          {result.readyToSend ? (
            <>
              <Link href={`/leads/${leadId}/send`} className="btn-primary flex w-full items-center justify-center !py-3 text-[15px]">
                Send the personalized review <ArrowRight size={16} />
              </Link>
              {showNext && (
                <button onClick={goNext} disabled={advancing} aria-label="Skip to the next actionable business" className="btn-secondary flex w-full items-center justify-center !py-2.5 text-sm disabled:opacity-60">
                  {advancing ? <><Loader2 size={15} className="animate-spin" /> Finding next…</> : <>Next lead <ArrowRight size={15} /></>}
                </button>
              )}
            </>
          ) : showNext ? (
            <button onClick={goNext} disabled={advancing} aria-label="Open the next actionable business" className="btn-primary flex w-full items-center justify-center !py-3.5 text-[16px] disabled:opacity-70">
              {advancing ? <><Loader2 size={18} className="animate-spin" /> Finding next…</> : <>Next lead <ArrowRight size={18} /></>}
            </button>
          ) : (
            <p className="text-[12.5px] text-chalk-500">The lead stays in the call workflow.</p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <button onClick={() => { setResult(null); setOutcome(null); onReset?.(); }} disabled={advancing} className="text-chalk-500 hover:text-chalk-300 disabled:opacity-50">Log another outcome</button>
          {showNext && <button onClick={() => { setResult(null); router.refresh(); }} disabled={advancing} className="text-chalk-500 hover:text-chalk-300 disabled:opacity-50">Stay on this lead</button>}
        </div>
      </div>
    );
  }

  const body = (
    <section className="card p-5">
      <p className="label mb-1">When the call ends</p>
      {suggested ? (
        // Never a surprise: say what this call will be recorded as, and why, before
        // the operator commits it. They can still pick anything else.
        <p className="text-[13px] text-chalk-400">
          From the call, this looks like <span className="text-chalk-100">{OUTCOMES.find((o) => o.value === suggested.outcome)?.label ?? suggested.outcome}</span> — {suggested.because} Change it if that&rsquo;s not right.
        </p>
      ) : (
        <p className="text-[13px] text-chalk-400">Pick what happened — only the fields you need will appear.</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {OUTCOMES.map((o) => {
          const active = outcome === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => { setOutcome(o.value); setErr(null); }}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] transition ${active ? TONE_BTN[o.tone] : "border-white/10 text-chalk-400 hover:border-white/20 hover:text-chalk-200"}`}
            >
              <o.Icon size={14} className="shrink-0" />
              <span className="leading-tight">{o.label}</span>
            </button>
          );
        })}
      </div>

      {def && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          {/* What saving THIS outcome will do — no hidden state-machine semantics. */}
          <p className="text-[12px] text-chalk-500">{def.consequence}</p>
          {has("role") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">Who you reached</p>
              <div className="flex flex-wrap gap-1.5">
                {([["owner", "Owner"], ["manager", "Manager"], ["assistant", "Assistant"], ["reception", "Front desk"]] as const).map(([r, label]) => (
                  <button key={r} type="button" onClick={() => setRole(r)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] ${role === r ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-chalk-400 hover:text-chalk-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(has("name") || has("email")) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {has("name") && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" className={input} />}
              {has("email") && <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Verified email" type="email" inputMode="email" autoCapitalize="none" className={input} />}
            </div>
          )}

          {(has("method") || has("bestTime")) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {has("method") && (
                <select value={method} onChange={(e) => setMethod(e.target.value as "email" | "phone" | "text")} className={input}>
                  <option value="email">Prefers email</option>
                  <option value="phone">Prefers phone</option>
                  <option value="text">Prefers text</option>
                </select>
              )}
              {has("bestTime") && <input value={bestTime} onChange={(e) => setBestTime(e.target.value)} placeholder="Best time to reach" className={input} />}
            </div>
          )}

          {has("voicemail") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">Voicemail <span className="text-chalk-600">(optional)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {VOICEMAIL_OPTS.map((v) => (
                  <button key={v.value} type="button" onClick={() => setVoicemail(voicemail === v.value ? null : v.value)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] ${voicemail === v.value ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-chalk-400 hover:text-chalk-200"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {has("followUp") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">When to call back</p>
              <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} type="datetime-local" className={input} />
            </div>
          )}

          {has("hours") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">Their hours <span className="text-chalk-600">(optional — teaches the queue)</span></p>
              <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. Mon–Fri 8–5, closed weekends" className={input} />
              <p className="mt-1 text-[11.5px] text-chalk-500">If you heard their hours, note them here — next time we won&rsquo;t queue this call while they&rsquo;re closed.</p>
            </div>
          )}

          {has("notes") && <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Operator notes (optional)" rows={2} className={input} />}

          {has("email") && def.value === "asked-to-send" && !email && (
            <p className="text-[12px] text-amber-300/90">Add the email here and the review can send the moment you save.</p>
          )}

          {err && <p className="text-[12.5px] text-coral-300">{err}</p>}

          <button onClick={onSave} disabled={saving} className="btn-primary w-full justify-center !py-2.5 text-sm disabled:opacity-60">
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save outcome"}
          </button>
        </div>
      )}
    </section>
  );

  // On a closed lead the console is a quiet, collapsed affordance — never a second
  // competing action. Everywhere else it's the workspace's fourth step, always open.
  if (collapsedLabel) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] font-medium text-chalk-300 hover:border-white/[0.12]">
          <ChevronDown size={15} className="text-chalk-500 transition-transform group-open:rotate-180" /> {collapsedLabel}
        </summary>
        <div className="mt-4">{body}</div>
      </details>
    );
  }
  return body;
}
