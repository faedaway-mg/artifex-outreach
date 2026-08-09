"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Email test — a compact, phone-friendly Settings control that prepares the internal
// "TEST — Acquisition OS Email" lead pointed at an address the operator owns, then drops
// them into the REAL Emails-to-send flow. It never sends: the human still previews,
// edits, and presses Approve & Send. Built for the 60 seconds before a DoorDash pickup.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, ArrowRight, AlertTriangle, Check } from "lucide-react";
import { createEmailTestLeadAction } from "@/lib/actions";

export function EmailTestControl({ exists }: { exists: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okId, setOkId] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setErr(null);
      const res = await createEmailTestLeadAction(email);
      if (res.ok) { setOkId(res.leadId ?? ""); }
      else setErr(res.reason ?? "Couldn't prepare the test.");
    });

  const input = "mt-1 w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-[16px] text-chalk-100 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

  return (
    <section className="card space-y-3 p-5">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-chalk-100"><FlaskConical size={15} className="text-azure-300" /> Email test</h2>
      <p className="text-[13px] leading-relaxed text-chalk-400">
        Send one controlled email through the real Acquisition OS workflow to an address you own.
      </p>

      {okId ? (
        <div className="rounded-lg border border-teal-400/25 bg-teal-400/[0.06] p-3">
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-teal-200"><Check size={15} /> Test email prepared — nothing sent yet.</p>
          <p className="mt-1 text-[12.5px] text-chalk-300">Open it, confirm the recipient, edit a phrase, then Approve &amp; Send.</p>
          <button onClick={() => router.push("/work/email")} className="btn-primary mt-3 w-full justify-center !py-3 text-[15px]">
            Open test email <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          <label className="block">
            <span className="field-label">Personal test email</span>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="you@yourmail.com" className={input}
            />
          </label>

          <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5 text-[12px] leading-relaxed text-amber-200/90">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Use an email address you personally control — never a customer or prospect. Creating this test does not send an email; you approve it manually from Emails to send.
          </p>

          <label className="flex items-center gap-2 text-[12.5px] text-chalk-300">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-ink-950/40" />
            This is an email address I control.
          </label>

          {err && <p className="text-[12.5px] text-coral-300">{err}</p>}

          <button
            onClick={submit}
            disabled={pending || !confirmed || email.trim().length === 0}
            className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-50"
          >
            {pending ? <><Loader2 size={16} className="animate-spin" /> Preparing…</> : exists ? "Update email test" : "Create email test"}
          </button>
        </>
      )}
    </section>
  );
}
