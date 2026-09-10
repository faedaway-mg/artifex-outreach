"use client";
// ─────────────────────────────────────────────────────────────────────────────
// EXPLAINER QA GALLERY — client surface (§9/§30). Coverage summary + a card per required
// explainer with an inline LARGE 16:9 player, the Breakbot media checklist (status, alive-
// through, timeline sampling, findings), the asset lineage, and the operator's creative
// sign-off tied to the exact asset revision. Breakbot correctness is shown first; the human
// review is an additional sign-off that can never clear a Breakbot blocker.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, XCircle, CircleDashed, Clock, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { setExplainerReviewAction } from "@/lib/breakbot-actions";
import type { GalleryModel, GalleryCard, CardStatus } from "@/lib/breakbot/explainer-gallery";

const BADGE: Record<CardStatus, { cls: string; label: string }> = {
  PASS: { cls: "border-teal-400/40 bg-teal-400/10 text-teal-200", label: "PASS" },
  WARNING: { cls: "border-amber-400/40 bg-amber-400/10 text-amber-200", label: "WARNING" },
  BLOCKED: { cls: "border-coral-400/40 bg-coral-400/10 text-coral-200", label: "BLOCKED" },
  MISSING: { cls: "border-coral-400/40 bg-coral-400/10 text-coral-200", label: "MISSING" },
  STALE: { cls: "border-amber-400/40 bg-amber-400/10 text-amber-200", label: "STALE" },
  NOT_RUN: { cls: "border-white/[0.12] bg-white/[0.04] text-chalk-300", label: "NOT RUN" },
};

function StatusBadge({ status }: { status: CardStatus }) {
  const b = BADGE[status];
  return <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide", b.cls)}>{b.label}</span>;
}

function Timeline({ card }: { card: GalleryCard }) {
  if (!card.timeline || card.timeline.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] text-chalk-500">Visual continuity across the runtime</p>
      <div className="mt-1 flex items-end gap-[3px]">
        {card.timeline.map((t) => (
          <div key={t.pct} className="flex flex-col items-center gap-0.5" title={`${t.pct}% (${t.atSeconds.toFixed(1)}s): ${t.alive ? "alive" : "blank/frozen"}`}>
            <div className={cn("w-3 rounded-sm", t.alive ? "bg-teal-400/70" : "bg-coral-400/80")} style={{ height: `${Math.max(4, Math.min(28, t.byteSize / 3500))}px` }} />
            <span className="text-[8px] text-chalk-600">{t.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewControls({ card }: { card: GalleryCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const blockedForReview = card.status === "BLOCKED" || card.status === "MISSING";

  const submit = (verdict: "reviewed" | "needs-fix") => {
    setMsg(null);
    startTransition(async () => {
      const res = await setExplainerReviewAction(card.scope, verdict);
      if (!res.ok) setMsg(res.reason ?? "could not record review");
      else router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-chalk-500">Operator creative sign-off (this revision)</p>
        {card.humanReview && (
          <span className={cn("text-[11px]", card.humanReview.valid ? (card.humanReview.verdict === "reviewed" ? "text-teal-300" : "text-coral-300") : "text-chalk-600")}>
            {card.humanReview.valid ? (card.humanReview.verdict === "reviewed" ? "Reviewed ✓" : "Needs fix") : "prior review (stale — asset changed)"}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => submit("reviewed")}
          disabled={pending || blockedForReview}
          className="rounded-lg border border-teal-400/30 bg-teal-400/5 px-3 py-1.5 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/10 disabled:opacity-40"
          title={blockedForReview ? "Breakbot blocks this asset — resolve it first" : undefined}
        >
          Reviewed — Looks Good
        </button>
        <button
          onClick={() => submit("needs-fix")}
          disabled={pending}
          className="rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-chalk-200 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
        >
          Needs Fix
        </button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-coral-300">{msg}</p>}
      {card.needsHumanReview && !card.humanReview?.valid && !blockedForReview && (
        <p className="mt-2 text-[11px] text-amber-300/80">Awaiting your sign-off.</p>
      )}
    </div>
  );
}

function Card({ card }: { card: GalleryCard }) {
  const orientationBad = card.orientation != null && card.orientation !== card.expectedOrientation;
  return (
    <div data-testid={`explainer-card-${card.scope}`} data-status={card.status} className={cn("card p-4", card.status === "BLOCKED" || card.status === "MISSING" ? "border-coral-400/20" : card.status === "PASS" ? "border-teal-400/15" : "border-white/[0.06]")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-chalk-100">{card.title}</p>
          <p className="text-[11px] text-chalk-500">{card.scope}</p>
        </div>
        <StatusBadge status={card.status} />
      </div>
      <p className="mt-1.5 text-xs text-chalk-400">{card.purpose}</p>

      {/* Inline LARGE 16:9 player (§9). */}
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
        {card.servedMp4Url ? (
          <video
            data-testid={`explainer-player-${card.scope}`}
            controls
            playsInline
            preload="metadata"
            poster={card.posterUrl ?? undefined}
            className="h-full w-full"
          >
            <source src={card.servedMp4Url} type="video/mp4" />
            {card.captionsUrl && card.captionsVerified && <track kind="captions" src={card.captionsUrl} default />}
          </video>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-coral-300">No canonical asset — MISSING</div>
        )}
      </div>

      {/* Meta: orientation contract, duration, voice, lineage. */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Meta label="Orientation" value={`${card.orientation ?? "—"} ${card.aspectRatio ?? ""}`} bad={orientationBad} />
        <Meta label="Contract" value="landscape 16:9" />
        <Meta label="Duration" value={card.durationSeconds ? `${card.durationSeconds.toFixed(1)}s${card.audioSeconds ? ` (audio ${card.audioSeconds.toFixed(1)}s)` : ""}` : "—"} />
        <Meta label="Voice" value={card.voice ? (card.voice === "matt" ? "Matt" : "Lucas (legacy)") : "—"} />
        <Meta label="Source" value={card.source === "matt-bound" ? "Matt bound" : card.source === "legacy-lucas" ? "Legacy Lucas" : "missing"} />
        <Meta label="Visual master" value={card.visualMaster ?? "—"} />
        <Meta label="Captions" value={card.captionsVerified ? "verified" : "unverified (off)"} bad={!card.captionsVerified && card.source !== "missing"} />
        <Meta label="Voiceover" value={card.voiceoverId ?? "—"} />
      </div>

      {/* Breakbot media checklist. */}
      <div className="mt-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-chalk-300">Breakbot media QA</p>
          <MediaStateChip card={card} />
        </div>
        {card.aliveThroughPct != null && (
          <p className="mt-1 text-[11px] text-chalk-500">Visuals alive through <span className={cn(card.aliveThroughPct >= 95 ? "text-teal-300" : "text-coral-300")}>{card.aliveThroughPct}%</span> of runtime</p>
        )}
        {card.breakbotFindings.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {card.breakbotFindings.map((f, i) => (
              <li key={i} className={cn("text-[11px]", f.severity === "BLOCKER" ? "text-coral-300" : "text-amber-300")}>
                {f.severity === "BLOCKER" ? "✗" : "⚠"} {f.kind} — {f.detail}
              </li>
            ))}
          </ul>
        ) : card.mediaState === "NOT_RUN" ? (
          <p className="mt-1 text-[11px] text-chalk-600">Not sampled yet — run <code className="text-chalk-400">pnpm breakbot:explainer-qa</code>.</p>
        ) : (
          <p className="mt-1 text-[11px] text-teal-300/80">No media defects across the sampled timeline.</p>
        )}
        <Timeline card={card} />
        {card.breakbotProbedAt && <p className="mt-1.5 text-[10px] text-chalk-600">probed {new Date(card.breakbotProbedAt).toLocaleString()}</p>}
      </div>

      <ReviewControls card={card} />
    </div>
  );
}

function Meta({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="text-chalk-600">{label}: </span>
      <span className={cn("truncate", bad ? "text-coral-300" : "text-chalk-300")}>{value}</span>
    </div>
  );
}

function MediaStateChip({ card }: { card: GalleryCard }) {
  const map: Record<string, { icon: JSX.Element; cls: string }> = {
    PASS: { icon: <CheckCircle2 size={12} />, cls: "text-teal-300" },
    WARNING: { icon: <AlertTriangle size={12} />, cls: "text-amber-300" },
    BLOCKED: { icon: <XCircle size={12} />, cls: "text-coral-300" },
    STALE: { icon: <Clock size={12} />, cls: "text-amber-300" },
    NOT_RUN: { icon: <CircleDashed size={12} />, cls: "text-chalk-500" },
  };
  const m = map[card.mediaState] ?? map.NOT_RUN;
  return <span className={cn("flex items-center gap-1 text-[11px] font-medium", m.cls)}>{m.icon}{card.mediaState}</span>;
}

export function ExplainerGallery({ model, escapedTotal }: { model: GalleryModel; escapedTotal: number }) {
  const s = model.summary;
  return (
    <div className="space-y-6">
      {/* Coverage summary (§9). */}
      <div data-testid="explainer-coverage-summary" className={cn("card p-5", model.coverageComplete ? "border-teal-400/30" : (s.blocked > 0 || s.missing > 0) ? "border-coral-400/30" : "border-amber-400/30")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label">Explainer QA Gallery</p>
            <h2 className="mt-1 text-lg font-semibold text-chalk-50">
              {s.healthy}/{s.total} explainers healthy
              {model.coverageComplete ? " — coverage complete" : s.missing > 0 ? ` — ${s.missing} MISSING` : s.blocked > 0 ? ` — ${s.blocked} BLOCKED` : ""}
            </h2>
            <p className="mt-1 text-xs text-chalk-500">
              Breakbot checks technical correctness first; your sign-off is an additional creative review. A missing or blocked explainer is never hidden.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Count label="PASS" n={s.pass} cls="text-teal-300" />
            <Count label="WARN" n={s.warning} cls="text-amber-300" />
            <Count label="BLOCKED" n={s.blocked} cls="text-coral-300" />
            <Count label="MISSING" n={s.missing} cls="text-coral-300" />
            <Count label="STALE" n={s.stale} cls="text-amber-300" />
            <Count label="NOT RUN" n={s.notRun} cls="text-chalk-400" />
            <Count label="REVIEWED" n={s.reviewed} cls="text-teal-300" />
          </div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-chalk-600"><Ban size={12} /> {escapedTotal} escaped-defect classes are now permanent Breakbot regressions.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {model.cards.map((c) => <Card key={c.scope} card={c} />)}
      </div>
    </div>
  );
}

function Count({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-center">
      <span className={cn("font-semibold", cls)}>{n}</span> <span className="text-chalk-600">{label}</span>
    </div>
  );
}
