"use client";
import { useRef, useState } from "react";

// Viewing-page player. A lightweight FROZEN poster <img> is the base layer, so the frame is NEVER black
// before playback — even on an empty cache / throttled phone connection. The <video> uses preload="none"
// and is revealed only when the visitor taps Play (user-initiated — NOT autoplay). Range/seek/controls
// are preserved by the media route; poster + video are the same version-bound share token.
export function ShareVideo({ token }: { token: string }) {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const poster = `/api/v/${token}/poster`;
  const src = `/api/v/${token}/video`;

  const play = () => {
    setStarted(true);
    // play() after a user gesture — allowed, and not autoplay.
    requestAnimationFrame(() => ref.current?.play().catch(() => {}));
  };

  return (
    <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-lg bg-ink-950" style={{ aspectRatio: "9 / 16" }}>
      {/* Base poster — paints first. */}
      {!posterFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="Video preview" onError={() => setPosterFailed(true)} className={`absolute inset-0 h-full w-full object-contain transition-opacity ${started ? "opacity-0" : "opacity-100"}`} />
      )}
      <video
        ref={ref}
        playsInline
        preload="none"
        controls={started}
        src={src}
        onError={() => setError(true)}
        className={`absolute inset-0 h-full w-full transition-opacity ${started ? "opacity-100" : "opacity-0"}`}
      />
      {!started && !error && (
        <button onClick={play} aria-label="Play video" className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/85 p-4 text-center">
          <p className="text-sm text-chalk-200">This video couldn’t load right now.<br /><span className="text-xs text-chalk-500">Refresh, or reply to the email and we’ll send a fresh link.</span></p>
        </div>
      )}
    </div>
  );
}
