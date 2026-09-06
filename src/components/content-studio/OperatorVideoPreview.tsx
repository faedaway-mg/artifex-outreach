"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Play, X, ArrowLeft, Download, Loader2, AlertTriangle } from "lucide-react";
import { fetchMediaFile, shareOrDownloadFile } from "@/lib/content-studio/media-share";

// Canonical OPERATOR video preview (mandate 23). Plays the operator's CURRENT video from the internal,
// authenticated operator-video route (never an expiring recipient share). The overlay provides a visible
// Close (X) AND Back, closes on Escape, returns focus to the trigger, and closes on backdrop click — so
// there is never a swipe-only exit or a dead-end page. Opening/closing mutates NO workflow state. Download
// pulls the SAME canonical bytes as a Blob (never a raw navigation), so mobile can't get stranded.
export function OperatorVideoPreview({
  leadId, available, reason, revisionId, source, triggerLabel, note, className,
}: {
  leadId: string;
  available: boolean;
  reason?: string | null;
  revisionId?: string | null;
  source?: string | null;
  triggerLabel?: string;
  note?: string | null;        // e.g. "Narration not added yet" for a pre-narration base preview
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dl, setDl] = useState<null | { pct: number; msg: string }>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = `/api/content-studio/operator-video/${leadId}`;
  const label = triggerLabel ?? "Preview video";

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function download() {
    setDl({ pct: 0, msg: "Preparing…" });
    try {
      const file = await fetchMediaFile(`${url}?download=1`, `prospect-video-${leadId}.mp4`, "video/mp4", { fetch, onProgress: (pct) => setDl({ pct, msg: "Preparing…" }) });
      const r = await shareOrDownloadFile(file, `prospect-video-${leadId}.mp4`, {
        navigator, createObjectURL: URL.createObjectURL.bind(URL), revokeObjectURL: URL.revokeObjectURL.bind(URL),
        triggerDownload: (href, filename) => { const a = document.createElement("a"); a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); },
      });
      setDl({ pct: 100, msg: r.outcome === "shared" ? "Shared" : r.outcome === "cancelled" ? "Cancelled" : "Saved to your device" });
    } catch (e) {
      setDl({ pct: 0, msg: (e as Error)?.message?.slice(0, 120) ?? "Download failed" });
    }
  }

  return (
    <div className={className}>
      {available ? (
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)} data-operator-preview-open
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12.5px] text-chalk-200 hover:bg-white/[0.05]">
          <Play size={13} /> {label}{note ? <span className="ml-1 text-chalk-500">· {note}</span> : null}
        </button>
      ) : (
        <span data-operator-preview-unavailable className="inline-flex items-center gap-1.5 rounded-lg border border-white/5 px-2.5 py-1.5 text-[12.5px] text-chalk-600" title={reason ?? "No video available"}>
          <AlertTriangle size={13} /> {label} unavailable{reason ? ` — ${reason}` : ""}
        </span>
      )}

      {open && available && (
        <div role="dialog" aria-modal="true" aria-label={`${label} for ${leadId}`} data-operator-preview-modal
          className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button ref={closeRef} type="button" onClick={close} data-operator-preview-back aria-label="Back"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[13px] text-chalk-100 hover:bg-white/10">
              <ArrowLeft size={15} /> Back
            </button>
            <div className="min-w-0 text-center text-[12px] text-chalk-400">
              {source ? `${source}` : "operator preview"}{revisionId ? ` · ${revisionId}` : ""}{note ? ` · ${note}` : ""}
            </div>
            <button type="button" onClick={close} data-operator-preview-close aria-label="Close preview"
              className="inline-flex items-center justify-center rounded-lg border border-white/15 p-2 text-chalk-100 hover:bg-white/10">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 pb-4" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <video data-operator-preview-video src={url} controls playsInline preload="metadata"
              className="max-h-full max-w-full rounded-lg" style={{ aspectRatio: "9 / 16" }} />
          </div>
          <div className="flex items-center justify-center gap-3 px-4 pb-5">
            <button type="button" onClick={download} data-operator-preview-download disabled={!!dl && dl.pct > 0 && dl.pct < 100}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] text-chalk-100 hover:bg-white/15 disabled:opacity-50">
              {dl && dl.pct > 0 && dl.pct < 100 ? <><Loader2 size={14} className="animate-spin" /> {dl.pct}%</> : <><Download size={14} /> Download</>}
            </button>
            {dl && (dl.pct === 0 || dl.pct === 100) && <span className="text-[12px] text-chalk-400">{dl.msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
