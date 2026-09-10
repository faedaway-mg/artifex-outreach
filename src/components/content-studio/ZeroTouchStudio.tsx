"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH normal surface (mandate §13/§14/§17/§19/§21).
//
// The normal operator experience: a content idea + a short brief + [Generate] → a calm
// "Creating your video…" progression → a finished playable 9:16 social video. NO production
// machinery here (no narration-script editor, Copy Narration, voice selector, Generate
// Voiceover, Upload Voiceover, audio-format instructions, separate Generate Video, render
// internals). All of that lives ONLY behind "Advanced / Generation details", which mounts
// the full existing workspace on demand — so the machinery is genuinely absent from the
// normal DOM, not merely hidden.
//
// Migration (§21): an existing Field Note with a finished video shows Ready + Play; one with
// only a concept shows Generate. Nothing is bulk-regenerated.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { Sparkles, Play, RefreshCw, Loader2, Settings2, ArrowLeft } from "lucide-react";
import { isProspectVideo } from "@/lib/content-studio/workflow";
import { ZERO_TOUCH_STAGE_LABEL, type ZeroTouchStage } from "@/lib/content-studio/zero-touch";
import { generateZeroTouch } from "@/lib/content-studio/zero-touch-actions";
import { ContentStudioClient } from "./ContentStudioClient";
import type { StudioItem } from "./types";

type AdvancedProps = React.ComponentProps<typeof ContentStudioClient>;

function stageFor(item: StudioItem): { stage: ZeroTouchStage; generating: boolean; finished: boolean } {
  const jobs = item.jobs ?? [];
  const finished = !!item.piece.recommendedRel || jobs.some((j) => j.status === "ready");
  const rendering = jobs.some((j) => j.status === "rendering");
  const queued = jobs.some((j) => j.status === "queued");
  const failed = !finished && jobs.length > 0 && jobs.every((j) => j.status === "failed");
  const generating = rendering || queued;
  const stage: ZeroTouchStage = finished && !generating ? "READY" : rendering ? "BUILDING_VIDEO" : queued ? "FINISHING" : failed ? "FAILED" : "DRAFT";
  return { stage, generating, finished };
}

function playUrl(item: StudioItem): string {
  return item.piece.recommendedRel || `/api/content-studio/media/${encodeURIComponent(item.piece.id)}`;
}

function ZeroTouchCard({ item }: { item: StudioItem }) {
  const { stage, generating, finished } = stageFor(item);
  const [brief, setBrief] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const busy = pending || generating;

  const generate = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await generateZeroTouch({ pieceId: item.piece.id, brief: brief.trim() || item.piece.concept || item.piece.title });
      if (!res.ok) setMsg(res.reason ?? "could not generate");
    });
  };

  return (
    <div data-testid={`cs-card-${item.piece.id}`} data-stage={stage} className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-chalk-100">{item.piece.title}</p>
          {item.piece.concept && <p className="truncate text-[11px] text-chalk-500">{item.piece.concept}</p>}
        </div>
        <span className="shrink-0 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-chalk-400">9:16</span>
      </div>

      {/* Finished video → inline 9:16 player. */}
      {finished && !generating && (
        <div className="mx-auto mt-3 aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
          <video data-testid="cs-finished-video" controls playsInline preload="metadata" poster={item.piece.thumbRel || undefined} className="h-full w-full">
            <source src={playUrl(item)} type="video/mp4" />
          </video>
        </div>
      )}

      {/* Generating → calm high-level state only. */}
      {generating && (
        <div data-testid="cs-generating-state" className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-sm text-chalk-300">
          <Loader2 size={15} className="animate-spin text-teal-300" /> {ZERO_TOUCH_STAGE_LABEL[stage] ?? "Creating your video…"}
        </div>
      )}

      {/* Brief + one action. */}
      {!generating && (
        <div className="mt-3 space-y-2">
          <textarea
            data-testid="cs-brief-input"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={finished ? "Refine the idea to regenerate…" : "Describe the idea in a sentence or two — we'll write and build the video."}
            rows={2}
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-chalk-100 placeholder:text-chalk-600 focus:border-white/20 focus:outline-none"
          />
          <button
            data-testid={finished ? "cs-regenerate-button" : "cs-generate-button"}
            onClick={generate}
            disabled={busy}
            className="btn-primary flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-50"
          >
            {finished ? <RefreshCw size={15} /> : <Sparkles size={15} />} {finished ? "Regenerate" : "Generate"}
          </button>
          {msg && <p className="text-[11px] text-coral-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export function ZeroTouchStudio({ items, advancedProps, startAdvanced }: { items: StudioItem[]; advancedProps: AdvancedProps; startAdvanced?: boolean }) {
  const [advanced, setAdvanced] = useState(!!startAdvanced);

  // Social Field Notes only — prospect/proposal production stays in Advanced (non-regressing).
  const social = useMemo(() => items.filter((it) => !isProspectVideo(it.piece)), [items]);

  if (advanced) {
    return (
      <div className="space-y-4">
        <button data-testid="cs-simple-toggle" onClick={() => setAdvanced(false)} className="btn-ghost flex items-center gap-1.5 text-xs">
          <ArrowLeft size={13} /> Back to simple
        </button>
        {/* The full existing workspace (machinery, history, prospect flows) — mounted ONLY in Advanced. */}
        <ContentStudioClient {...advancedProps} />
      </div>
    );
  }

  return (
    <div data-testid="content-studio-zero-touch" className="space-y-5">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="label">Content Studio</p>
          <h2 className="mt-0.5 text-lg font-semibold text-chalk-50">Field Notes — idea in, video out</h2>
          <p className="mt-0.5 text-xs text-chalk-500">Write the idea. We write the script, narrate it in the Artifex voice, build the 9:16 video, and finish it.</p>
        </div>
        <button data-testid="cs-advanced-toggle" onClick={() => setAdvanced(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
          <Settings2 size={14} /> Advanced / Generation details
        </button>
      </div>

      {social.length === 0 ? (
        <div className="card p-6 text-center text-sm text-chalk-500">No Field Notes yet. Use Advanced to start a new one.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {social.map((it) => <ZeroTouchCard key={it.piece.id} item={it} />)}
        </div>
      )}
    </div>
  );
}
