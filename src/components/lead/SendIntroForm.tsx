"use client";
import { useState } from "react";
import { Send, Loader2, CheckCircle2, AlertTriangle, Clock, Video } from "lucide-react";
import { sendIntroductionAction } from "@/lib/outreach/send-actions";
import type { IntroSendResult, VeedVideo } from "@/lib/outreach/types";

/**
 * Explicit review → approve → real send. Reuses the production dispatch pipeline
 * via sendIntroductionAction. The button disables on click (client guard); the
 * ledger's step-key idempotency is the real duplicate protection.
 */
export function SendIntroForm({ leadId, hasVideoRecommended }: { leadId: string; hasVideoRecommended: boolean }) {
  const [veedUrl, setVeedUrl] = useState("");
  const [veedThumb, setVeedThumb] = useState("");
  const [veedTitle, setVeedTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<IntroSendResult | null>(null);

  async function onSend() {
    if (sending || result?.outcome === "sent") return;
    setSending(true);
    const veed: VeedVideo | null = veedUrl.trim()
      ? { url: veedUrl.trim(), thumbnailUrl: veedThumb.trim() || null, title: veedTitle.trim() || null, durationSeconds: null }
      : null;
    try {
      setResult(await sendIntroductionAction(leadId, veed));
    } catch {
      setResult({ outcome: "failed", reason: "Something went wrong reaching the send pipeline." });
    } finally {
      setSending(false);
    }
  }

  const done = result?.outcome === "sent";

  return (
    <div className="space-y-4">
      {hasVideoRecommended && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-chalk-300"><Video size={13} className="text-azure-300" /> Attach the personal video (optional)</p>
          <p className="mb-2 mt-0.5 text-[11px] text-chalk-600">Paste the hosted VEED link. A thumbnail is shown if you add one — we never fabricate one.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={veedUrl} onChange={(e) => setVeedUrl(e.target.value)} placeholder="VEED URL" className="rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-xs text-chalk-200 placeholder:text-chalk-600" />
            <input value={veedThumb} onChange={(e) => setVeedThumb(e.target.value)} placeholder="Thumbnail URL" className="rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-xs text-chalk-200 placeholder:text-chalk-600" />
            <input value={veedTitle} onChange={(e) => setVeedTitle(e.target.value)} placeholder="Title (optional)" className="rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-xs text-chalk-200 placeholder:text-chalk-600" />
          </div>
        </div>
      )}

      <button
        onClick={onSend}
        disabled={sending || done}
        className="btn-primary inline-flex items-center gap-2 !px-5 !py-2.5 text-sm disabled:opacity-60"
      >
        {sending ? <Loader2 size={15} className="animate-spin" /> : done ? <CheckCircle2 size={15} /> : <Send size={15} />}
        {sending ? "Sending…" : done ? "Sent" : "Approve & send the introduction"}
      </button>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-[13px] ${
            result.outcome === "sent"
              ? "border-teal-400/30 bg-teal-400/[0.06] text-teal-200"
              : result.outcome === "queued"
                ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200"
                : "border-coral-400/30 bg-coral-400/[0.06] text-coral-200"
          }`}
        >
          {result.outcome === "sent" ? <CheckCircle2 size={15} className="mt-0.5" /> : result.outcome === "queued" ? <Clock size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}
          <div>
            <p className="font-medium">
              {result.outcome === "sent" && "Accepted by the provider — the relationship is now Waiting."}
              {result.outcome === "queued" && "Queued — it will send automatically when the window/provider allows. Nothing is lost."}
              {result.outcome === "blocked" && "Held before sending."}
              {result.outcome === "failed" && "The send failed."}
            </p>
            {result.reason && <p className="mt-0.5 text-[12px] opacity-80">{result.reason}</p>}
            {result.providerMessageId && <p className="mt-0.5 text-[11px] opacity-70">Provider message id recorded: {result.providerMessageId}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
