"use client";
// Outcome correction — one tap, no history deleted. Shown when a call collected an
// email but the outcome logged was "contact collected" (→ another call): if the
// operator's real read was "they asked us to send it", this converts the outcome to
// asked-to-send: the address becomes the send route, the stale call-back is
// superseded, and the review is queued. An audit + a dated note record the change.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Check } from "lucide-react";
import { correctToAskedToSendAction } from "@/lib/outreach/call-outcome";

export function ConvertToSendButton({ leadId, email }: { leadId: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const convert = () =>
    start(async () => {
      setErr(null);
      const res = await correctToAskedToSendAction(leadId);
      if (res.ok) { setDone(true); router.refresh(); }
      else setErr(res.reason ?? "Couldn't convert.");
    });

  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <button onClick={convert} disabled={pending || done} className="btn-secondary !py-1.5 text-[12.5px] disabled:opacity-60">
        {pending ? <Loader2 size={13} className="animate-spin" /> : done ? <Check size={13} /> : <Send size={13} />}
        {done ? "Converted — review queued" : `They asked us to send it → email ${email}`}
      </button>
      {err && <span className="text-[12px] text-coral-300">{err}</span>}
    </span>
  );
}
