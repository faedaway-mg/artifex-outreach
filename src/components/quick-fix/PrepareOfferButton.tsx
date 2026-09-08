"use client";
import { useState } from "react";

// Operator action: persist + approve the offer for a lead and get the customer link.
// Approving here IS the operator sign-off (automation stays ASSISTED — nothing sends).
export function PrepareOfferButton({ leadId }: { leadId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function prepare() {
    setState("loading"); setMsg(null);
    try {
      const r = await fetch(`/api/revenue/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId }) });
      const j = await r.json();
      if (!j.ok) { setState("error"); setMsg(j.error || "Could not prepare offer."); return; }
      setLink(j.url); setState("done");
    } catch { setState("error"); setMsg("Request failed."); }
  }

  if (state === "done" && link) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <a href={link} target="_blank" rel="noreferrer" className="rounded-lg bg-azure-500/15 px-2.5 py-1 text-azure-200 hover:bg-azure-500/25">Open customer link ↗</a>
        <button onClick={() => navigator.clipboard?.writeText(window.location.origin + link)} className="rounded-lg border border-white/10 px-2.5 py-1 text-chalk-300 hover:bg-white/5">Copy link</button>
        <a href={`/revenue/preview?offer=${link.split("/").pop()}`} className="rounded-lg border border-white/10 px-2.5 py-1 text-chalk-300 hover:bg-white/5">Preview</a>
      </div>
    );
  }

  return (
    <div className="text-[12px]">
      <button onClick={prepare} disabled={state === "loading"} className="rounded-lg bg-teal-400/15 px-2.5 py-1 font-medium text-teal-200 hover:bg-teal-400/25 disabled:opacity-50">
        {state === "loading" ? "Preparing…" : "Prepare & approve → get link"}
      </button>
      {msg && <span className="ml-2 text-coral-300">{msg}</span>}
    </div>
  );
}
