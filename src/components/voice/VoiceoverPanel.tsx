"use client";
import { useCallback, useState } from "react";
import { Mic, Loader2, CircleCheck, CircleAlert, RefreshCw, Volume2 } from "lucide-react";

// The SAFE result shape from POST /api/content-studio/voiceover/generate. NEVER carries a raw provider
// voiceId or key — only a display name, a servable voiceover id, and a duration.
interface GenerateResult {
  status: "reused" | "ready" | "legacy" | "not_configured" | "failed";
  voiceoverId?: string;
  durationSeconds?: number | null;
  voice?: string;
  reason?: string;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "ready"; voiceoverId: string; durationSeconds: number | null }
  | { kind: "failed"; reason: string };

export interface VoiceoverPanelProps {
  leadId: string;
  narrationId: string;
  /** The exact narration text to speak (authoritative). */
  narrationScript: string;
  offerId?: string | null;
  /** Operator-facing display name — "Matt" or "Lucas — Legacy". NEVER a raw provider id. */
  voiceDisplayName?: string;
  /** True for a legacy voice: assets are preserved, no new audio is generated (no Generate button). */
  legacy?: boolean;
  /** Optional already-generated voiceover to preview on first mount. */
  initialVoiceoverId?: string | null;
  initialDurationSeconds?: number | null;
  /** Whether generation is currently possible (parent gate — e.g. narration present, evidence cleared). */
  disabled?: boolean;
  disabledReason?: string;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

// Voiceover panel for one narration. Shows the journey voice by DISPLAY NAME only, the narration status
// (Generating / Ready ✓ / Failed), an audio preview pointed at the private audio route, the duration, and
// a Generate / Regenerate control. Regeneration warns first and sends force:true. A legacy Lucas journey
// shows "Voice: Lucas — Legacy", indicates its assets are preserved, and offers NO Generate button.
export function VoiceoverPanel(props: VoiceoverPanelProps) {
  const {
    leadId,
    narrationId,
    narrationScript,
    offerId,
    voiceDisplayName,
    legacy,
    initialVoiceoverId,
    initialDurationSeconds,
    disabled,
    disabledReason,
  } = props;

  const [voice, setVoice] = useState<string>(voiceDisplayName ?? (legacy ? "Lucas — Legacy" : "Matt"));
  const [state, setState] = useState<PanelState>(
    initialVoiceoverId
      ? { kind: "ready", voiceoverId: initialVoiceoverId, durationSeconds: initialDurationSeconds ?? null }
      : { kind: "idle" },
  );
  const [note, setNote] = useState<string | null>(null);

  const generate = useCallback(
    async (force: boolean) => {
      if (legacy) return; // legacy voices never generate new audio
      if (force && !window.confirm("Regenerate this voiceover? This creates a NEW audio asset and supersedes the current one. The previous asset is retained for audit.")) {
        return;
      }
      setState({ kind: "generating" });
      setNote(null);
      try {
        const r = await fetch("/api/content-studio/voiceover/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, narrationId, narrationScript, offerId: offerId ?? undefined, force }),
        });
        const d = (await r.json().catch(() => ({}))) as GenerateResult & { error?: string };
        if (d.voice) setVoice(d.voice);
        if (!r.ok || d.status === "failed") {
          setState({ kind: "failed", reason: d.reason || d.error || "Voiceover generation failed." });
          return;
        }
        if (d.status === "not_configured") {
          setState({ kind: "failed", reason: d.reason || "Voice generation is not configured." });
          return;
        }
        if (d.status === "legacy") {
          setNote(d.reason || "This is a legacy voice — its assets are preserved and no new audio is generated.");
          setState({ kind: "idle" });
          return;
        }
        if (d.voiceoverId) {
          setState({ kind: "ready", voiceoverId: d.voiceoverId, durationSeconds: d.durationSeconds ?? null });
          setNote(d.status === "reused" ? "Reused the existing voiceover for this narration." : null);
        } else {
          setState({ kind: "failed", reason: "No voiceover returned." });
        }
      } catch (e: any) {
        setState({ kind: "failed", reason: String(e?.message ?? e) });
      }
    },
    [legacy, leadId, narrationId, narrationScript, offerId],
  );

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-chalk-100">
          <Mic size={15} className="text-amber-300" /> Voiceover
        </h4>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 text-[11px] text-chalk-300">
          <Volume2 size={12} className="text-teal-300" /> Voice: {voice}
        </span>
      </div>

      {/* Legacy Lucas journey — assets preserved, no generation. */}
      {legacy ? (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs text-chalk-400">
          This journey uses the legacy Lucas voice. Existing audio is preserved and remains valid; no new voiceover is generated for legacy voices.
          {state.kind === "ready" && (
            <audio controls preload="none" className="mt-2 w-full" src={`/api/content-studio/voiceover/${encodeURIComponent(state.voiceoverId)}/audio`} />
          )}
        </div>
      ) : (
        <>
          {/* Status line */}
          <div className="mb-2 flex items-center gap-2 text-xs">
            {state.kind === "generating" && (
              <span className="inline-flex items-center gap-1.5 text-amber-200"><Loader2 size={13} className="animate-spin" /> Generating…</span>
            )}
            {state.kind === "ready" && (
              <span className="inline-flex items-center gap-1.5 text-teal-200">
                <CircleCheck size={13} /> Ready ✓{fmtDuration(state.durationSeconds) ? ` · ${fmtDuration(state.durationSeconds)}` : ""}
              </span>
            )}
            {state.kind === "failed" && (
              <span className="inline-flex items-center gap-1.5 text-coral-200"><CircleAlert size={13} /> Failed</span>
            )}
            {state.kind === "idle" && <span className="text-chalk-500">No voiceover generated yet.</span>}
          </div>

          {/* Preview */}
          {state.kind === "ready" && (
            <audio controls preload="none" className="mb-2 w-full" src={`/api/content-studio/voiceover/${encodeURIComponent(state.voiceoverId)}/audio`} />
          )}

          {/* Failure detail + retry */}
          {state.kind === "failed" && (
            <div className="mb-2 rounded-lg border border-coral-400/30 bg-coral-400/[0.06] px-3 py-2 text-[11.5px] text-coral-100">
              {state.reason}
            </div>
          )}

          {note && <p className="mb-2 text-[11px] text-chalk-500">{note}</p>}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {state.kind === "ready" ? (
              <button
                onClick={() => void generate(true)}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-chalk-200 hover:bg-white/5 disabled:opacity-40"
              >
                <RefreshCw size={13} /> Regenerate Voiceover
              </button>
            ) : (
              <button
                onClick={() => void generate(false)}
                disabled={disabled || state.kind === "generating"}
                title={disabled ? disabledReason : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-400/25 bg-teal-400/10 px-3 py-1.5 text-xs text-teal-200 hover:bg-teal-400/[0.16] disabled:opacity-40"
              >
                {state.kind === "generating" ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
                {state.kind === "failed" ? "Retry" : "Generate Voiceover"}
              </button>
            )}
            {disabled && disabledReason && <span className="text-[11px] text-chalk-500">{disabledReason}</span>}
          </div>
        </>
      )}
    </div>
  );
}
