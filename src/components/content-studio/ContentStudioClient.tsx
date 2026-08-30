"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Film, Upload, Copy, Check, Download, Play, RefreshCw, Loader2, Plus, X,
  CircleCheck, CircleAlert, Clapperboard, Users, ExternalLink, Clock, Radio, Eye,
} from "lucide-react";
import { SectionHeader } from "@/components/ui";
import type { StudioItem, SafeJob } from "./types";

// PREVIEW MODE — a read-only, disabled-by-default visibility build. When on, EVERY mutating control is
// disabled and EVERY network call is short-circuited (belt: handlers return early; suspenders: buttons
// are disabled). Nothing enqueues a job, writes storage, sends, or claims success. Fixtures only.
const PreviewCtx = createContext(false);
const usePreview = () => useContext(PreviewCtx);

const POLL_MS = 1500;
const fmtBytes = (b: number) => (b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
const fmtDur = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

export function ContentStudioClient({ initialItems, preview = false }: { initialItems: StudioItem[]; preview?: boolean }) {
  const [items, setItems] = useState<StudioItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string>(initialItems[0]?.piece.id ?? "");
  const [jobOverride, setJobOverride] = useState<Record<string, SafeJob>>({});
  const [creating, setCreating] = useState(false);

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

  const selected = mergedItems.find((it) => it.piece.id === selectedId) ?? mergedItems[0];

  return (
    <PreviewCtx.Provider value={preview}>
    <div className="space-y-5">
      <SectionHeader
        title="Content Studio"
        subtitle="Social · Field Notes. Prepare narration, upload your voiceover, generate the video, preview and download — all from here."
        right={
          <div className="flex items-center gap-2">
            <Link href="/portfolio" className="btn-ghost flex items-center gap-1.5 text-xs" title="Per-business review videos live on each business page">
              <Users size={14} /> Client videos
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
          <span className="font-medium text-chalk-200">Two video workflows.</span> This studio makes the public
          <span className="text-chalk-200"> Field Notes</span> (social). Per-business
          <span className="text-chalk-200"> prospect / client review videos</span> live on each business page under
          <Link href="/portfolio" className="text-azure-300 hover:underline"> Businesses</Link> → a business → its video panel — bound to that business and its evidence.
          That renderer is still being wired (in progress), so it isn't marked complete here.
        </p>
      </div>

      <ClientVideosPanel onPrepared={refetch} onSelect={setSelectedId} />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* ── Piece list ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          {mergedItems.map((it) => (
            <PieceRow key={it.piece.id} item={it} active={it.piece.id === selected?.piece.id} onClick={() => setSelectedId(it.piece.id)} />
          ))}
        </div>

        {/* ── Detail ─────────────────────────────────────────────────── */}
        {selected && <PieceDetail key={selected.piece.id} item={selected} onChanged={refetch} setJobOverride={setJobOverride} />}
      </div>

      {creating && !preview && <NewPieceModal onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refetch(); }} />}
    </div>
    </PreviewCtx.Provider>
  );
}

function ClientVideosPanel({ onPrepared, onSelect }: { onPrepared: () => Promise<void>; onSelect: (id: string) => void }) {
  const preview = usePreview();
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<any[] | null>(null);
  const [leadId, setLeadId] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (preview) { setCands([]); return; } // preview: no server read, show the empty-state copy
    const r = await fetch("/api/content-studio/client/candidates", { cache: "no-store" });
    if (r.ok) { const d = await r.json(); setCands(d.candidates ?? []); }
  }, [preview]);
  useEffect(() => { if (open && cands === null) load(); }, [open, cands, load]);

  const prepare = async (id: string, allowOverride = false) => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview — connect the functional environment to prepare client videos." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/content-studio/client/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: id, allowOverride }) });
      const d = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: d.error + (d.blockers?.length ? " (" + d.blockers.join("; ") + ")" : "") });
      else { setMsg({ tone: "ok", text: `Prepared for ${d.businessName ?? id}. ${d.narrationNote ?? ""} Upload a voiceover, then Generate.` }); await onPrepared(); onSelect(d.pieceId); }
    } catch (e: any) { setMsg({ tone: "err", text: String(e?.message ?? e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-teal-300"><Users size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-chalk-100">Client videos <span className="ml-1 rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-300">evidence-backed</span></span>
          <span className="block text-xs text-chalk-500">Prepare a review video from a business's evidence — same engine, bound to the business.</span>
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
                    <button disabled={busy || preview} onClick={() => prepare(c.leadId)} className="btn-secondary text-[11px] disabled:opacity-40">Prepare</button>
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
            <button disabled={busy || preview || !leadId.trim()} onClick={() => prepare(leadId.trim())} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />} Prepare</button>
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

function statusOf(item: StudioItem): { label: string; tone: string; icon: any } {
  const active = item.jobs.find((j) => j.status === "queued" || j.status === "rendering");
  if (active) return { label: active.stage || "Rendering", tone: "text-azure-300 border-azure-500/30 bg-azure-500/10", icon: Loader2 };
  if (item.postedAt) return { label: "Posted", tone: "text-teal-300 border-teal-400/30 bg-teal-400/10", icon: Radio };
  const failed = item.jobs.find((j) => j.status === "failed");
  if (failed && !item.piece.recommendedRel) return { label: "Failed", tone: "text-coral-300 border-coral-400/30 bg-coral-400/10", icon: CircleAlert };
  const pv = item.provenance;
  if (item.piece.recommendedRel) {
    if (pv.audioKind === "placeholder") return { label: "Preview only", tone: "text-amber-300 border-amber-400/30 bg-amber-400/10", icon: CircleAlert };
    if (pv.approved || pv.audioKind === "approved-master") return { label: "Posting-ready", tone: "text-teal-300 border-teal-400/30 bg-teal-400/10", icon: CircleCheck };
    return { label: "Review & approve", tone: "text-azure-300 border-azure-500/30 bg-azure-500/10", icon: Clock };
  }
  if (!item.piece.renderable) return { label: "Draft · needs scene", tone: "text-chalk-400 border-white/10 bg-white/[0.04]", icon: Clock };
  return { label: "Not generated", tone: "text-chalk-400 border-white/10 bg-white/[0.04]", icon: Clock };
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
        <span className="flex items-center gap-1.5 text-[10.5px] text-chalk-500">#{item.piece.id}</span>
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

function PieceDetail({ item, onChanged, setJobOverride }: { item: StudioItem; onChanged: () => Promise<void>; setJobOverride: (f: (o: Record<string, SafeJob>) => Record<string, SafeJob>) => void }) {
  const preview = usePreview();
  const { piece } = item;
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const activeJob = item.jobs.find((j) => j.status === "queued" || j.status === "rendering");
  const lastFailed = item.jobs.find((j) => j.status === "failed");
  const hasUpload = item.uploads.length > 0;
  const narrationText = piece.narration.join("\n");

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
            <p className="text-[11px] uppercase tracking-wide text-chalk-500">Field Note #{piece.id}</p>
            <h3 className="text-lg font-semibold text-chalk-50">{piece.title}</h3>
            <p className="mt-0.5 text-sm text-chalk-400">{piece.concept}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-chalk-500">
              {piece.targetSeconds && <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5">1080×1920 · ~{piece.targetSeconds}s</span>}
              {piece.hasThumbnailFirst && <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-teal-300">thumbnail = frame zero</span>}
              {item.postedAt && <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-teal-300">Posted {new Date(item.postedAt).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${msg.tone === "ok" ? "border-teal-400/25 bg-teal-400/[0.06] text-teal-200" : "border-coral-400/30 bg-coral-400/[0.06] text-coral-200"}`}>
          {msg.tone === "ok" ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />} <span>{msg.text}</span>
        </div>
      )}

      {/* Narration + captions */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-chalk-100">Narration script</h4>
          {narrationText && <CopyBtn text={narrationText} label="Copy narration" />}
        </div>
        {narrationText ? (
          <ol className="space-y-1.5">
            {piece.narration.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-chalk-300"><span className="w-4 shrink-0 text-right font-mono text-[11px] text-chalk-600">{i + 1}</span>{line}</li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-chalk-500">This piece was finished in VEED without a captured timing sheet. Enter narration when regenerating, or copy from the captions below.</p>
        )}
        {(piece.captionIG || piece.captionLI) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {piece.captionIG && <CopyBtn text={piece.captionIG} label="Copy IG / TikTok caption" />}
            {piece.captionLI && <CopyBtn text={piece.captionLI} label="Copy LinkedIn caption" />}
          </div>
        )}
      </div>

      {/* Voiceover upload + playback */}
      <UploadPanel item={item} onChanged={onChanged} setMsg={setMsg} />

      {/* Generate */}
      <div className="card p-4">
        <h4 className="mb-1 text-sm font-semibold text-chalk-100">Generate video</h4>
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
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* Only #004–#006 have a previously-approved voiceover to reuse; template pieces render
                    from an uploaded VO. */}
                {["004", "005", "006"].includes(piece.id) && (
                  <button disabled={busy || preview} onClick={() => startRender(false)} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Generate (approved voiceover)
                  </button>
                )}
                <button disabled={busy || preview || !hasUpload} onClick={() => startRender(true)} className={`flex items-center gap-1.5 text-sm disabled:opacity-40 ${["004", "005", "006"].includes(piece.id) ? "btn-secondary" : "btn-primary"}`} title={preview ? "Disabled in preview" : hasUpload ? "" : "Upload a voiceover first"}>
                  <Film size={15} /> Generate with my voiceover
                </button>
                {lastFailed && <button disabled={busy || preview || !hasUpload} onClick={() => startRender(true)} className="btn-ghost flex items-center gap-1.5 text-xs text-coral-300 disabled:opacity-40"><RefreshCw size={13} /> Retry</button>}
              </div>
            )}
            {lastFailed && !activeJob && <p className="mt-2 text-xs text-coral-300">Last render failed: {lastFailed.error}</p>}
          </>
        )}
      </div>

      {/* Preview + downloads — labels reflect explicit audio provenance + approval */}
      {piece.recommendedRel && (() => {
        const pv = item.provenance;
        const isPlaceholder = pv.audioKind === "placeholder";
        const postable = pv.postingAllowed;
        return (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-chalk-100">{isPlaceholder ? "Preview" : "Preview & download"}</h4>
              {isPlaceholder ? (
                <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">Preview only — replace placeholder voiceover</span>
              ) : postable ? (
                <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-1.5 py-0.5 text-[10px] text-teal-300">{pv.audioKind === "approved-master" ? "approved audio · posting-ready" : "approved for posting"}</span>
              ) : (
                <span className="rounded-md border border-azure-500/25 bg-azure-500/10 px-1.5 py-0.5 text-[10px] text-azure-300">uploaded — review, then approve</span>
              )}
            </div>
            {pv.approvalStale && <p className="mb-2 text-[11px] text-amber-300">Inputs changed since approval — re-approve the current render before posting.</p>}
            <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
              <video src={piece.recommendedRel} poster={piece.thumbRel || undefined} controls playsInline className="w-full rounded-lg border border-white/[0.08] bg-black" style={{ aspectRatio: "9 / 16" }} />
              <div className="space-y-2">
                <a href={piece.recommendedRel} download className={`flex w-full items-center justify-center gap-1.5 text-sm sm:w-auto ${isPlaceholder ? "btn-secondary" : "btn-primary"}`}><Download size={15} /> {isPlaceholder ? "Download preview" : "Download video"}</a>
                {piece.thumbRel && <a href={piece.thumbRel} download className="btn-secondary flex w-full items-center justify-center gap-1.5 text-sm sm:w-auto"><Download size={15} /> Download thumbnail</a>}
                {!isPlaceholder && !pv.approved && pv.audioKind === "uploaded" && (
                  <button disabled={preview} onClick={approve} title={preview ? "Disabled in preview" : ""} className="btn-primary flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 sm:w-auto"><CircleCheck size={15} /> Approve for posting</button>
                )}
                <button disabled={preview || !postable} onClick={markPosted} title={preview ? "Disabled in preview" : postable ? "" : "Approve a non-placeholder render first"} className="btn-ghost flex w-full items-center justify-center gap-1.5 text-xs disabled:opacity-40 sm:w-auto"><Radio size={13} /> {item.postedAt ? "Update posted date" : "Mark as posted"}</button>
                {isPlaceholder
                  ? <p className="pt-1 text-[11px] leading-relaxed text-amber-300/90">This render uses a placeholder voiceover for layout/timing preview only. Upload your real voiceover to produce a postable video — it is not an approved or final asset.</p>
                  : <p className="pt-1 text-[11px] leading-relaxed text-chalk-500">The thumbnail is also embedded as the first frame — still upload it as the cover when posting; platforms don’t all pick frame zero.</p>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sharing & outreach — only for an approved, non-placeholder video */}
      {item.provenance.postingAllowed && item.provenance.audioKind !== "placeholder" && <SharePanel item={item} />}

      {/* Version history */}
      {item.jobs.length > 0 && (
        <div className="card p-4">
          <h4 className="mb-2 text-sm font-semibold text-chalk-100">Version history</h4>
          <div className="space-y-1.5">
            {item.jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-2 text-xs">
                <JobDot status={j.status} />
                <span className="font-mono text-[10.5px] text-chalk-500">{j.inputVersion}</span>
                <span className="text-chalk-400">{j.mode === "uploaded-vo" ? "uploaded VO" : "approved audio"}</span>
                <span className="ml-auto text-chalk-600">{new Date(j.createdAt).toLocaleString()}</span>
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

function RenderProgress({ job }: { job: SafeJob }) {
  const pct = Math.round((job.progress || 0) * 100);
  return (
    <div className="rounded-xl border border-azure-500/25 bg-azure-500/[0.05] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-azure-200"><Loader2 size={13} className="animate-spin" /> {job.stage || "Rendering"} · {pct}%</div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-950">
        <div className="h-full rounded-full bg-azure-400 transition-all duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-chalk-500">Runs in the background — you can leave this page or refresh; the job keeps going.</p>
    </div>
  );
}

function UploadPanel({ item, onChanged, setMsg }: { item: StudioItem; onChanged: () => Promise<void>; setMsg: (m: { tone: "ok" | "err"; text: string } | null) => void }) {
  const preview = usePreview();
  const { piece } = item;
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = item.uploads[0];

  const onFile = async (file: File) => {
    if (preview) { setMsg({ tone: "err", text: "Disabled in preview — voiceover upload runs in the functional environment." }); return; }
    setUploading(true); setMsg(null);
    try {
      // Detect duration client-side (mobile-friendly) before sending.
      const duration = await detectDuration(file).catch(() => null);
      const fd = new FormData();
      fd.append("pieceId", piece.id);
      fd.append("file", file);
      if (duration != null) fd.append("durationSeconds", String(duration));
      const r = await fetch("/api/content-studio/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: data.error || "Upload failed." });
      else { setMsg({ tone: "ok", text: `Uploaded ${file.name} (${fmtDur(duration)}).` }); await onChanged(); }
    } catch (e: any) { setMsg({ tone: "err", text: String(e?.message ?? e) }); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  return (
    <div className="card p-4">
      <h4 className="mb-1 text-sm font-semibold text-chalk-100">Your voiceover</h4>
      <p className="mb-3 text-xs leading-relaxed text-chalk-500">Record narration on your phone, then upload the MP3 (or M4A / WAV, ≤25 MB, 5–90s). You produce the voice — Content Studio never generates it.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" className="hidden" disabled={preview} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <button disabled={uploading || preview} onClick={() => inputRef.current?.click()} title={preview ? "Disabled in preview" : ""} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-40">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {uploading ? "Uploading…" : latest ? "Replace voiceover" : "Upload voiceover"}
        </button>
        {latest && <span className="text-xs text-chalk-400">{latest.name} · {fmtDur(latest.durationSeconds)} · {fmtBytes(latest.bytes)}</span>}
      </div>
      {latest && (
        <audio controls preload="none" className="mt-3 w-full" src={`/api/content-studio/audio/${piece.id}?t=${encodeURIComponent(latest.uploadedAt)}`}>
          Your browser can’t play this audio.
        </audio>
      )}
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
