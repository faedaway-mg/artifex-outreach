"use client";
// The call outcome console. The operator picks ONE outcome, and only the fields
// that outcome needs appear. Saving records real state (see saveCallOutcomeAction):
// an email unblocks the review send, a follow-up becomes a task, a decline closes
// the lead. This is the "what do I record when the call ends" half of the workspace.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, ArrowRight, PhoneOff, Voicemail, CalendarClock, UserCheck, Mail, Ban, ChevronDown } from "lucide-react";
import { saveCallOutcomeAction, type CallOutcome, type CallOutcomeResult } from "@/lib/outreach/call-outcome";

type Field = "role" | "name" | "email" | "method" | "bestTime" | "followUp" | "notes";

interface OutcomeDef {
  value: CallOutcome;
  label: string;
  tone: "good" | "neutral" | "bad";
  fields: Field[];
  Icon: typeof UserCheck;
}

// Grouped by how the call went — good (a door opened), neutral (try again), bad
// (close it out). Each outcome names exactly the fields it needs afterward.
const OUTCOMES: OutcomeDef[] = [
  { value: "reached-dm", label: "Decision-maker reached", tone: "good", Icon: UserCheck, fields: ["role", "name", "email", "method", "bestTime", "notes"] },
  { value: "contact-collected", label: "Contact info collected", tone: "good", Icon: Mail, fields: ["name", "email", "method", "notes"] },
  { value: "asked-to-send", label: "Asked to send the review", tone: "good", Icon: ArrowRight, fields: ["name", "email", "notes"] },
  { value: "follow-up", label: "Follow up later", tone: "neutral", Icon: CalendarClock, fields: ["followUp", "notes"] },
  { value: "voicemail", label: "Left voicemail", tone: "neutral", Icon: Voicemail, fields: ["notes"] },
  { value: "no-answer", label: "No answer", tone: "neutral", Icon: PhoneOff, fields: ["notes"] },
  { value: "wrong-number", label: "Wrong number", tone: "bad", Icon: Ban, fields: ["notes"] },
  { value: "not-interested", label: "Not interested", tone: "bad", Icon: Ban, fields: ["notes"] },
  { value: "business-closed", label: "Closed / invalid", tone: "bad", Icon: Ban, fields: ["notes"] },
];

const TONE_BTN: Record<OutcomeDef["tone"], string> = {
  good: "border-teal-400/40 bg-teal-400/10 text-teal-200",
  neutral: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  bad: "border-coral-400/40 bg-coral-400/10 text-coral-200",
};

export function CallOutcomeConsole({ leadId, collapsedLabel }: { leadId: string; collapsedLabel?: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [role, setRole] = useState<"owner" | "manager" | "assistant">("owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"email" | "phone" | "text">("email");
  const [bestTime, setBestTime] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CallOutcomeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const def = OUTCOMES.find((o) => o.value === outcome) ?? null;
  const has = (f: Field) => !!def?.fields.includes(f);

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
        notes: notes || undefined,
      });
      if (res.ok) { setResult(res); router.refresh(); }
      else setErr(res.reason ?? "Couldn't save the outcome.");
    } catch {
      setErr("Something went wrong saving the outcome.");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  // After a successful save: confirm what changed, and offer the single next step.
  if (result?.ok) {
    return (
      <div className="rounded-xl border border-teal-400/25 bg-teal-400/[0.06] p-5">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-teal-200"><Check size={16} /> Call outcome recorded</p>
        <ul className="mt-2 space-y-1 text-[13px] text-chalk-300">
          {result.savedEmail && <li>Verified email saved to the business.</li>}
          {result.stage && <li>Moved to <span className="text-chalk-100">{result.stage}</span>.</li>}
          {result.scheduledFor && <li>Next attempt scheduled for {new Date(result.scheduledFor).toLocaleDateString()}.</li>}
        </ul>
        {result.readyToSend && (
          <Link href={`/leads/${leadId}/send`} className="btn-primary mt-4 inline-flex !py-2.5 text-sm">
            Send the personalized review <ArrowRight size={15} />
          </Link>
        )}
        <button onClick={() => { setResult(null); setOutcome(null); }} className="mt-3 block text-[12px] text-chalk-500 hover:text-chalk-300">
          Log another outcome
        </button>
      </div>
    );
  }

  const body = (
    <section className="card p-5">
      <p className="label mb-1">When the call ends</p>
      <p className="text-[13px] text-chalk-400">Pick what happened — only the fields you need will appear.</p>

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
          {has("role") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">Who you reached</p>
              <div className="flex flex-wrap gap-1.5">
                {(["owner", "manager", "assistant"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRole(r)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] capitalize ${role === r ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-chalk-400 hover:text-chalk-200"}`}>
                    {r}
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

          {has("followUp") && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">When to call back</p>
              <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} type="datetime-local" className={input} />
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
