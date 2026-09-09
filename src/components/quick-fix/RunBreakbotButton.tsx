"use client";
import { useState } from "react";
import type { BreakbotVerdict } from "@/lib/breakbot/quickcash-preflight";
import { BreakbotVerdictCard } from "./BreakbotVerdict";

// OPERATOR entry point (Part A): "RUN BREAKBOT CHECK" on the opportunity workspace.
// Fetches the READ-ONLY verdict for THIS stored offer and renders the verdict card.
// Breakbot is a QA gate — running it approves/sends nothing. No auto-approve on pass.
export function RunBreakbotButton({ offerId }: { offerId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [verdict, setVerdict] = useState<BreakbotVerdict | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setState("loading"); setMsg(null);
    try {
      const r = await fetch(`/api/revenue/breakbot/verdict?offerId=${encodeURIComponent(offerId)}`, { method: "GET" });
      const j = await r.json();
      if (!j.ok) { setState("error"); setMsg(j.error || "Could not run Breakbot."); return; }
      setVerdict(j.verdict as BreakbotVerdict);
      setState("done");
    } catch { setState("error"); setMsg("Request failed."); }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={state === "loading"}
        className="w-full rounded-xl bg-azure-500/15 px-3 py-2.5 text-[13px] font-semibold text-azure-200 hover:bg-azure-500/25 disabled:opacity-50"
      >
        {state === "loading" ? "Running Breakbot pre-flight…" : state === "done" ? "Re-run Breakbot check" : "RUN BREAKBOT CHECK"}
      </button>
      {msg && <p className="text-[12px] text-coral-300">{msg}</p>}
      {verdict && <BreakbotVerdictCard verdict={verdict} offerId={offerId} />}
      <p className="text-[11px] text-chalk-500">
        A READY verdict means the assembled experience is clean to APPROVE — Breakbot never approves or sends.
      </p>
    </div>
  );
}
