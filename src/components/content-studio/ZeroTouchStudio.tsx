"use client";
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — CURATED IDEA FEED (mandate §13/§14/§17/§19/§21 + idea-queue mandate D).
//
// The system does the ideation; the operator curates. The page is a scrollable feed of
// Artifex Field Note concepts — each already carries a title, a hook, and an auto-written
// creative brief describing exactly what the video will say. The operator reads a card,
// decides "make this", and presses Generate → a calm "Creating your video…" progression →
// a finished 9:16 video with a Download action, ALL on the card.
//
// There is NO per-card freeform textarea (the system generated the idea; the operator
// doesn't re-describe it). ONE optional top-level "Create an idea" field steers new idea
// generation (cheap, no video spend). NO production machinery here (no narration editor,
// voice selector, upload, separate render controls) — all of that lives ONLY behind
// "Advanced / Generation details". Matt is automatic. Resource-aware: the capacity card +
// a per-generation forecast make every Generate financially legible.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { Sparkles, RefreshCw, Loader2, Settings2, ArrowLeft, Gauge, ShieldAlert, Download, X, Wand2 } from "lucide-react";
import type { VoiceCapacity } from "@/lib/voice/capacity";
import { capacityCardModel, capacityForecastModel } from "@/lib/voice/capacity-view";
import type { IdeaCard } from "@/lib/content-studio/idea-feed";
import { generateIdeaAction, archiveIdeaAction, generateIdeaVideoAction } from "@/lib/content-studio/idea-actions";
import { ContentStudioClient } from "./ContentStudioClient";

type AdvancedProps = React.ComponentProps<typeof ContentStudioClient>;

function IdeaFeedCard({ idea, capacity }: { idea: IdeaCard; capacity: VoiceCapacity | null }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [reserveBlock, setReserveBlock] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const generating = idea.state === "GENERATING";
  const finished = idea.state === "READY" && idea.finished;
  const failed = idea.state === "FAILED";
  const busy = pending || generating;
  const forecast = capacityForecastModel(capacity, idea.targetSeconds);

  const run = (override: boolean) => {
    setMsg(null);
    startTransition(async () => {
      const res = await generateIdeaVideoAction(idea.id, override);
      if (res.needsOverride) { setReserveBlock(res.reason ?? "This generation would use capacity reserved for Acquisition."); return; }
      setReserveBlock(null);
      if (!res.ok) setMsg(res.reason ?? "could not generate");
    });
  };
  const archive = () => startTransition(async () => { await archiveIdeaAction(idea.id); setDismissed(true); });

  if (dismissed) return null;

  return (
    <div data-testid={`cs-idea-card-${idea.id}`} data-state={idea.state} className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-chalk-50">{idea.title}</p>
          <p className="mt-0.5 text-[12px] text-chalk-400">{idea.hook}</p>
        </div>
        <span className="shrink-0 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-chalk-400">9:16</span>
      </div>

      {/* The auto-written creative brief — the operator reads this instead of writing one. */}
      {!finished && !generating && (
        <p data-testid="cs-idea-brief" className="mt-2 text-[12.5px] leading-relaxed text-chalk-300">{idea.brief}</p>
      )}

      {/* Finished video → inline 9:16 player + Download. */}
      {finished && (
        <div className="mt-3 space-y-2">
          <div className="mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
            <video data-testid="cs-finished-video" controls playsInline preload="metadata" poster={idea.posterUrl || undefined} className="h-full w-full">
              {idea.mediaUrl && <source src={idea.mediaUrl} type="video/mp4" />}
            </video>
          </div>
          <p className="text-center text-[11px] text-chalk-500">9:16 · Matt</p>
        </div>
      )}

      {/* Generating → calm high-level state only. */}
      {generating && (
        <div data-testid="cs-generating-state" className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-sm text-chalk-300">
          <Loader2 size={15} className="animate-spin text-teal-300" /> Creating your video…
        </div>
      )}

      {/* Resource-aware forecast — how much THIS video will use (visibility, not a control panel). */}
      {!generating && forecast && !reserveBlock && (
        <p data-testid="cs-generation-forecast" className="mt-2 text-[11px] text-chalk-500">{forecast.summary}</p>
      )}

      <div className="mt-3 flex-1" />

      {/* Actions. Reserve boundary → explicit single-generation override. */}
      {!generating && (
        reserveBlock ? (
          <div data-testid="cs-reserve-block" className="space-y-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200"><ShieldAlert size={13} /> Acquisition capacity reserved</p>
            <p className="text-[11px] text-chalk-400">{reserveBlock}</p>
            <div className="flex gap-2">
              <button data-testid="cs-keep-reserve" onClick={() => setReserveBlock(null)} disabled={busy} className="btn-ghost flex-1 text-xs">Keep Reserve</button>
              <button data-testid="cs-generate-anyway" onClick={() => run(true)} disabled={busy} className="btn-secondary flex-1 text-xs">Generate Anyway</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {finished ? (
              <>
                <a data-testid="cs-download" href={idea.downloadUrl || "#"} download className="btn-primary flex flex-1 items-center justify-center gap-1.5 text-sm">
                  <Download size={15} /> Download
                </a>
                <button data-testid="cs-regenerate-button" onClick={() => run(false)} disabled={busy} className="btn-secondary flex items-center justify-center gap-1.5 text-sm" title="Make another version">
                  <RefreshCw size={15} />
                </button>
              </>
            ) : (
              <button data-testid="cs-generate-button" onClick={() => run(false)} disabled={busy} className="btn-primary flex flex-1 items-center justify-center gap-1.5 text-sm disabled:opacity-50">
                {failed ? <><RefreshCw size={15} /> Try again</> : <><Sparkles size={15} /> Generate</>}
              </button>
            )}
            <button data-testid="cs-archive-idea" onClick={archive} disabled={busy} className="btn-ghost px-2 text-xs text-chalk-500" title="Not for me">
              <X size={14} />
            </button>
          </div>
        )
      )}
      {msg && <p className="mt-1 text-[11px] text-coral-300">{msg}</p>}
    </div>
  );
}

/** The compact, always-visible voice-capacity card (mandate C §1). Honest-unknown aware. */
function CapacityCard({ capacity }: { capacity: VoiceCapacity | null }) {
  if (!capacity) return null;
  const m = capacityCardModel(capacity);
  const tone =
    m.statusTone === "ok" ? "text-teal-300" : m.statusTone === "warn" ? "text-amber-300" : m.statusTone === "hold" ? "text-coral-300" : "text-chalk-500";
  return (
    <div data-testid="cs-capacity-card" data-status={m.status} className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="label flex items-center gap-1.5"><Gauge size={13} /> Voice capacity</p>
        <span data-testid="cs-capacity-status" className={`text-[11px] font-medium ${tone}`}>{m.statusLabel}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
        <Row label="Monthly allowance" value={m.allowance} />
        <Row label="Used" value={m.used} />
        <Row label="Remaining" value={m.remaining} />
        <Row label="Reserved for Acquisition" value={m.reserved} hint={m.reservedBasis === "fallback" ? "fallback" : undefined} />
        <Row label="Available for Social" value={m.available} />
        <Row label="Resets" value={m.resets} />
      </div>
      <p className="mt-2 text-[11px] text-chalk-500">Estimated social videos <span className="text-chalk-300">{m.estimatedSocialVideos}</span></p>
      {m.providerLine && <p className="mt-1 text-[10px] text-chalk-600">Provider: {m.providerLine}</p>}
      {m.unknownNote && <p className="mt-1 text-[10px] text-chalk-600">{m.unknownNote}</p>}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-chalk-600">{label}</span>
      <span className="text-chalk-100">{value}{hint && <span className="ml-1 text-[9px] text-chalk-600">({hint})</span>}</span>
    </div>
  );
}

/** The top-level idea-creation control — the ONLY creative text field (steers new ideas). */
function CreateIdea() {
  const [steer, setSteer] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const create = (useSteer: boolean) => {
    setMsg(null);
    startTransition(async () => {
      const res = await generateIdeaAction(useSteer ? steer.trim() : "", useSteer ? 1 : 2);
      if (!res.ok) setMsg(res.reason ?? "could not create an idea");
      else { if (res.added === 0 && res.reason) setMsg(res.reason); setSteer(""); }
    });
  };
  return (
    <div data-testid="cs-create-idea" className="card p-4">
      <p className="label">Create an idea</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          data-testid="cs-idea-input"
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          placeholder="What should we make a video about? (optional)"
          className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-chalk-100 placeholder:text-chalk-600 focus:border-white/20 focus:outline-none"
        />
        <div className="flex gap-2">
          <button data-testid="cs-generate-idea" onClick={() => create(true)} disabled={pending} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50">
            <Sparkles size={14} /> Generate idea
          </button>
          <button data-testid="cs-surprise-me" onClick={() => create(false)} disabled={pending} className="btn-ghost flex items-center gap-1.5 text-sm disabled:opacity-50">
            <Wand2 size={14} /> Surprise me
          </button>
        </div>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-chalk-500">{msg}</p>}
    </div>
  );
}

export function ZeroTouchStudio({ ideas, advancedProps, startAdvanced, capacity }: { ideas: IdeaCard[]; advancedProps: AdvancedProps; startAdvanced?: boolean; capacity?: VoiceCapacity | null }) {
  const [advanced, setAdvanced] = useState(!!startAdvanced);
  const feed = useMemo(() => ideas, [ideas]);

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
          <p className="mt-0.5 text-xs text-chalk-500">We come up with the ideas. You pick the good ones and press Generate — we write, narrate, build and finish the 9:16 video.</p>
        </div>
        <button data-testid="cs-advanced-toggle" onClick={() => setAdvanced(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
          <Settings2 size={14} /> Advanced / Generation details
        </button>
      </div>

      <CapacityCard capacity={capacity ?? null} />
      <CreateIdea />

      <div>
        <p className="label mb-2">Ideas</p>
        {feed.length === 0 ? (
          <div className="card p-6 text-center text-sm text-chalk-500">No ideas in the queue. Use “Surprise me” above to fill it.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feed.map((idea) => <IdeaFeedCard key={idea.id} idea={idea} capacity={capacity ?? null} />)}
          </div>
        )}
      </div>
    </div>
  );
}
