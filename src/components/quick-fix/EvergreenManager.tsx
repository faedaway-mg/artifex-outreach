"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Version = { role: string; variant: string; version: number; assetUrl: string | null; durationSeconds: number | null; status: string; script: string; updatedAt: string };

// Operator management of the evergreen trust asset: preview, attach a rendered/
// uploaded asset URL, activate a version, retire it, or add a new draft. Swapping
// the active version does NOT regenerate offers.
export function EvergreenManager({ versions }: { versions: Version[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [attachFor, setAttachFor] = useState<number | null>(null);
  const [assetUrl, setAssetUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/revenue/evergreen`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!j.ok) setMsg(j.error || "Failed");
      else { setAttachFor(null); setAssetUrl(""); setDuration(""); router.refresh(); }
    } catch { setMsg("Request failed"); }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => call("add")} className="rounded-lg bg-teal-400/15 px-3 py-1.5 text-[12px] font-medium text-teal-200 hover:bg-teal-400/25 disabled:opacity-50">+ New draft version</button>
        {versions.length === 0 && <button disabled={busy} onClick={() => call("seed")} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-chalk-300 hover:bg-white/5 disabled:opacity-50">Seed v1</button>}
      </div>
      {msg && <p className="text-[12px] text-coral-300">{msg}</p>}

      {versions.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-400">No evergreen versions yet. Seed v1 to start (it carries the canonical script; attach a render to activate).</div>
      ) : (
        <ul className="space-y-2.5">
          {versions.slice().sort((a, b) => b.version - a.version).map((v) => (
            <li key={v.version} className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-[14px] font-semibold text-chalk-100">v{v.version}</span>
                  <span className="ml-2 text-[11.5px] text-chalk-500">{v.variant}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10.5px] ${v.status === "active" ? "bg-teal-400/15 text-teal-200" : v.status === "draft" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-chalk-500"}`}>{v.status}</span>
                </div>
                <div className="flex gap-1.5">
                  {v.status !== "active" && <button disabled={busy || !v.assetUrl} title={v.assetUrl ? "" : "attach a render first"} onClick={() => call("activate", { version: v.version })} className="rounded-lg bg-azure-500/15 px-2.5 py-1 text-[11.5px] text-azure-200 hover:bg-azure-500/25 disabled:opacity-40">Activate</button>}
                  {v.status !== "retired" && <button disabled={busy} onClick={() => call("retire", { version: v.version })} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] text-chalk-400 hover:bg-white/5 disabled:opacity-50">Retire</button>}
                  <button disabled={busy} onClick={() => setAttachFor(attachFor === v.version ? null : v.version)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] text-chalk-300 hover:bg-white/5">Attach render</button>
                </div>
              </div>
              {v.assetUrl ? (
                <video controls preload="metadata" className="mt-2 w-full max-w-sm rounded-lg border border-white/10"><source src={v.assetUrl} /></video>
              ) : (
                <p className="mt-1.5 text-[12px] text-chalk-500">No render attached yet. Script: “{v.script.slice(0, 120)}…”</p>
              )}
              {attachFor === v.version && (
                <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <input value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="Rendered asset URL (mp4)" className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 outline-none" />
                  <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Duration seconds (optional)" inputMode="numeric" className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 outline-none" />
                  <button disabled={busy || !assetUrl} onClick={() => call("attach", { version: v.version, assetUrl, durationSeconds: duration ? Number(duration) : null })} className="rounded-lg bg-teal-400/15 px-3 py-1.5 text-[12px] text-teal-200 hover:bg-teal-400/25 disabled:opacity-50">Save render</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
