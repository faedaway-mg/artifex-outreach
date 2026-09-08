"use client";
import { useState } from "react";

// Post-purchase intake. The customer confirms they've granted the required access
// via native invites — we never render a password field and store no credentials.
// Completing the blocking items advances the job to READY_FOR_FULFILLMENT and starts
// the delivery clock (server-side).
type Item = { key: string; label: string; necessity: string; steps: string[] };

export function IntakeForm({ token, items, alreadyStarted, initialTargetDelivery }: { token: string; items: Item[]; alreadyStarted: boolean; initialTargetDelivery: string | null }) {
  const blocking = items.filter((i) => i.necessity === "REQUIRED_BEFORE_START");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [started, setStarted] = useState(alreadyStarted);
  const [target, setTarget] = useState<string | null>(initialTargetDelivery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allBlockingConfirmed = blocking.every((i) => checked[i.key]);

  async function submit() {
    setError(null); setLoading(true);
    try {
      const r = await fetch(`/api/offer/${token}/intake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ completed: true }) });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "Could not update your order."); setLoading(false); return; }
      setStarted(!!j.clockStarted || j.state === "READY_FOR_FULFILLMENT");
      setTarget(j.targetDeliveryAt ?? null);
    } catch { setError("Something went wrong. Please try again."); }
    setLoading(false);
  }

  if (started) {
    return (
      <div className="rounded-xl border border-teal-400/25 bg-teal-400/10 p-5 text-center">
        <p className="text-[15px] font-semibold text-teal-100">Access received — your fix is queued.</p>
        <p className="mt-1.5 text-[13px] text-chalk-300">The turnaround clock has started{target ? `. Target delivery by ${new Date(target).toLocaleString()}.` : "."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {blocking.map((i) => (
        <label key={i.key} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
          <input type="checkbox" checked={!!checked[i.key]} onChange={(e) => setChecked((c) => ({ ...c, [i.key]: e.target.checked }))} className="mt-1 h-4 w-4" />
          <span>
            <span className="block text-[14px] font-medium text-chalk-100">{i.label}</span>
            <span className="mt-1 block text-[12px] text-chalk-500">I've granted this via my platform's native invite (no password shared).</span>
          </span>
        </label>
      ))}
      {error && <p className="rounded-lg bg-coral-500/10 px-3 py-2 text-[12.5px] text-coral-300">{error}</p>}
      <button onClick={submit} disabled={loading || !allBlockingConfirmed} className="inline-flex w-full items-center justify-center rounded-xl bg-azure-500 px-5 py-3.5 text-[15px] font-semibold text-ink-975 hover:bg-azure-400 disabled:opacity-50">
        {loading ? "Saving…" : "I've completed the required steps — start my fix"}
      </button>
      {!allBlockingConfirmed && <p className="text-center text-[12px] text-chalk-500">Confirm each required item above to start your turnaround.</p>}
    </div>
  );
}
