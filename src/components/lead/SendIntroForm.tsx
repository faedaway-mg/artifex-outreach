"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, CheckCircle2, AlertTriangle, Clock, Video, ArrowRight } from "lucide-react";
import { sendIntroductionAction, sendFollowUpAction, fetchVeedMetadata } from "@/lib/outreach/send-actions";
import type { IntroSendResult, VeedVideo } from "@/lib/outreach/types";

/**
 * Explicit review → approve → real send. Reuses the production dispatch pipeline.
 * The button disables on click (client guard); the ledger's step-key idempotency
 * is the real duplicate protection. On a clean send/queue the loop keeps moving:
 * we advance to `nextHref` (Today's work by default) instead of stranding the operator.
 */
export function SendIntroForm({ leadId, mode = "intro", hasVideoRecommended, nextHref = "/" }: { leadId: string; mode?: "intro" | "followup"; hasVideoRecommended: boolean; nextHref?: string }) {
  const router = useRouter();
  const [veedUrl, setVeedUrl] = useState("");
  const [meta, setMeta] = useState<{ title: string | null; thumbnailUrl: string | null } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<IntroSendResult | null>(null);

  // The operator pastes ONE thing. We fetch the title + thumbnail automatically.
  async function onVeedBlur() {
    const url = veedUrl.trim();
    if (!url) { setMeta(null); return; }
    setFetching(true);
    try {
      setMeta(await fetchVeedMetadata(url));
    } catch {
      setMeta({ title: null, thumbnailUrl: null });
    } finally {
      setFetching(false);
    }
  }

  async function onSend() {
    if (sending || result?.outcome === "sent") return;
    setSending(true);
    const url = veedUrl.trim();
    const veed: VeedVideo | null = url ? { url, thumbnailUrl: meta?.thumbnailUrl ?? null, title: meta?.title ?? null, durationSeconds: null } : null;
    try {
      const res = mode === "followup" ? await sendFollowUpAction(leadId) : await sendIntroductionAction(leadId, veed);
      setResult(res);
      // Clean send or queued → keep momentum, advance to the next business. Blocked/failed
      // stays put so the operator can see what to fix.
      if (res.outcome === "sent" || res.outcome === "queued") { router.push(nextHref); return; }
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
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-chalk-300"><Video size={13} className="text-azure-300" /> Personal video <span className="font-normal text-chalk-600">(optional)</span></p>
          <p className="mb-2 mt-0.5 text-[11px] text-chalk-600">Paste your VEED link. That's it — the title and preview are pulled in automatically.</p>
          <input
            value={veedUrl}
            onChange={(e) => setVeedUrl(e.target.value)}
            onBlur={onVeedBlur}
            placeholder="https://veed.io/…"
            className="w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2 text-sm text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none"
          />
          {fetching && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-chalk-500"><Loader2 size={12} className="animate-spin" /> Fetching preview…</p>}
          {!fetching && veedUrl.trim() && meta?.thumbnailUrl && (
            <div className="mt-2 flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={meta.thumbnailUrl} alt={meta.title ?? "Video preview"} className="h-12 w-20 rounded-md border border-white/10 object-cover" />
              <span className="text-[12px] text-chalk-400">{meta.title ?? "Video attached"}</span>
            </div>
          )}
          {!fetching && veedUrl.trim() && meta && !meta.thumbnailUrl && (
            <p className="mt-2 text-[11px] text-chalk-500">Couldn't pull a preview — the email will show a clean text link instead. You can still send.</p>
          )}
        </div>
      )}

      {/* Primary action — full width and sticky on mobile, so it's never a scroll away. */}
      <div className="sticky bottom-[76px] z-10 md:static md:bottom-auto">
        <button
          onClick={onSend}
          disabled={sending || done}
          className="btn-primary w-full justify-center gap-2 !py-3 text-[15px] disabled:opacity-60"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : done ? <CheckCircle2 size={16} /> : <Send size={16} />}
          {sending ? "Sending…" : done ? "Sent" : `Approve & send the ${mode === "followup" ? "follow-up" : "introduction"}`}
          {!sending && !done && <ArrowRight size={16} />}
        </button>
      </div>

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
