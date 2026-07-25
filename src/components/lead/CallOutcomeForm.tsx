"use client";
// After the call — capture the outcome in seconds. Collapsed until the operator
// finishes the call, so it never competes with the brief. Saving the verified
// email lands it on the business and the workflow advances to "send the review".
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { saveCallOutcomeAction, type ReachedWho } from "@/lib/outreach/call-outcome";

const REACHED: { value: ReachedWho; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "assistant", label: "Assistant" },
  { value: "voicemail", label: "Voicemail" },
  { value: "no-answer", label: "No answer" },
];

export function CallOutcomeForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [reached, setReached] = useState<ReachedWho>("owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"email" | "phone" | "text">("email");
  const [bestTime, setBestTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const res = await saveCallOutcomeAction(leadId, { reached, contactName: name, verifiedEmail: email, preferredMethod: method, bestTime, notes });
      if (res.ok) { setDone(true); router.refresh(); }
      else setErr(res.reason ?? "Couldn't save.");
    } catch {
      setErr("Something went wrong saving the outcome.");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  return (
    <details className="group mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-chalk-200">
        <ChevronDown size={15} className="text-chalk-500 transition-transform group-open:rotate-180" />
        {done ? <span className="inline-flex items-center gap-1.5 text-teal-300"><Check size={14} /> Call outcome saved</span> : "Log the call outcome"}
      </summary>

      <div className="mt-3 space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500">Reached</p>
          <div className="flex flex-wrap gap-1.5">
            {REACHED.map((r) => (
              <button key={r.value} type="button" onClick={() => setReached(r.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] ${reached === r.value ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-chalk-400 hover:text-chalk-200"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" className={input} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Verified email" type="email" inputMode="email" autoCapitalize="none" className={input} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <select value={method} onChange={(e) => setMethod(e.target.value as "email" | "phone" | "text")} className={input}>
            <option value="email">Prefers email</option>
            <option value="phone">Prefers phone</option>
            <option value="text">Prefers text</option>
          </select>
          <input value={bestTime} onChange={(e) => setBestTime(e.target.value)} placeholder="Best time to reach" className={input} />
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Operator notes" rows={2} className={input} />

        {err && <p className="text-[12.5px] text-coral-300">{err}</p>}

        <button onClick={onSave} disabled={saving || done} className="btn-primary w-full justify-center !py-2.5 text-sm disabled:opacity-60">
          {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : done ? <><Check size={15} /> Saved</> : "Save call outcome"}
        </button>
        {done && email && <p className="text-center text-[12px] text-chalk-500">Verified email saved to the business — the review can send next.</p>}
      </div>
    </details>
  );
}
