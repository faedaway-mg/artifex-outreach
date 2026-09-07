"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Film, Upload, Copy, Check, Download, Play, RefreshCw, Loader2, Plus, X,
  CircleCheck, CircleAlert, Clapperboard, Users, ExternalLink, Clock, Radio, Eye, Mail,
} from "lucide-react";
import { SectionHeader } from "@/components/ui";
import { clientVideoPieceId } from "@/lib/content-studio/client-video-routing";
import { renderLifecycle, canGenerate, type RenderState } from "@/lib/content-studio/render-lifecycle";
import { isProspectVideo } from "@/lib/content-studio/workflow";
import { fetchMediaFile, shareOrDownloadFile, type ShareOutcome } from "@/lib/content-studio/media-share";
import type { StudioItem, SafeJob } from "./types";
import type { WorkerHealth } from "@/lib/content-studio/worker-health";
import {
  PROPOSAL_GROUP_ORDER, PROPOSAL_GROUP_LABEL, CONTENT_GROUP_ORDER, CONTENT_GROUP_LABEL,
  type ProposalCard, type ContentCard, type ProposalGroup, type ContentGroup,
} from "@/lib/content-studio/video-workspace";

// The server-computed two-workspace split handed to the client (mandate 25 §B3–B5). Plain-serializable.
export interface StudioWorkspacesProp {
  activeType: "proposal" | "content";
  counts: { proposal: number; content: number; unclassified: number };
  proposal: { groups: Record<ProposalGroup, ProposalCard[]> };
  content: { groups: Record<ContentGroup, ContentCard[]> };
}

// PREVIEW MODE — a read-only, disabled-by-default visibility build. When on, EVERY mutating control is
// disabled and EVERY network call is short-circuited (belt: handlers return early; suspenders: buttons
// are disabled). Nothing enqueues a job, writes storage, sends, or claims success. Fixtures only.
const PreviewCtx = createContext(false);
const usePreview = () => useContext(PreviewCtx);

const POLL_MS = 1500;

// Mobile-first Share / Download (section I addendum). Fetches the authenticated media as a Blob and either
// hands a real File to the OS share sheet (Content Studio stays mounted underneath) or downloads it from a
// Blob object URL. NEVER navigates the browser to the raw media endpoint. Shows progress / success /
// cancellation / failure and always revokes the object URL.
function MediaActions({ url, filename, mimeType, label, primary }: { url: string; filename: string; mimeType: string; label: string; primary?: boolean }) {
  const preview = usePreview();
  const [state, setState] = useState<"idle" | "preparing" | "sharing" | ShareOutcome | "error">("idle");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const busy = state === "preparing" || state === "sharing";

  const canWebShare = typeof navigator !== "undefined" && !!(navigator as any).canShare && !!(navigator as any).share;

  async function run(forceDownload: boolean) {
    if (preview) { setErr("Disabled in preview — available in the functional environment."); setState("error"); return; }
    setErr(null); setPct(0); setState("preparing");
    try {
      const file = await fetchMediaFile(url, filename, mimeType, { fetch, onProgress: setPct });
      const nav = forceDownload ? {} : (navigator as any); // forceDownload → skip share sheet
      const res = await shareOrDownloadFile(file, filename, {
        navigator: nav,
        createObjectURL: (b) => URL.createObjectURL(b),
        revokeObjectURL: (u) => URL.revokeObjectURL(u),
        triggerDownload: (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); },
      });
      setState(res.outcome);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong"); setState("error");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <button disabled={busy} onClick={() => run(false)} className={`flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-50 sm:w-auto ${primary ? "btn-primary" : "btn-secondary"}`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {canWebShare ? `Share / download ${label}` : `Download ${label}`}
        </button>
        {canWebShare && (
          <button disabled={busy} onClick={() => run(true)} className="btn-ghost flex w-full items-center justify-center gap-1.5 text-xs disabled:opacity-50 sm:w-auto" title="Save the file directly">
            <Download size={13} /> Save file
          </button>
        )}
      </div>
      {state === "preparing" && <div className="h-1 w-full overflow-hidden rounded bg-white/10"><div className="h-full bg-azure-500 transition-all" style={{ width: `${pct || 4}%` }} /></div>}
      {state === "sharing" && <p className="text-[11px] text-chalk-500">Opening the share sheet…</p>}
      {state === "shared" && <p className="text-[11px] text-teal-300">Shared.</p>}
      {state === "downloaded" && <p className="text-[11px] text-teal-300">Saved to your device.</p>}
      {state === "cancelled" && <p className="text-[11px] text-chalk-500">Share cancelled.</p>}
      {state === "error" && <p className="text-[11px] text-rose-300">{err || "Failed — try again."}</p>}
    </div>
  );
}
const fmtBytes = (b: number) => (b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
const fmtDur = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

type DeepLink = { piece?: string | null; lead?: string | null; section?: string | null; from?: string | null };

export function ContentStudioClient({ initialItems, preview = false, deepLink, videosToCreate = 0, workerHealth, advanceHref, workspaces }: { initialItems: StudioItem[]; preview?: boolean; deepLink?: DeepLink; videosToCreate?: number; workerHealth?: WorkerHealth; advanceHref?: string; workspaces?: StudioWorkspacesProp }) {
  // A Today client-video task maps to the STABLE project id client-<leadId> (never name matching).
  const targetPieceId = deepLink?.piece || (deepLink?.lead ? clientVideoPieceId(deepLink.lead) : null);
  const [items, setItems] = useState<StudioItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string>(
    (targetPieceId && initialItems.some((it) => it.piece.id === targetPieceId) ? targetPieceId : initialItems[0]?.piece.id) ?? "",
  );
  const [jobOverride, setJobOverride] = useState<Record<string, SafeJob>>({});
  const [creating, setCreating] = useState(false);
  // Deep-link resolution: when Today points at a project that has no piece yet, we DON'T silently
  // create it — we surface a truthful "prepare this business's video" repair action (F.10/F.11).
  const [needsPrepareLead, setNeedsPrepareLead] = useState<string | null>(null);
  const didDeepLink = useRef(false);

  const refetch = useCallback(async () => {
    if (preview) return; // preview never re-fetches server state — fixtures only
    const r = await fetch("/api/content-studio/pieces", { cache: "no-store" });
    if (r.ok) { const { items } = await r.json(); setItems(items); }
  }, [preview]);

  // Merge any polled job overrides onto the snapshot jobs.
  const mergedItems = useMemo(
    () => items.map((it) => ({ ...it, jobs: it.jobs.map((j) => jobOverride[j.id] ?? j) })),
    [items, jobOverride],
  );
  const activeJobIds = useMemo(
    () => mergedItems.flatMap((it) => it.jobs).filter((j) => j.status === "queued" || j.status === "rendering").map((j) => j.id),
    [mergedItems],
  );

  // Poll active jobs; refetch the snapshot when any finishes (survives refresh — jobs are server-side).
  useEffect(() => {
    if (preview || !activeJobIds.length) return; // no polling in preview
    let stop = false;
    const tick = async () => {
      let terminal = false;
      await Promise.all(activeJobIds.map(async (id) => {
        try {
          const r = await fetch(`/api/content-studio/jobs/${id}`, { cache: "no-store" });
          if (r.ok) { const { job } = await r.json(); setJobOverride((o) => ({ ...o, [id]: job })); if (job.status === "ready" || job.status === "failed") terminal = true; }
        } catch { /* transient */ }
      }));
      if (terminal && !stop) await refetch();
    };
    const iv = setInterval(tick, POLL_MS); tick();
    return () => { stop = true; clearInterval(iv); };
  }, [activeJobIds.join(","), refetch, preview]);

  // Resolve the deep-link ONCE. If the target project exists, it's already selected above. If a Today
  // task references a business with no project yet, surface the repair/create action (never auto-create).
  useEffect(() => {
    if (didDeepLink.current || preview) return;
    didDeepLink.current = true;
    if (targetPieceId && !initialItems.some((it) => it.piece.id === targetPieceId) && deepLink?.lead) {
      setNeedsPrepareLead(deepLink.lead);
    }
  }, [targetPieceId, preview, initialItems, deepLink?.lead]);

  const selected = mergedItems.find((it) => it.piece.id === selectedId) ?? mergedItems[0];
  const backToToday = deepLink?.from === "today";

  // With the two tabs active, keep the selection INSIDE the active workspace: if the selected piece isn't in
  // the active tab, fall back to that tab's first card. Prevents a Content Video's detail from ever showing
  // under the Proposal tab (and vice-versa) — part of the no-cross-contamination guarantee.
  const activeCardIds = useMemo(() => {
    if (!workspaces) return null as string[] | null;
    const groups = workspaces.activeType === "proposal" ? workspaces.proposal.groups : workspaces.content.groups;
    const ids: string[] = [];
    for (const g of Object.values(groups)) for (const c of g as Array<{ id: string }>) ids.push(c.id);
    return ids;
  }, [workspaces]);
  const effectiveSelected = useMemo(() => {
    if (!workspaces || !activeCardIds) return selected;
    if (selected && activeCardIds.includes(selected.piece.id)) return selected;
    const firstId = activeCardIds[0];
    return mergedItems.find((it) => it.piece.id === firstId) ?? undefined;
  }, [workspaces, activeCardIds, selected, mergedItems]);

  // Focused one-company screen (Today → Start / prev-next): render ONLY the selected company's detail so
  // the active work (finding · PDF · email · narration · upload) is at the top — never a candidate list.
  if (advanceHref) {
    return (
      <PreviewCtx.Provider value={preview}>
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {selected ? (
            <PieceDetail key={selected.piece.id} item={selected} onChanged={refetch} setJobOverride={setJobOverride} advanceHref={advanceHref} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-[13px] text-chalk-400">Preparing this company… <Link href="/" className="text-azure-300">Back to Today</Link></div>
          )}
        </div>
      </PreviewCtx.Provider>
    );
  }

  return (
    <PreviewCtx.Provider value={preview}>
    <div className="space-y-5">
      {backToToday && (
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-chalk-400 hover:text-azure-300 ring-focus">
          <X size={13} className="rotate-45" /> Back to Today
        </Link>
      )}
      <SectionHeader
        title="Content Studio"
        subtitle="Social · Field Notes. Prepare narration, upload your voiceover, generate the video, preview and download — all from here."
        right={
          <div className="flex items-center gap-2">
            <Link href="/content-studio?section=client" className="btn-ghost flex items-center gap-1.5 text-xs" title="Prepare and render per-business prospect sales videos here">
              <Users size={14} /> Prospect videos
            </Link>
            <button disabled={preview} onClick={() => !preview && setCreating(true)} title={preview ? "Disabled in preview" : ""} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40"><Plus size={14} /> New video</button>
          </div>
        }
      />

      {preview && (
        <div className="card flex items-start gap-3 border-amber-400/30 bg-amber-400/[0.06] p-3.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-300"><Eye size={16} /></span>
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="font-semibold text-amber-200">Preview — rendering not connected.</p>
            <p className="mt-0.5 text-amber-100/80">
              This is a read-only visibility build showing the real Presentation Video and Social Content
              interfaces with demo content. Upload, generate, approve, publish, share and send are
              <span className="font-medium text-amber-100"> disabled</span> here — no jobs are enqueued, no
              storage is written, nothing is sent. The functional loop (upload → render → publish → download)
              deploys to an isolated environment next.
            </p>
          </div>
        </div>
      )}

      {/* Prospect/client workflow signpost — preserved, not replaced. */}
      <div className="card flex items-start gap-3 p-3.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-azure-300"><Clapperboard size={16} /></span>
        <p className="text-xs leading-relaxed text-chalk-400">
          <span className="font-medium text-chalk-200">Two separate workflows, one engine.</span> The public
          <span className="text-chalk-200"> Field Notes</span> (social content, with captioning and posting tools) are in the
          list below. <span className="text-chalk-200">Prospect video sales packages</span> (evidence-led, delivered to
          the prospect by secure link) are prepared in the
          <span className="text-chalk-200"> Prospect videos</span> panel above, bound to the business and its evidence.
          A Today "Prepare video" task opens that business's package here directly.
        </p>
      </div>

      {workerHealth && !preview && <WorkerHealthLine health={workerHealth} />}

      <ClientVideosPanel onPrepared={refetch} onSelect={setSelectedId} defaultOpen={deepLink?.section === "client" || !!needsPrepareLead} repairLead={needsPrepareLead} pendingCount={videosToCreate} />

      {/* ── Two top-level tabs (mandate 25): Proposal Videos vs Content Videos. URL-addressable via
          ?type=, so refresh persists and browser Back restores the tab. ─────────────────────────── */}
      {workspaces && <VideoTabs workspaces={workspaces} />}

      {/* Bounded two-column workspace: the list is height-capped + independently scrollable so it can NEVER
          grow the document or push the detail below it; the detail top-aligns beside it and scrolls on its own. */}
      <div className="grid gap-5 lg:grid-cols-[340px_1fr] lg:items-start">
        {/* ── Piece list (bounded scroll) ────────────────────────────── */}
        <div data-piece-list className="space-y-2 overflow-y-auto overscroll-contain max-h-[55vh] lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)] lg:min-h-0 [-webkit-overflow-scrolling:touch]">
          {workspaces
            ? <WorkspaceList workspaces={workspaces} selectedId={effectiveSelected?.piece.id ?? ""} onSelect={setSelectedId} />
            : mergedItems.map((it) => (
                <PieceRow key={it.piece.id} item={it} active={it.piece.id === selected?.piece.id} onClick={() => setSelectedId(it.piece.id)} />
              ))}
        </div>

        {/* ── Detail ─────────────────────────────────────────────────────
            With the two tabs active, MOBILE is a list/index only (mandate 26 §2): the detail is hidden and a
            card tap navigates to the dedicated full-page workspace instead of rendering an editor below the
            list. On desktop (lg+) the master-detail pane is shown and cards select in place. */}
        <div className={`min-w-0 lg:min-h-0 ${workspaces ? "hidden lg:block" : ""}`}>
          {effectiveSelected && <PieceDetail key={effectiveSelected.piece.id} item={effectiveSelected} onChanged={refetch} setJobOverride={setJobOverride} advanceHref={advanceHref} />}
        </div>
      </div>

      {creating && !preview && <NewPieceModal onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refetch(); }} />}
    </div>
    </PreviewCtx.Provider>
  );
}

// Render-worker heartbeat line (section J) — honest, from persisted job activity. "Active" only when a
// job is genuinely progressing; a silent backlog reads "degraded", never a false green.
function WorkerHealthLine({ health }: { health: WorkerHealth }) {
  const tone = health.verdict === "active" ? "text-teal-300" : health.verdict === "degraded" ? "text-amber-300" : "text-chalk-500";
  const dot = health.verdict === "active" ? "bg-teal-400" : health.verdict === "degraded" ? "bg-amber-400" : "bg-chalk-500";
  const label = health.verdict === "active" ? "Render worker active" : health.verdict === "degraded" ? "Render worker degraded" : "Render worker idle";
  const beat = health.lastActivityAt ? new Date(health.lastActivityAt).toLocaleString() : "no activity yet";
  return (
    <p className={`flex flex-wrap items-center gap-2 text-[11px] ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${health.verdict === "active" ? "animate-pulse" : ""}`} />
      {label}
      <span className="text-chalk-600">· last activity {beat}</span>
      {health.rendering > 0 && <span className="text-chalk-600">· {health.rendering} rendering</span>}
      {health.queued > 0 && <span className="text-chalk-600">· {health.queued} queued</span>}
      {health.stale > 0 && <span className="text-amber-300">· {health.stale} stalled (auto-recovering)</span>}
    </p>
  );
}

function ClientVideosPanel({ onPrepared, onSelect, defaultOpen = false, repairLead = null, pendingCount = 0 }: { onPrepared: () => Promise<void>; onSelect: (id: string) => void; defaultOpen?: boolean; repairLead?: string | null; pendingCount?: number }) {
  const preview = usePreview();
  const [open, setOpen] = useState(defaultOpen);
  const [cands, setCands] = useState<any[] | null>(null);
  const [leadId, setLeadId] = useState(repairLead ?? "");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    repairLead ? { tone: "err", text: "This Today task has no Content Studio project yet. Prepare it below to open its project — nothing is created automatically." } : null,
  );
  const [busy, setBusy] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) { setCands([]); return; } // preview: no server read, show the empty-state copy
    const r = await fetch("/api/content-studio/client/candidates", { cache: "no-store" });
    if (r.ok) { const d = await r.json(); setCands(d.candidates ?? []); }
  }, [preview]);
  useEffect(() => { if (open && cands === null) load(); }, [open, cands, load]);

  const prepare = async (id: string, allowOverride = false) => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview — connect the functional environment to prepare client videos." }); return; }
    setBusy(true); setPreparingId(id); setMsg(null);
    try {
      const r = await fetch("/api/content-studio/client/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: id, allowOverride }) });
      const d = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: d.error + (d.blockers?.length ? " (" + d.blockers.join("; ") + ")" : "") });
      else { setMsg({ tone: "ok", text: `Prepared for ${d.businessName ?? id}. ${d.narrationNote ?? ""} Upload a voiceover, then Generate.` }); await onPrepared(); onSelect(d.pieceId); }
    } catch (e: any) { setMsg({ tone: "err", text: String(e?.message ?? e) }); }
    finally { setBusy(false); setPreparingId(null); }
  };

  return (
    <div className="card p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-teal-300"><Users size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-chalk-100">Prospect video packages <span className="ml-1 rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-300">evidence-backed</span>{pendingCount > 0 && <span className="ml-1 rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">{pendingCount} to create</span>}</span>
          <span className="block text-xs text-chalk-500">Prepare a prospect sales video from a business's evidence — delivered by secure link, never posted to social.</span>
        </span>
        <span className="text-chalk-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
          {msg && <p className={`text-xs ${msg.tone === "ok" ? "text-teal-300" : "text-coral-300"}`}>{msg.text}</p>}
          {cands === null ? (
            <p className="text-xs text-chalk-500">Loading eligible businesses…</p>
          ) : cands.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-chalk-500">
              No businesses with stored evidence in this local store. Businesses live in the Acquisition OS database — connected to real data, eligible prospects appear here ranked by the review-video readiness gate. You can also prepare one directly by business ID below.
            </div>
          ) : (
            <div className="space-y-1.5">
              {cands.map((c) => (
                <div key={c.leadId} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-chalk-200">{c.businessName}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${c.eligible ? "border-teal-400/25 bg-teal-400/10 text-teal-300" : "border-white/10 text-chalk-400"}`}>{c.readiness}</span>
                  {c.eligible ? (
                    <button disabled={busy || preview} onClick={() => prepare(c.leadId)} className="btn-secondary text-[11px] disabled:opacity-40">{preparingId === c.leadId ? "Preparing…" : "Prepare"}</button>
                  ) : c.overridable ? (
                    <button disabled={busy || preview} onClick={() => prepare(c.leadId, true)} className="btn-ghost text-[11px] disabled:opacity-40" title={c.blockers?.join("; ")}>Override</button>
                  ) : (
                    <span className="text-[10px] text-chalk-600" title={c.blockers?.join("; ")}>blocked</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="business / lead ID" disabled={preview} className="input text-xs disabled:opacity-40" />
            <button disabled={busy || preview || !leadId.trim()} onClick={() => prepare(leadId.trim())} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />} {preparingId === leadId.trim() && busy ? "Preparing…" : "Prepare"}</button>
          </div>
          <p className="text-[11px] text-chalk-600">The readiness gate is unchanged — insufficient-evidence businesses stay blocked with reasons. Prepared videos are bound to their business and appear in the list above.</p>
        </div>
      )}
    </div>
  );
}

function SharePanel({ item }: { item: StudioItem }) {
  const preview = usePreview();
  const pieceId = item.piece.id;
  const [shares, setShares] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState<any | null>(null);

  const load = useCallback(async () => {
    if (preview) { setShares([]); return; } // preview: no server read
    const r = await fetch(`/api/content-studio/share?pieceId=${encodeURIComponent(pieceId)}`, { cache: "no-store" });
    if (r.ok) setShares((await r.json()).shares ?? []);
  }, [pieceId, preview]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (preview) { setMsg("Disabled in preview — hosted viewing links are created in the functional environment."); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/content-studio/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pieceId }) });
    const d = await r.json();
    if (!r.ok) setMsg(d.error); else { setMsg("Viewing link created."); await load(); }
    setBusy(false);
  };
  const revoke = async (token: string) => { if (preview) return; await fetch(`/api/content-studio/share/${token}/revoke`, { method: "POST" }); setEmail(null); await load(); };
  const prepare = async (token: string) => {
    if (preview) return;
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/content-studio/share/${token}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const d = await r.json();
    if (!r.ok) setMsg(d.error); else setEmail(d);
    setBusy(false);
  };
  const live = (shares ?? []).filter((s) => !s.revokedAt);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-teal-300"><ExternalLink size={15} /></span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-chalk-100">Sharing &amp; outreach</h4>
          <p className="text-xs text-chalk-500">Host the approved video on a branded link — no MP4 attached to email.</p>
        </div>
        <button disabled={busy || preview} onClick={create} title={preview ? "Disabled in preview" : ""} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40"><ExternalLink size={13} /> Create viewing link</button>
      </div>
      {msg && <p className="mb-2 text-xs text-chalk-400">{msg}</p>}
      {live.length === 0 ? (
        <p className="text-xs text-chalk-500">No live link yet. Create one to share this approved video.</p>
      ) : (
        <div className="space-y-2">
          {live.map((s) => (
            <div key={s.token} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-2 text-xs">
                <a href={s.viewUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-azure-300 hover:underline">{s.viewUrl}</a>
                <CopyBtn text={s.viewUrl} label="Copy link" />
                <button disabled={preview} onClick={() => prepare(s.token)} className="btn-secondary text-[11px] disabled:opacity-40">Prepare email</button>
                <button disabled={preview} onClick={() => revoke(s.token)} className="btn-ghost text-[11px] text-coral-300 disabled:opacity-40">Revoke</button>
              </div>
              <p className="mt-1 text-[10px] text-chalk-600">video {s.videoHash} · version {s.inputVersion} · unlisted link (anyone with it can forward; revoke to disable)</p>
            </div>
          ))}
        </div>
      )}
      {email && (
        <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-chalk-200">Prepared email (nothing sent)</span><span className="text-[10px] text-teal-300">no MP4 · links to page</span></div>
          <div className="rounded-lg border border-white/[0.06] bg-ink-950/50 p-2.5 text-xs">
            <p className="text-chalk-300"><span className="text-chalk-500">Subject:</span> {email.subject}</p>
            <p className="mt-1 whitespace-pre-wrap text-chalk-400">{email.text}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyBtn text={email.subject} label="Copy subject" />
            <CopyBtn text={email.text} label="Copy body (text)" />
            <CopyBtn text={email.html} label="Copy body (HTML)" />
          </div>
          <p className="text-[11px] text-chalk-500">Send via the existing manual-email workflow (preview → approve → explicit Send). This studio never sends.</p>
        </div>
      )}
    </div>
  );
}

const TONE = {
  active: "text-azure-300 border-azure-500/30 bg-azure-500/10",
  ready: "text-teal-300 border-teal-400/30 bg-teal-400/10",
  fail: "text-coral-300 border-coral-400/30 bg-coral-400/10",
  warn: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  idle: "text-chalk-400 border-white/10 bg-white/[0.04]",
};

// The single, persisted lifecycle state of a piece (section D). Every row shows exactly where it is —
// derived from server data (jobs, uploads, posted, provenance) so it survives refresh and never reads
// "unprepared" once a client project exists.
function statusOf(item: StudioItem): { label: string; tone: string; icon: any } {
  const isClient = isProspectVideo(item.piece);
  const queued = item.jobs.find((j) => j.status === "queued");
  const rendering = item.jobs.find((j) => j.status === "rendering");
  if (rendering) return { label: rendering.stage || "Rendering", tone: TONE.active, icon: Loader2 };
  if (queued) return { label: "Queued", tone: TONE.active, icon: Clock };
  if (!isClient && item.postedAt) return { label: "Posted", tone: TONE.ready, icon: Radio };
  const failed = item.jobs.find((j) => j.status === "failed");
  if (failed && !item.piece.recommendedRel) return { label: "Failed — retry available", tone: TONE.fail, icon: CircleAlert };
  const pv = item.provenance;
  if (item.piece.recommendedRel) {
    if (pv.audioKind === "placeholder") return { label: "Preview only", tone: TONE.warn, icon: CircleAlert };
    // Prospect video ready → the next step is the sales package, not social posting.
    if (isClient) return { label: pv.approved ? "Ready — approve package" : "Ready — review", tone: TONE.ready, icon: CircleCheck };
    if (pv.approved || pv.audioKind === "approved-master") return { label: "Posting-ready", tone: TONE.ready, icon: CircleCheck };
    return { label: "Review & approve", tone: TONE.active, icon: Clock };
  }
  // Prepared but not yet generated — the explicit "what to do next" state, so a prepared client project
  // never looks unprepared.
  if (item.piece.renderable) {
    if (item.uploads.length > 0) return { label: "Voiceover uploaded — generate", tone: TONE.active, icon: Film };
    if (isClient) return { label: "Prepared — upload voiceover", tone: TONE.active, icon: Upload };
    return { label: "Not generated", tone: TONE.idle, icon: Clock };
  }
  return { label: "Draft · needs scene", tone: TONE.idle, icon: Clock };
}

function PieceRow({ item, active, onClick }: { item: StudioItem; active: boolean; onClick: () => void }) {
  const s = statusOf(item);
  const Icon = s.icon;
  return (
    <button onClick={onClick} className={`card card-hover flex w-full items-center gap-3 p-3 text-left ring-focus ${active ? "ring-1 ring-azure-400/50" : ""}`}>
      <span className="relative h-16 w-9 shrink-0 overflow-hidden rounded-md border border-white/[0.08] bg-ink-950">
        {item.piece.thumbRel ? <img src={item.piece.thumbRel} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-chalk-600"><Film size={14} /></span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[10.5px] text-chalk-500">{isProspectVideo(item.piece) ? "Prospect video" : `#${item.piece.id}`}</span>
        <span className="block truncate text-sm font-semibold text-chalk-100">{item.piece.title}</span>
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${s.tone}`}>
          <Icon size={10} className={Icon === Loader2 ? "animate-spin" : ""} /> {s.label}
        </span>
      </span>
    </button>
  );
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<any>(null);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1600); }}
      className="btn-ghost inline-flex items-center gap-1.5 text-xs"
    >
      {done ? <Check size={13} className="text-teal-300" /> : <Copy size={13} />} {done ? "Copied" : label}
    </button>
  );
}

// Persisted, editable, copyable SOCIAL CAPTION beside the finished video. Generate from the approved
// script, edit + save, regenerate (guarded when owner-edited), copy with a clear confirmation, and
// browse revision history. A posting-ready/posted video must have one (enforced server-side).
function CaptionPanel({ item, onChanged, setMsg }: { item: StudioItem; onChanged: () => Promise<void>; setMsg: (m: { tone: "ok" | "err"; text: string } | null) => void }) {
  const preview = usePreview();
  const piece = item.piece;
  const cap = item.caption;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(cap?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const copyT = useRef<any>(null);
  useEffect(() => { setText(cap?.text ?? ""); setEditing(false); }, [cap?.text, cap?.updatedAt]);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/content-studio/captions/${piece.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 409) { setConfirmRegen(true); return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tone: "err", text: j.error ?? "Caption action failed." }); return; }
      setConfirmRegen(false); setEditing(false);
      await onChanged();
      setMsg({ tone: "ok", text: body.action === "save" ? "Caption saved." : "Caption regenerated." });
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!cap?.text) return;
    await navigator.clipboard.writeText(cap.text);
    setCopied(true); clearTimeout(copyT.current); copyT.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-chalk-100">Social caption</h4>
        <span className="text-[11px] tabular-nums text-chalk-500">{(editing ? text : cap?.text ?? "").length}/2200{cap?.edited ? " · edited" : cap ? " · generated" : ""}</span>
      </div>

      {!cap && !editing && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-chalk-500">No caption yet. Generate one from this piece’s approved script.</p>
          <button disabled={preview || busy} onClick={() => call({ action: "regenerate" })} className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Generate caption
          </button>
        </div>
      )}

      {(cap || editing) && (
        <>
          {editing ? (
            <textarea value={text} maxLength={2200} onChange={(e) => setText(e.target.value)} rows={8}
              className="w-full resize-y rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-[13px] leading-relaxed text-chalk-200 focus:border-azure-400/40 focus:outline-none" />
          ) : (
            <p className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[13px] leading-relaxed text-chalk-200">{cap?.text}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!editing && (
              <button onClick={copy} className="btn-primary inline-flex items-center gap-1.5 text-xs">
                {copied ? <Check size={13} className="text-teal-200" /> : <Copy size={13} />} {copied ? "Copied" : "Copy caption"}
              </button>
            )}
            {editing ? (
              <>
                <button disabled={preview || busy || !text.trim()} onClick={() => call({ action: "save", text })} className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save changes
                </button>
                <button disabled={busy} onClick={() => { setEditing(false); setText(cap?.text ?? ""); }} className="btn-ghost inline-flex items-center gap-1.5 text-xs">Cancel</button>
              </>
            ) : (
              <button disabled={preview} onClick={() => setEditing(true)} className="btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-40">Edit caption</button>
            )}
            {!editing && (
              <button disabled={preview || busy} onClick={() => call({ action: "regenerate" })} className="btn-ghost inline-flex items-center gap-1.5 text-xs disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Regenerate
              </button>
            )}
            {cap && cap.revisions.length > 0 && (
              <button onClick={() => setShowHistory((v) => !v)} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Clock size={13} /> History ({cap.revisions.length})</button>
            )}
          </div>

          {confirmRegen && (
            <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5 text-[12px] text-amber-200">
              This caption was edited. Regenerating will replace it (your edit is kept in history). Continue?
              <div className="mt-2 flex gap-2">
                <button disabled={busy} onClick={() => call({ action: "regenerate", force: true })} className="btn-primary text-xs">Regenerate anyway</button>
                <button disabled={busy} onClick={() => setConfirmRegen(false)} className="btn-ghost text-xs">Keep my edit</button>
              </div>
            </div>
          )}

          {showHistory && cap && (
            <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
              {[...cap.revisions].reverse().map((r, i) => (
                <div key={i} className="rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-chalk-500"><span>{r.source} · {new Date(r.at).toLocaleString()}</span><CopyBtn text={r.text} label="Copy" /></div>
                  <p className="whitespace-pre-wrap text-[12px] text-chalk-400">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The honest render state (section I-D), as a compact operator-facing chip.
function LifecycleBadge({ state }: { state: RenderState }) {
  const map: Record<RenderState, { label: string; cls: string }> = {
    NEEDS_AUDIO: { label: "Needs audio", cls: "border-amber-400/25 bg-amber-400/10 text-amber-300" },
    READY_TO_GENERATE: { label: "Ready to generate", cls: "border-azure-500/25 bg-azure-500/10 text-azure-300" },
    QUEUED: { label: "Queued", cls: "border-azure-500/25 bg-azure-500/10 text-azure-300" },
    RENDERING: { label: "Rendering", cls: "border-azure-500/25 bg-azure-500/10 text-azure-300" },
    READY: { label: "Ready", cls: "border-teal-400/25 bg-teal-400/10 text-teal-300" },
    FAILED_RETRYABLE: { label: "Failed — retry", cls: "border-coral-400/30 bg-coral-400/10 text-coral-200" },
    FAILED_FINAL: { label: "Failed — final", cls: "border-coral-400/40 bg-coral-400/15 text-coral-200" },
  };
  const m = map[state];
  return <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.cls}`}>{m.label}</span>;
}

// Prospect Video Sales Package controls (mandate III) — the prospect-side counterpart to the social
// caption/share controls. Shows the frozen-package lifecycle and the operator actions: Approve package
// (freeze), Copy video link (reconstructable signed URL), Preview email (frozen PDF + video CTA). Never
// any social caption/posting language. Loads state from /api/content-studio/client/package.
function PackagePanel({ leadId }: { leadId: string }) {
  const preview = usePreview();
  const [state, setState] = useState<{ state: string; packageVersion: number | null; hasVideo: boolean; hasReview: boolean; shareUrl: string | null } | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [emailPreview, setEmailPreview] = useState<{ subject: string; hasPdf: boolean; viewUrl: string | null; sizeGuard: { ok: boolean; reason?: string } } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/content-studio/client/package?leadId=${encodeURIComponent(leadId)}`);
      if (r.ok) setState(await r.json());
      const a = await fetch("/api/content-studio/client/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, action: "assemble" }) });
      if (a.ok) { const d = await a.json(); setBlockers(d.blockers ?? []); }
    } catch { /* best-effort */ }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  const act = (action: string) => start(async () => {
    setMsg(null);
    if (preview) { setMsg("Disabled in preview."); return; }
    const r = await fetch("/api/content-studio/client/package", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "Action failed."); return; }
    if (action === "freeze") { setMsg(d.idempotent ? "Package already frozen at this version." : `Package approved & frozen (v${d.packageVersion}).`); await load(); }
    if (action === "copyLink") { if (d.shareUrl) { try { await navigator.clipboard.writeText(d.shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} } setMsg(d.shareUrl ? "Video link copied." : "No link yet."); }
    if (action === "previewEmail") setEmailPreview({ subject: d.subject, hasPdf: d.hasPdf, viewUrl: d.viewUrl, sizeGuard: d.sizeGuard });
  });

  const st = state?.state ?? "INCOMPLETE";
  const frozen = st === "FROZEN" || st === "SCHEDULED" || st === "SENT";
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-chalk-100">Prospect sales package</h4>
        <span className="rounded-md border border-azure-500/25 bg-azure-500/10 px-1.5 py-0.5 text-[10px] text-azure-300">{st}{state?.packageVersion ? ` · v${state.packageVersion}` : ""}</span>
      </div>
      {!frozen && blockers.length > 0 && (
        <p className="mb-2 text-[11px] leading-relaxed text-amber-300/90">Not ready to approve: {blockers.join("; ")}.</p>
      )}
      <p className="mb-3 text-[11px] leading-relaxed text-chalk-500">One frozen package = the approved email, the frozen Quick Review PDF, this video, and a secure recipient link — bound to one immutable version so a later edit can’t silently change a scheduled message. The video is <span className="text-chalk-300">linked</span>, never attached.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={preview || busy || (!frozen && blockers.length > 0)} onClick={() => act("freeze")} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40"><CircleCheck size={15} /> {frozen ? "Re-approve package" : "Approve package"}</button>
        <button disabled={preview || busy || !state?.shareUrl} onClick={() => act("copyLink")} title={state?.shareUrl ? "" : "Approve the package to mint the link"} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40">{copied ? <Check size={13} className="text-teal-300" /> : <Copy size={13} />} {copied ? "Copied" : "Copy video link"}</button>
        <button disabled={preview || busy} onClick={() => act("previewEmail")} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40"><Mail size={13} /> Preview email</button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-chalk-400">{msg}</p>}
      {emailPreview && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-chalk-400">
          <p className="text-chalk-200"><span className="text-chalk-500">Subject:</span> {emailPreview.subject}</p>
          <p className="mt-1">Attachment: {emailPreview.hasPdf ? "frozen Quick Review PDF" : "none"} · Video: {emailPreview.viewUrl ? "linked CTA (secure /pv link)" : "none"}</p>
          {!emailPreview.sizeGuard.ok && <p className="mt-1 text-amber-300">{emailPreview.sizeGuard.reason}</p>}
        </div>
      )}
    </div>
  );
}

function PieceDetail({ item, onChanged, setJobOverride, advanceHref }: { item: StudioItem; onChanged: () => Promise<void>; setJobOverride: (f: (o: Record<string, SafeJob>) => Record<string, SafeJob>) => void; advanceHref?: string }) {
  const preview = usePreview();
  const { piece } = item;
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const activeJob = item.jobs.find((j) => j.status === "queued" || j.status === "rendering");
  const lastFailed = item.jobs.find((j) => j.status === "failed");
  const hasUpload = item.uploads.length > 0;
  const narrationText = piece.narration.join("\n");
  // Honest lifecycle (section I-D): one derived state from real server truth. Client videos also need a
  // verified screenshot before the single Generate action unlocks.
  // mandate I: prospect video packages branch on the PERSISTED workflow discriminator (never the id prefix
  // alone). A prospect video NEVER shows social caption / approve-for-posting / mark-posted / social share.
  const isClientPiece = isProspectVideo(piece);
  const isProspect = isClientPiece;
  // A client project whose evidence hasn't cleared the gate: hide its (possibly stale) script from the
  // active voiceover workflow and disable Copy / Upload / Generate until a supported finding is captured.
  const needsEvidence = isClientPiece && piece.evidenceState === "needs-evidence";
  const hasScreenshot = !isClientPiece || !!piece.screenshotReady;
  const lifecycle = renderLifecycle({
    renderable: piece.renderable, isClient: isClientPiece, hasAudio: hasUpload, hasScreenshot,
    hasVerifiedOutput: !!piece.recommendedRel, latestJob: (activeJob ?? lastFailed ?? null) as any,
  });
  const genGate = canGenerate({ renderable: piece.renderable, isClient: isClientPiece, hasAudio: hasUpload, hasScreenshot, evidenceState: piece.evidenceState ?? null });

  const startRender = async (useUpload: boolean) => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview — rendering runs only in the connected functional environment." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/content-studio/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pieceId: piece.id, useUpload }) });
      const data = await r.json();
      if (!r.ok) { setMsg({ tone: "err", text: data.error || "Could not start render." }); }
      else {
        setJobOverride((o) => ({ ...o, [data.job.id]: data.job }));
        setMsg({ tone: "ok", text: data.deduped ? "That render is already in progress." : "Render started — this runs in the background and survives a refresh." });
        await onChanged();
      }
    } catch (e: any) { setMsg({ tone: "err", text: String(e?.message ?? e) }); }
    finally { setBusy(false); }
  };

  const markPosted = async () => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview." }); return; }
    const r = await fetch(`/api/content-studio/pieces/${piece.id}/posted`, { method: "POST" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg({ tone: "err", text: d.error || "Could not mark posted." }); return; }
    await onChanged();
  };
  const approve = async () => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview." }); return; }
    const r = await fetch(`/api/content-studio/pieces/${piece.id}/approve`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ tone: "err", text: d.error || "Could not approve." });
    else { setMsg({ tone: "ok", text: "Approved for posting." }); await onChanged(); }
  };

  return (
    <div className="space-y-4">
      {/* Header row: thumbnail + concept + posting file */}
      <div className="card p-4">
        <div className="flex gap-4">
          <div className="relative w-28 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950" style={{ aspectRatio: "9 / 16" }}>
            {piece.thumbRel ? <img src={piece.thumbRel} alt={`Thumbnail for ${piece.title}`} className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-chalk-600"><Film size={20} /></span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-chalk-500">{isProspect ? "Prospect video package · evidence-backed" : `Field Note #${piece.id}`}</p>
            <h3 className="text-lg font-semibold text-chalk-50">{piece.title}</h3>
            <p className="mt-0.5 text-sm text-chalk-400">{piece.concept}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-chalk-500">
              {piece.targetSeconds && <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5">1080×1920 · ~{piece.targetSeconds}s</span>}
              {piece.hasThumbnailFirst && <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-teal-300">thumbnail = frame zero</span>}
              {!isProspect && item.postedAt && <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-teal-300">Posted {new Date(item.postedAt).toLocaleDateString()}</span>}
              {piece.evidenceState === "needs-evidence" && <span className="rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-amber-300">needs evidence</span>}
              {piece.evidenceState === "evidence-backed" && <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-teal-300">evidence-backed</span>}
              {piece.ownerEdited && <span className="rounded-md border border-azure-400/25 bg-azure-400/10 px-1.5 py-0.5 text-azure-300">owner-edited</span>}
              {typeof piece.revision === "number" && <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5">rev {piece.revision}</span>}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${msg.tone === "ok" ? "border-teal-400/25 bg-teal-400/[0.06] text-teal-200" : "border-coral-400/30 bg-coral-400/[0.06] text-coral-200"}`}>
          {msg.tone === "ok" ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />} <span>{msg.text}</span>
        </div>
      )}

      {/* Live website screenshot (section G) — the real captured page behind the evidence. Client videos only. */}
      {piece.screenshotRel && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-chalk-100">Live website screenshot</h4>
            <span className="text-[10px] text-chalk-600">captured by the screenshot worker · 1080×1920 · no vignette</span>
          </div>
          <div className="flex gap-4">
            <div className="relative w-32 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950" style={{ aspectRatio: "9 / 16" }}>
              <img src={piece.screenshotRel} alt={`Captured website for ${piece.title}`} className="h-full w-full object-cover object-top" />
            </div>
            <p className="text-xs leading-relaxed text-chalk-500">This is the business's actual homepage, captured live behind the SSRF-guarded worker — no darkened edges, no decorative blur. It refreshes each time you Prepare; a clean fallback tile shows until the first capture is ready.</p>
          </div>
        </div>
      )}

      {/* Narration + captions */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-chalk-100">Narration script</h4>
          {!needsEvidence && narrationText && <CopyBtn text={narrationText} label="Copy narration" />}
        </div>
        {needsEvidence ? (
          // Section A: a needs-evidence project must NOT present a stale/generic script as recordable
          // content. Hide the narration entirely and show the exact deficiency instead. The prior script,
          // if any, is preserved in revision history — never shown here as current.
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200"><CircleAlert size={14} /> Needs evidence — no active script</p>
            <p className="mt-1.5 text-xs leading-relaxed text-amber-100/80">{piece.evidenceDeficiency || "No directly-observed website finding yet. Capture the site deeper before a script can be written."}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-chalk-500">Copy narration, voiceover upload, and Generate are disabled until a supported finding is captured.{piece.hasArchivedNarration ? " The previous script is preserved in revision history, not shown here." : ""}</p>
          </div>
        ) : narrationText ? (
          <ol className="space-y-2">
            {piece.narration.map((line, i) => {
              const ev = (piece.narrationEvidence ?? []).find((e) => e.line === i);
              const material = ev && ev.kind !== "framing";
              return (
                <li key={i} className="flex gap-2.5 text-sm text-chalk-300">
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-chalk-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <span>{line}</span>
                    {material && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {ev!.confidence && <span className="rounded border border-teal-400/25 bg-teal-400/10 px-1 py-0.5 text-teal-300">{ev!.confidence}</span>}
                        {ev!.topic && <span className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 text-chalk-400">{ev!.topic}</span>}
                        {ev!.sourceLabel && <span className="truncate text-chalk-500" title={ev!.sourceUrl || ev!.sourceLabel}>· {ev!.sourceLabel}</span>}
                        {ev!.screenshotKey && <span className="rounded border border-azure-400/25 bg-azure-400/10 px-1 py-0.5 text-azure-300">screenshot</span>}
                      </div>
                    )}
                    {material && ev!.basis && ev!.basis.length > 0 && (
                      <p className="mt-0.5 text-[10px] text-chalk-600" title={ev!.basis.join(" · ")}>Evidence: {ev!.basis[0]}{ev!.basis.length > 1 ? ` (+${ev!.basis.length - 1})` : ""}</p>
                    )}
                    {ev && ev.kind === "framing" && <p className="mt-0.5 text-[10px] text-chalk-700">framing line — no claim</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-chalk-500">This piece was finished in VEED without a captured timing sheet. Enter narration when regenerating, or copy from the captions below.</p>
        )}
        {isProspect && !needsEvidence && <NarrationExpandPanel leadId={piece.businessId || (piece.id.startsWith("client-") ? piece.id.slice("client-".length) : "")} onChanged={onChanged} />}
        {!isProspect && (piece.captionIG || piece.captionLI) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {piece.captionIG && <CopyBtn text={piece.captionIG} label="Copy IG / TikTok caption" />}
            {piece.captionLI && <CopyBtn text={piece.captionLI} label="Copy LinkedIn caption" />}
          </div>
        )}
      </div>

      {/* Voiceover upload + playback — disabled while a client project needs evidence (nothing to voice yet). */}
      <UploadPanel item={item} onChanged={onChanged} setMsg={setMsg} disabled={needsEvidence} disabledReason="Needs evidence — capture a supported finding before recording a voiceover." advanceHref={advanceHref} autoGenerates={isProspect} />

      {/* Generate */}
      <div className="card p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-chalk-100">Generate video</h4>
          <LifecycleBadge state={lifecycle.state} />
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-chalk-500">{lifecycle.reason}</p>
        {!piece.renderable ? (
          <p className="text-xs leading-relaxed text-chalk-500">
            The render engine is wired for the established Field Notes scenes (#004–#006). This concept needs a scene
            template authored before it can be generated. Narration and captions above are ready to use in the meantime.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-chalk-500">
              Renders the real scene at native 1080×1920 (no white bar) with the generated thumbnail as the first frame.
            </p>
            {activeJob ? (
              <RenderProgress job={activeJob} />
            ) : (() => {
              // ONE primary action for the current state (section E) — no duplicate Generate controls.
              // #004–#006 reuse an approved voiceover; every other piece renders from an uploaded VO.
              const isApprovedMaster = ["004", "005", "006"].includes(piece.id);
              // ONE gate (section I-C): masters may reuse approved audio; everything else needs an uploaded
              // voiceover, and a client video additionally needs its verified screenshot.
              const canGen = isApprovedMaster || genGate.ok;
              const primaryUseUpload = isApprovedMaster ? false : true;
              if (!canGen) {
                return (
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button disabled className="btn-primary flex w-full items-center justify-center gap-1.5 text-sm opacity-40 sm:w-auto" title={genGate.reason}><Film size={15} /> Generate video</button>
                    <span className="text-xs text-chalk-500">{genGate.reason}</span>
                  </div>
                );
              }
              // Mandate B: prospect videos generate AUTOMATICALLY on voiceover upload. In the normal path
              // there is NO Generate button; the only manual control is Retry after a genuine failure.
              if (isProspect && !lastFailed) {
                return <p className="text-xs leading-relaxed text-chalk-500">Generation starts automatically when you upload a voiceover — no button to press. This renders in the background and moves the company to Ready to schedule when the verified video and package are assembled.</p>;
              }
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy || preview} onClick={() => startRender(lastFailed && hasUpload ? true : primaryUseUpload)} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {lastFailed ? "Retry render" : "Generate video"}
                  </button>
                  {/* Alternate audio source is a clearly-secondary option, never a competing primary. */}
                  {isApprovedMaster && hasUpload && (
                    <button disabled={busy || preview} onClick={() => startRender(true)} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40"><Film size={13} /> Use my uploaded voiceover instead</button>
                  )}
                </div>
              );
            })()}
            {lastFailed && !activeJob && (
              <div className="mt-2 rounded-lg border border-coral-400/25 bg-coral-400/[0.06] p-2.5 text-xs text-coral-200">
                <p className="font-medium">Last render failed{lastFailed.attempt > 1 ? ` (attempt ${lastFailed.attempt})` : ""}.</p>
                <p className="mt-0.5 text-coral-200/80">{lastFailed.error || "No reason recorded."}</p>
                <p className="mt-1 text-[11px] text-chalk-500">Retry re-runs the render safely — a stale worker can never overwrite a finished version.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Preview + downloads — labels reflect explicit audio provenance + approval */}
      {piece.recommendedRel && (() => {
        const pv = item.provenance;
        const isPlaceholder = pv.audioKind === "placeholder";
        const postable = pv.postingAllowed;
        // When the media is store-served (keyed), download via the dedicated route (proper filename +
        // Content-Disposition); otherwise the recommended URL itself is the download.
        const downloadHref = piece.recommendedRel!.startsWith("/api/content-studio/media/")
          ? `/api/content-studio/download/${piece.id}`
          : piece.recommendedRel!;
        return (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-chalk-100">{isProspect ? "Preview" : isPlaceholder ? "Preview" : "Preview & download"}</h4>
              {isProspect ? (
                <span className="rounded-md border border-azure-500/25 bg-azure-500/10 px-1.5 py-0.5 text-[10px] text-azure-300">delivered via secure link — not social</span>
              ) : isPlaceholder ? (
                <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">Preview only — replace placeholder voiceover</span>
              ) : postable ? (
                <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-300">{pv.audioKind === "approved-master" ? "approved audio · posting-ready" : "approved for posting"}</span>
              ) : (
                <span className="rounded-md border border-azure-500/25 bg-azure-500/10 px-1.5 py-0.5 text-[10px] text-azure-300">uploaded — review, then approve</span>
              )}
            </div>
            {pv.approvalStale && <p className="mb-2 text-[11px] text-amber-300">Inputs changed since approval — re-approve the current render before posting.</p>}
            <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
              <div className="space-y-1">
                <video src={piece.recommendedRel} poster={piece.thumbRel || undefined} controls playsInline preload="metadata" className="w-full rounded-lg border border-white/[0.08] bg-black" style={{ aspectRatio: "9 / 16" }} />
                {piece.targetSeconds ? <p className="text-center text-[10px] text-chalk-500">~{piece.targetSeconds}s · if the player shows 0:00, the length above is authoritative</p> : null}
              </div>
              <div className="space-y-2">
                {isProspect ? (
                  // A Prospect Video Sales Package is delivered to the prospect through its secure viewing
                  // link + email package (below) — never posted to social. No caption, no approve-for-posting,
                  // no mark-posted, no social share/download.
                  <p className="text-[11px] leading-relaxed text-chalk-500">This is a prospect sales video. It reaches the prospect through its secure viewing link and email package below — it is never posted to social media. Use <span className="text-chalk-300">Approve package</span> / <span className="text-chalk-300">Copy video link</span> below to send it.</p>
                ) : (
                  <>
                    <MediaActions url={downloadHref} filename={`field-note-${piece.id}.mp4`} mimeType="video/mp4" label={isPlaceholder ? "preview" : "video"} primary={!isPlaceholder} />
                    {piece.thumbRel && <MediaActions url={piece.thumbRel} filename={`field-note-${piece.id}-cover.png`} mimeType="image/png" label="thumbnail" />}
                    {!isPlaceholder && !pv.approved && pv.audioKind === "uploaded" && (
                      <button disabled={preview} onClick={approve} title={preview ? "Disabled in preview" : ""} className="btn-primary flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 sm:w-auto"><CircleCheck size={15} /> Approve for posting</button>
                    )}
                    <button disabled={preview || !postable} onClick={markPosted} title={preview ? "Disabled in preview" : postable ? "" : "Approve a non-placeholder render first"} className="btn-ghost flex w-full items-center justify-center gap-1.5 text-xs disabled:opacity-40 sm:w-auto"><Radio size={13} /> {item.postedAt ? "Update posted date" : "Mark as posted"}</button>
                    {isPlaceholder
                      ? <p className="pt-1 text-[11px] leading-relaxed text-amber-300/90">This render uses a placeholder voiceover for layout/timing preview only. Upload your real voiceover to produce a postable video — it is not an approved or final asset.</p>
                      : <p className="pt-1 text-[11px] leading-relaxed text-chalk-500">The thumbnail is also embedded as the first frame — still upload it as the cover when posting; platforms don’t all pick frame zero.</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Social caption — Field Notes ONLY. A prospect video package never carries a social caption. */}
      {!isProspect && piece.recommendedRel && <CaptionPanel item={item} onChanged={onChanged} setMsg={setMsg} />}

      {/* Prospect sales package (mandate III) — Approve, Copy video link, Preview email. Prospect ONLY. */}
      {isProspect && piece.businessId && piece.recommendedRel && <PackagePanel leadId={piece.businessId} />}

      {/* Sharing & outreach — Field Notes social sharing ONLY (prospect uses the package above). */}
      {!isProspect && item.provenance.postingAllowed && item.provenance.audioKind !== "placeholder" && <SharePanel item={item} />}

      {/* Version history */}
      {item.jobs.length > 0 && (
        <div className="card p-4">
          <h4 className="mb-2 text-sm font-semibold text-chalk-100">Version history</h4>
          <div className="space-y-1.5">
            {item.jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-2 text-xs">
                <JobDot status={j.status} />
                <span className="capitalize text-chalk-300">{j.status}</span>
                <span className="text-chalk-400">{j.mode === "uploaded-vo" ? "uploaded VO" : "approved audio"}</span>
                {j.attempt > 1 && <span className="text-chalk-600">· attempt {j.attempt}</span>}
                <span className="ml-auto text-chalk-600">{new Date(j.finishedAt ?? j.createdAt).toLocaleString()}</span>
                {j.status === "ready" && j.outputRel && <a href={j.outputRel} download className="text-azure-300 hover:underline">download</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JobDot({ status }: { status: SafeJob["status"] }) {
  const c = status === "ready" ? "bg-teal-400" : status === "failed" ? "bg-coral-400" : status === "rendering" ? "bg-azure-400 animate-pulse" : "bg-chalk-500";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

const clockTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

// Honest render status (section J): the real persisted job — stage, progress, attempt, queued/started
// times and last worker activity. Polls every 1.5s (parent) and stops at a terminal state.
function RenderProgress({ job }: { job: SafeJob }) {
  const pct = Math.round((job.progress || 0) * 100);
  const label = job.status === "queued" ? "Queued — waiting for a render worker" : job.stage || "Rendering";
  return (
    <div className="rounded-xl border border-azure-500/25 bg-azure-500/[0.05] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-azure-200">
        {job.status === "queued" ? <Clock size={13} /> : <Loader2 size={13} className="animate-spin" />} {label} · {pct}%
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-950">
        <div className="h-full rounded-full bg-azure-400 transition-all duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-chalk-500 sm:grid-cols-4">
        <span>Attempt · <span className="text-chalk-300">{job.attempt}</span></span>
        <span>Queued · <span className="text-chalk-300">{clockTime(job.createdAt)}</span></span>
        <span>Started · <span className="text-chalk-300">{clockTime(job.startedAt)}</span></span>
        <span>Last activity · <span className="text-chalk-300">{clockTime(job.updatedAt)}</span></span>
      </div>
      <p className="mt-2 text-[11px] text-chalk-500">Runs in the background — you can leave this page or refresh; the job keeps going.</p>
    </div>
  );
}

// Upload one narration file with real PROGRESS (XHR, not fetch) so an iPhone upload shows a moving bar.
function uploadWithProgress(pieceId: string, file: File, durationSeconds: number | null, onProgress: (pct: number) => void): Promise<{ ok: boolean; data: any }> {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append("pieceId", pieceId);
    fd.append("file", file);
    if (durationSeconds != null) fd.append("durationSeconds", String(durationSeconds));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/content-studio/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { let data: any = {}; try { data = JSON.parse(xhr.responseText); } catch {} resolve({ ok: xhr.status >= 200 && xhr.status < 300, data }); };
    xhr.onerror = () => resolve({ ok: false, data: { error: "Network error during upload." } });
    xhr.send(fd);
  });
}

function UploadPanel({ item, onChanged, setMsg, disabled = false, disabledReason, advanceHref, autoGenerates = false }: { item: StudioItem; onChanged: () => Promise<void>; setMsg: (m: { tone: "ok" | "err"; text: string } | null) => void; disabled?: boolean; disabledReason?: string; advanceHref?: string; autoGenerates?: boolean }) {
  const preview = usePreview();
  const router = useRouter();
  const { piece } = item;
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null); // remembered so a failed upload can be retried
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = item.uploads[0]; // the CURRENT valid upload — never cleared by a failed replacement

  // Attempt an upload. On failure we DO NOT touch the existing valid upload (`latest` stays intact) and we
  // remember the file so the operator can Retry without re-picking it.
  const doUpload = async (file: File) => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview — voiceover upload runs in the functional environment." }); return; }
    setUploading(true); setPct(0); setMsg(null); setLastFile(file);
    try {
      const duration = await detectDuration(file).catch(() => null);
      const { ok, data } = await uploadWithProgress(piece.id, file, duration, setPct);
      if (!ok) { setMsg({ tone: "err", text: (data?.error || "Upload failed.") + " Your previous voiceover is untouched." }); }
      else {
        setLastFile(null);
        // Mandate B: the server auto-enqueued exactly one render on this upload. Reflect it, then — in the
        // focused one-company flow — advance immediately to the next company so Jordan keeps uploading while
        // this one renders in the background. If evidence wasn't ready the server returns renderError.
        const rendered = data?.render && !data?.renderError;
        if (autoGenerates && rendered) {
          setMsg({ tone: "ok", text: `Uploaded ${file.name} — generating video automatically…` });
          if (advanceHref) { router.push(advanceHref); return; }
        } else if (data?.renderError) {
          setMsg({ tone: "err", text: `Uploaded, but generation couldn't start: ${data.renderError}` });
        } else {
          setMsg({ tone: "ok", text: `Uploaded ${file.name} (${fmtDur(duration)}).` });
        }
        await onChanged();
      }
    } catch (e: any) { setMsg({ tone: "err", text: String(e?.message ?? e) + " Your previous voiceover is untouched." }); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const remove = async () => {
    if (preview || !latest) return;
    setRemoving(true); setMsg(null);
    try {
      const r = await fetch("/api/content-studio/upload/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pieceId: piece.id }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg({ tone: "err", text: d.error || "Could not remove." }); }
      else { setMsg({ tone: "ok", text: "Voiceover removed — upload a new one to generate." }); await onChanged(); }
    } finally { setRemoving(false); }
  };

  const busy = uploading || removing || disabled;
  if (disabled) {
    return (
      <div className="card overflow-hidden p-4">
        <h4 className="mb-1 text-sm font-semibold text-chalk-100">Your voiceover</h4>
        <p className="text-xs leading-relaxed text-chalk-500">{disabledReason || "Voiceover upload is disabled for this project."}</p>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden p-4">
      <h4 className="mb-1 text-sm font-semibold text-chalk-100">Your voiceover</h4>
      <p className="mb-3 text-xs leading-relaxed text-chalk-500">Record narration on your phone (Voice Memos works — export as M4A), then upload it here. MP3 / M4A / AAC / WAV, ≤25 MB, 5–90s. You produce the voice — Content Studio never generates it.</p>

      {/* Current upload — filename, detected format, duration, size. Wraps on mobile; never overflows. */}
      {latest && !uploading && (
        <div className="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="min-w-0 break-all font-medium text-chalk-200">{latest.name}</span>
            {(latest as any).detectedType && <span className="rounded border border-teal-400/25 bg-teal-400/10 px-1 py-0.5 text-[10px] uppercase text-teal-300">{(latest as any).detectedType}</span>}
            <span className="text-chalk-500">{fmtDur(latest.durationSeconds)} · {fmtBytes(latest.bytes)}</span>
          </div>
          {/* playsInline: mobile Safari plays inline (no fullscreen takeover); preload=metadata lets it report duration. */}
          <audio controls playsInline preload="metadata" className="mt-2 w-full" src={`/api/content-studio/audio/${piece.id}?t=${encodeURIComponent(latest.uploadedAt)}`}>Your browser can’t play this audio.</audio>
          {latest.durationSeconds != null && <p className="mt-1 text-[10px] text-chalk-500">Length {fmtDur(latest.durationSeconds)} (from the server — authoritative if the player shows 0:00).</p>}
        </div>
      )}

      {/* Upload progress — a real moving bar while the file transfers. */}
      {uploading && (
        <div className="mb-3 rounded-lg border border-azure-500/25 bg-azure-500/[0.05] p-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-azure-200"><Loader2 size={13} className="animate-spin" /> Uploading{lastFile ? ` ${lastFile.name}` : ""} · {pct}%</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-950"><div className="h-full rounded-full bg-azure-400 transition-all duration-200" style={{ width: `${Math.max(3, pct)}%` }} /></div>
        </div>
      )}

      {/* Actions — full-width tap targets on mobile, inline on desktop. Replace · Remove · Retry. */}
      <input ref={inputRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav" className="hidden" disabled={preview} onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); }} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button disabled={busy || preview} onClick={() => inputRef.current?.click()} title={preview ? "Disabled in preview" : ""} className="btn-secondary flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 sm:w-auto">
          <Upload size={16} /> {latest ? "Replace voiceover" : "Upload voiceover"}
        </button>
        {latest && !uploading && (
          <button disabled={busy || preview} onClick={remove} className="btn-ghost flex w-full items-center justify-center gap-1.5 text-sm text-coral-300 disabled:opacity-40 sm:w-auto">
            {removing ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Remove
          </button>
        )}
        {lastFile && !uploading && (
          <button disabled={busy || preview} onClick={() => lastFile && doUpload(lastFile)} className="btn-ghost flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 sm:w-auto">
            <RefreshCw size={16} /> Retry upload
          </button>
        )}
      </div>
    </div>
  );
}

function detectDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); Number.isFinite(a.duration) ? resolve(a.duration) : reject(new Error("no duration")); };
    a.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode error")); };
    a.src = url;
  });
}

function NewPieceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [concept, setConcept] = useState("");
  const [narration, setNarration] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<any[] | null>(null);
  const [seed, setSeed] = useState(0);

  const suggest = async () => {
    const r = await fetch(`/api/content-studio/ideas?n=3&seed=${seed}`, { cache: "no-store" });
    if (r.ok) { setIdeas((await r.json()).ideas); setSeed((s) => s + 3); }
  };
  const applyIdea = (idea: any) => { setTitle(idea.hook); setConcept(idea.concept); setNarration(idea.starterNarration.join("\n")); setIdeas(null); };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      // Creates a RENDERABLE data-driven template (script auto-laid-out onto the approved grammar).
      const r = await fetch("/api/content-studio/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, concept, narration }) });
      const data = await r.json();
      if (!r.ok) setErr(data.error || "Could not save.");
      else await onCreated();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-lg p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-chalk-50">New Field Note</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-chalk-500 hover:bg-white/[0.06] hover:text-chalk-100"><X size={16} /></button>
        </div>
        <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-chalk-400">Need a starting point?</span>
            <button onClick={suggest} className="btn-ghost text-[11px]">{ideas ? "More ideas" : "Suggest ideas"}</button>
          </div>
          {ideas && (
            <div className="mt-2 space-y-1.5">
              {ideas.map((idea) => (
                <button key={idea.key} onClick={() => applyIdea(idea)} className="block w-full rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-left text-xs hover:bg-white/[0.05]">
                  <span className="font-medium text-chalk-200">{idea.hook}</span><span className="text-chalk-500"> — {idea.concept}</span>
                </button>
              ))}
              <p className="text-[10px] text-chalk-600">Starter bank (not AI-generated) — pick one, then make the script your own.</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div><label className="field-label">Title / hook</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The status update nobody reads." /></div>
          <div><label className="field-label">Concept (secondary line)</label><input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="One line describing the story." /></div>
          <div><label className="field-label">Narration (one line per row)</label><textarea className="input min-h-[120px]" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={"Line one.\nLine two.\n…"} /></div>
          {err && <p className="text-xs text-coral-300">{err}</p>}
          <p className="text-[11px] leading-relaxed text-chalk-500">Creates a <span className="text-chalk-300">renderable</span> piece: your script is laid out on the approved motion + typography automatically (no design step). Upload a voiceover and Generate. Richer layouts (cards, chains, surfaces) come from the full template grammar — see #007.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button disabled={busy || !title.trim()} onClick={submit} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create video</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO TOP-LEVEL TABS + GROUPED WORKSPACE (mandate 25 §B3–B5). Proposal Videos vs Content Videos, each
// URL-addressable via ?type= (refresh persists, browser Back restores). Independent counts, independent
// grouped lists, no record in both tabs (the server split guarantees it).
// ─────────────────────────────────────────────────────────────────────────────
function VideoTabs({ workspaces }: { workspaces: StudioWorkspacesProp }) {
  const tab = (type: "proposal" | "content", label: string, count: number) => {
    const active = workspaces.activeType === type;
    return (
      <Link
        href={`/content-studio?type=${type}`}
        data-studio-tab={type}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm ring-focus ${active ? "border-azure-400/40 bg-azure-400/10 text-azure-100" : "border-white/10 bg-white/[0.02] text-chalk-400 hover:text-chalk-200"}`}
      >
        {type === "proposal" ? <Users size={15} /> : <Film size={15} />}
        <span className="font-medium">{label}</span>
        <span data-tab-count={type} className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? "bg-azure-400/20 text-azure-100" : "bg-white/[0.06] text-chalk-500"}`}>{count}</span>
      </Link>
    );
  };
  return (
    <div data-studio-tabs className="flex flex-wrap items-center gap-2">
      {tab("proposal", "Outreach Reviews", workspaces.counts.proposal)}
      {tab("content", "Content Videos", workspaces.counts.content)}
      {workspaces.counts.unclassified > 0 && (
        <span data-tab-unclassified className="ml-1 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1 text-[11px] text-amber-200">
          {workspaces.counts.unclassified} unclassified — resolve before use
        </span>
      )}
    </div>
  );
}

const QUALITY_TONE: Record<string, string> = {
  GOOD: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  NEEDS_REVIEW: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
  TOO_SHORT: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
  GENERIC: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
  TOO_SIMILAR: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200",
  UNSUPPORTED_CLAIMS: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200",
  INSUFFICIENT_EVIDENCE: "border-chalk-500/30 bg-white/[0.03] text-chalk-400",
};
function QualityBadge({ quality }: { quality: string }) {
  return <span data-proposal-quality={quality} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${QUALITY_TONE[quality] ?? "bg-white/[0.06] text-chalk-400"}`}>{quality.replace(/_/g, " ").toLowerCase()}</span>;
}

function WorkspaceList({ workspaces, selectedId, onSelect }: { workspaces: StudioWorkspacesProp; selectedId: string; onSelect: (id: string) => void }) {
  const isProposal = workspaces.activeType === "proposal";
  const order = isProposal ? PROPOSAL_GROUP_ORDER : CONTENT_GROUP_ORDER;
  const labels: Record<string, string> = isProposal ? PROPOSAL_GROUP_LABEL : CONTENT_GROUP_LABEL;
  const groups: Record<string, Array<ProposalCard | ContentCard>> = isProposal ? workspaces.proposal.groups : workspaces.content.groups;
  const totalHere = order.reduce((n, g) => n + (groups[g]?.length ?? 0), 0);
  // Each card links to its dedicated full-page workspace, carrying THIS tab as the Back origin (mandate 26 §2).
  const origin = `/content-studio?type=${workspaces.activeType}`;
  const hrefFor = (c: ProposalCard | ContentCard) => {
    const key = c.purpose === "PROPOSAL" ? ((c as ProposalCard).leadId ?? c.id) : c.id;
    return `/content-studio/${workspaces.activeType}/${encodeURIComponent(key)}?from=${encodeURIComponent(origin)}`;
  };
  if (totalHere === 0) {
    return <div data-workspace-empty className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[12.5px] text-chalk-500">No {isProposal ? "proposal" : "content"} videos yet.</div>;
  }
  return (
    <div data-workspace={workspaces.activeType} className="space-y-3">
      {order.map((g) => {
        const cards = groups[g] ?? [];
        if (!cards.length) return null;
        return (
          <section key={g} data-workspace-group={g} aria-label={labels[g]}>
            <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-chalk-500">{labels[g]} <span className="text-chalk-600">· {cards.length}</span></h3>
            <div className="space-y-2">
              {cards.map((c) => <WorkspaceCard key={c.id} card={c} active={c.id === selectedId} href={hrefFor(c)} onSelect={() => onSelect(c.id)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// A company card is a real navigable Link to its dedicated full-page workspace. On MOBILE, tapping anywhere
// navigates immediately (mandate 26 §2 — no select-then-scroll). On DESKTOP (≥1024px) the two-column
// master-detail is allowed, so we intercept the click and select in place instead of navigating. Either way
// the href is a genuine URL, so refresh + browser Back + deep-link work.
function WorkspaceCard({ card, active, href, onSelect }: { card: ProposalCard | ContentCard; active: boolean; href: string; onSelect: () => void }) {
  const isProposal = card.purpose === "PROPOSAL";
  const p = card as ProposalCard;
  const handle = (e: ReactMouseEvent) => {
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width: 1024px)").matches) {
      e.preventDefault(); onSelect(); // desktop master-detail: select beside the list
    }
    // mobile: fall through — follow the link to the dedicated full-page workspace
  };
  return (
    <Link
      href={href}
      onClick={handle}
      data-workspace-card={card.id}
      data-workspace-href={href}
      data-purpose={card.purpose}
      data-group={card.group}
      data-quality={isProposal ? p.quality : undefined}
      aria-current={active ? "true" : undefined}
      className={`block w-full rounded-lg border p-3 text-left ring-focus ${active ? "border-azure-400/40 bg-azure-400/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/20"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-chalk-100">{isProposal ? p.businessName : (card as ContentCard).title}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-chalk-500">{card.videoStatus.replace(/-/g, " ")}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-chalk-500">{card.narrationPreview || <span className="italic text-chalk-600">No narration yet.</span>}</p>
      {isProposal && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <QualityBadge quality={p.quality} />
          <span className="text-[10.5px] text-chalk-500">{p.wordCount} words · ~{p.estimatedSeconds}s</span>
          {p.frozen && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-chalk-400">frozen</span>}
        </div>
      )}
      {isProposal && p.nextAction && <p data-next-action className="mt-1 text-[10.5px] text-azure-300/80">→ {p.nextAction}</p>}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPAND-AND-PERSONALIZE (mandate 25 §B6–B9). Analyze the current narration, expand it from ONLY the
// company's verified evidence, compare original vs proposed, edit/regenerate, and accept — which creates a
// NEW revision (advancing the render input version so existing audio can no longer satisfy the new script,
// forcing a new upload + render). Cancel mutates nothing. Never fabricates: an insufficient-evidence expand
// yields a blocker, not filler. Frozen/approved packages are refused server-side (409).
// ─────────────────────────────────────────────────────────────────────────────
type ExpandState = {
  original: string; candidate: string;
  quality: any; wordCount: number; estimatedSeconds: number;
  evidenceMap: Array<{ statement: string; evidenceIds: string[]; requiresReview: boolean }>;
  statementsRequiringReview: string[];
  variant: number; variantCount: number; noSafeAlternative: boolean; regenerationNote: string | null;
};
type NarrationPerms = {
  mode: "editable" | "committed-fork"; state: string; approved: boolean; frozen: boolean;
  canAccept: boolean; canRegenerate: boolean; canCreateImprovedVersion: boolean;
  headline: string; detail: string;
};
function NarrationExpandPanel({ leadId, onChanged }: { leadId: string; onChanged: () => Promise<void> }) {
  const preview = usePreview();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "analyze" | "expand" | "accept">(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [perms, setPerms] = useState<NarrationPerms | null>(null);
  const [exp, setExp] = useState<ExpandState | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch("/api/content-studio/narration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, leadId, ...extra }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `Request failed (${r.status})`);
    return d;
  };
  const wordCount = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []).length;

  async function analyze() {
    if (preview || !leadId) return;
    setBusy("analyze"); setMsg(null); setBlocker(null);
    try { const d = await post("analyze"); setAnalysis(d.quality); if (d.permissions) setPerms(d.permissions); }
    catch (e: any) { setMsg({ tone: "err", text: e.message }); }
    finally { setBusy(null); }
  }
  // variant=0 for the first expand; Regenerate passes variant+1 so the candidate genuinely changes. When the
  // evidence supports no further distinct draft, the server flags noSafeAlternative and we say so honestly.
  async function expand(variant = 0) {
    if (preview || !leadId) return;
    setBusy("expand"); setMsg(null); setBlocker(null);
    try {
      const d = await post("expand", { variant });
      if (!d.available) { setBlocker(d.blocker || "Insufficient evidence to expand."); setExp(null); return; }
      setExp({
        original: d.original ?? "", candidate: d.candidate ?? "", quality: d.quality, wordCount: d.wordCount, estimatedSeconds: d.estimatedSeconds,
        evidenceMap: d.evidenceMap ?? [], statementsRequiringReview: d.statementsRequiringReview ?? [],
        variant: d.variant ?? variant, variantCount: d.variantCount ?? 1, noSafeAlternative: !!d.noSafeAlternative, regenerationNote: d.regenerationNote ?? null,
      });
    } catch (e: any) { setMsg({ tone: "err", text: e.message }); }
    finally { setBusy(null); }
  }
  function regenerate() { expand((exp?.variant ?? 0) + 1); } // genuinely new variant, never a silent repeat

  // Accept in place (editable draft) OR fork a new unapproved draft (committed package). The button shown is
  // whichever the canonical permissions allow — never a control that predictably errors.
  async function commit() {
    if (preview || !exp) return;
    const fork = !!perms && perms.canCreateImprovedVersion;
    setBusy("accept"); setMsg(null);
    try {
      if (fork) {
        const d = await post("fork", { narration: exp.candidate });
        setMsg({ tone: "ok", text: d.idempotent
          ? `Already forked as revision ${d.newRevision}. This new draft doesn't change what's ${d.forkedFromState === "SENT" ? "sent" : "scheduled"} — it needs fresh approval, new audio, and a new render.`
          : `Created improved version — revision ${d.newRevision}. The ${String(d.forkedFromState).toLowerCase()} package and its send are untouched; this new draft needs fresh approval, new audio, and a new render.` });
      } else {
        const d = await post("accept", { narration: exp.candidate });
        setMsg({ tone: "ok", text: d.idempotent
          ? `No change — this is already revision ${d.newRevision}.`
          : `Accepted as revision ${d.newRevision}. ${d.requiresNewAudioAndRender ? "The previous audio/render is now outdated — upload new narration audio and re-render." : ""}` });
      }
      setExp(null); setAnalysis(null);
      await onChanged();
      await analyze(); // refresh state/permissions after the mutation
    } catch (e: any) { setMsg({ tone: "err", text: e.message }); }
    finally { setBusy(null); }
  }
  function cancel() { setExp(null); setBlocker(null); setMsg(null); } // mutates nothing

  if (!leadId) return null;
  const committed = !!perms && perms.canCreateImprovedVersion;
  const openLabel = committed ? "Improve narration (create a new version)" : "Improve narration (analyze & expand)";
  return (
    <div data-expand-root className="mt-3 border-t border-white/[0.06] pt-3">
      {!open ? (
        <button data-expand-open disabled={preview} onClick={() => { setOpen(true); analyze(); }} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40">
          <RefreshCw size={13} /> {openLabel}
        </button>
      ) : (
        <div data-expand-panel data-expand-mode={perms?.mode ?? "editable"} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <h5 className="text-[13px] font-semibold text-chalk-100">{committed ? "Create improved version" : "Expand & personalize"}</h5>
            <button data-expand-close onClick={() => { setOpen(false); cancel(); setAnalysis(null); }} className="text-chalk-500 hover:text-chalk-200"><X size={14} /></button>
          </div>

          {/* Truthful, state-specific banner: what's allowed here and why (mandate 26 §1). */}
          {perms && (
            <div data-expand-permissions data-frozen={perms.frozen ? "1" : undefined} className={`rounded-lg border p-2.5 text-[11px] leading-relaxed ${perms.frozen ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-100/90" : "border-white/[0.06] bg-white/[0.02] text-chalk-400"}`}>
              <span className="font-medium text-chalk-200">{perms.headline}</span> {perms.detail}
            </div>
          )}

          {/* Current-quality analysis */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-chalk-500">Current narration:</span>
              {busy === "analyze" ? <Loader2 size={13} className="animate-spin text-chalk-500" /> : analysis ? <QualityBadge quality={analysis.classification} /> : <button data-expand-analyze onClick={analyze} className="text-[11px] text-azure-300">Analyze</button>}
              {analysis && <span className="text-[10.5px] text-chalk-500">{analysis.wordCount} words · ~{analysis.estimatedSeconds}s</span>}
            </div>
            {analysis?.reasons?.length > 0 && <ul className="mt-1 list-disc pl-4 text-[10.5px] text-chalk-500">{analysis.reasons.map((r: string, i: number) => <li key={i} data-quality-reason>{r}</li>)}</ul>}
            {analysis?.signals?.unsupportedClaims?.length > 0 && <p data-expand-unsupported className="mt-1 text-[10.5px] text-rose-300">Unsupported: {analysis.signals.unsupportedClaims.join(", ")}</p>}
            {analysis?.signals?.similarTo && analysis.signals.maxSimilarity >= 0.6 && <p data-expand-similar className="mt-1 text-[10.5px] text-rose-300">Too similar to {analysis.signals.similarTo} ({Math.round(analysis.signals.maxSimilarity * 100)}%).</p>}
          </div>

          {!exp ? (
            <div className="flex items-center gap-2">
              <button data-expand-run disabled={preview || busy === "expand"} onClick={() => expand(0)} className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-40">
                {busy === "expand" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Expand &amp; personalize
              </button>
              {blocker && <span data-expand-blocker className="text-[11px] text-amber-300">{blocker}</span>}
            </div>
          ) : (
            <div data-expand-compare className="space-y-2.5">
              {/* Compare original vs proposed */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10.5px] uppercase tracking-wide text-chalk-500">Original · {wordCount(exp.original)} words</p>
                  <p data-expand-original className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[12px] leading-snug text-chalk-400">{exp.original || <span className="italic text-chalk-600">No prior narration.</span>}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[10.5px] uppercase tracking-wide text-chalk-500">Proposed · {wordCount(exp.candidate)} words · ~{Math.round((wordCount(exp.candidate) * 60) / 150)}s</p>
                    {exp.quality && <span data-expand-quality={exp.quality.classification}><QualityBadge quality={exp.quality.classification} /></span>}
                  </div>
                  <textarea data-expand-edit value={exp.candidate} onChange={(e) => setExp({ ...exp, candidate: e.target.value })} className="input min-h-[120px] w-full text-[12px]" />
                </div>
              </div>

              {/* Regeneration honesty: how many distinct drafts remain, and the no-safe-alternative note. */}
              {exp.noSafeAlternative && exp.regenerationNote && (
                <p data-expand-regen-note className="text-[10.5px] text-amber-300">{exp.regenerationNote}</p>
              )}

              {/* Evidence mapping + statements requiring review */}
              {exp.evidenceMap.length > 0 && (
                <details data-expand-evidence className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                  <summary className="cursor-pointer text-[11px] text-chalk-400">Evidence mapping ({exp.evidenceMap.filter((m) => m.evidenceIds.length).length} grounded)</summary>
                  <ul className="mt-1 space-y-1 text-[10.5px]">
                    {exp.evidenceMap.map((m, i) => (
                      <li key={i} className={m.requiresReview ? "text-amber-300" : "text-chalk-500"} data-review={m.requiresReview ? "1" : undefined}>
                        {m.evidenceIds.length ? `[${m.evidenceIds.join(", ")}]` : "[review]"} {m.statement}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {exp.statementsRequiringReview.length > 0 && (
                <p data-expand-review className="text-[10.5px] text-amber-300">{exp.statementsRequiringReview.length} statement(s) need your review before use.</p>
              )}
              {exp.quality?.signals?.unsupportedClaims?.length > 0 && <p className="text-[10.5px] text-rose-300">Proposed contains unsupported claims — edit before {committed ? "creating the version" : "accepting"}.</p>}

              <div className="flex flex-wrap items-center gap-2">
                {committed ? (
                  <button data-expand-fork disabled={busy === "accept" || (exp.quality?.signals?.unsupportedClaims?.length ?? 0) > 0} onClick={commit} className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-40">
                    {busy === "accept" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create improved version
                  </button>
                ) : (
                  <button data-expand-accept disabled={busy === "accept" || (exp.quality?.signals?.unsupportedClaims?.length ?? 0) > 0} onClick={commit} className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-40">
                    {busy === "accept" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept revision
                  </button>
                )}
                <button data-expand-regenerate disabled={busy === "expand"} onClick={regenerate} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40"><RefreshCw size={13} /> Regenerate</button>
                <button data-expand-cancel onClick={cancel} className="btn-ghost text-xs">Cancel</button>
              </div>
            </div>
          )}

          {msg && <p data-expand-msg className={`text-[11px] ${msg.tone === "ok" ? "text-teal-300" : "text-rose-300"}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
