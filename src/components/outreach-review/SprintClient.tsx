"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, Upload, SkipForward, X, AlertTriangle, Loader2, ChevronRight } from "lucide-react";

const API = "/api/content-studio/outreach-reviews/sprint";
async function post(action: string, body: any) {
  const r = await fetch(`${API}?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

// ── START: batch selector → creates a session and opens the first business ──────────────────────────────
export function SprintStart({ readyCount }: { readyCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = async (batchSize: number | "all") => {
    if (busy || readyCount === 0) return;
    setBusy(true);
    const { json } = await post("start", { batchSize });
    if (json.sessionId && json.firstLeadId) router.push(`/content-studio/outreach-reviews/sprint/${json.sessionId}/${json.firstLeadId}`);
    else setBusy(false);
  };
  return (
    <div data-sprint-start className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm text-chalk-300"><span data-sprint-ready-count className="font-semibold text-teal-300">{readyCount}</span> businesses ready for narration.</p>
        <p className="mt-1 text-[12px] text-chalk-500">Start a sprint: copy each narration, record it in Voice Memos, upload the audio, and the next business opens automatically.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([10, 25, 50, "all"] as const).map((n) => (
          <button key={String(n)} data-sprint-batch={String(n)} disabled={busy || readyCount === 0} onClick={() => start(n)}
            className="rounded-xl border border-teal-400/30 bg-teal-400/[0.06] px-3 py-4 text-center text-sm font-semibold text-teal-200 ring-focus disabled:opacity-40">
            {busy ? <Loader2 className="mx-auto animate-spin" size={16} /> : n === "all" ? "All ready" : n}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-chalk-600">Default order: highest-scoring, oldest-ready first.</p>
    </div>
  );
}

type Card = { leadId: string; businessName: string; market: string; band: string; score: number; whyShort: string; recipientRole: string; recipientVerified: boolean; narration: string; scriptRevisionId: string; wordCount: number; estimatedSeconds: number };
type Prog = { completed: number; skipped: number; rejected: number; needsAttention: number; remaining: number; position: number; total: number };

// ── RUNNER: one business per screen ─────────────────────────────────────────────────────────────────────
export function SprintRunner({ sessionId, leadId }: { sessionId: string; leadId: string }) {
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState<{ route: string } | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const advanceTimer = useRef<any>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}?action=session&sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (d.done) { setDone(true); setProg(d.progress); return; }
    setCard(d.card); setProg(d.progress);
    if (d.leadId && d.leadId !== leadId) router.replace(`/content-studio/outreach-reviews/sprint/${sessionId}/${d.leadId}`);
  }, [sessionId, leadId, router]);
  useEffect(() => { load(); return () => advanceTimer.current && clearTimeout(advanceTimer.current); }, [load]);

  const copyNarration = async () => {
    if (!card) return;
    try { await navigator.clipboard.writeText(card.narration); }
    catch { const ta = document.createElement("textarea"); ta.value = card.narration; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch { /* manual-select fallback below */ } ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const goNext = (route: string) => { if (advanceTimer.current) clearTimeout(advanceTimer.current); setAutoAdvance(null); router.push(route); };

  const transition = async (action: string, extra: any = {}) => {
    setBusy(action); setMsg(null);
    const { json } = await post(action, { sessionId, ...extra });
    setBusy(null);
    if (json.done) { setDone(true); setProg(json.progress); return; }
    if (json.nextLeadId) router.push(`/content-studio/outreach-reviews/sprint/${sessionId}/${json.nextLeadId}`);
    else load();
  };

  const upload = async (file: File) => {
    if (!card) return;
    setBusy("upload"); setMsg(null); setTranscript(null);
    const b64 = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.readAsDataURL(file); });
    const durationSeconds = Number((file as any).durationSeconds ?? 0) || 60;
    const { json } = await post("upload", { sessionId, leadId: card.leadId, audioBase64: b64, mime: file.type, durationSeconds, requestedRevisionId: card.scriptRevisionId });
    setBusy(null);
    if (json.transcript) setTranscript(`${json.transcript.classification} (${Math.round((json.transcript.coverage ?? 0) * 100)}%)`);
    if (!json.ok) { setMsg({ tone: "err", text: json.reason || "Upload failed." }); return; }
    if (json.renderQueued) {
      setMsg({ tone: "ok", text: "Audio uploaded and rendering started." });
      if (json.nextRoute) { setAutoAdvance({ route: json.nextRoute }); advanceTimer.current = setTimeout(() => goNext(json.nextRoute), 1600); }
      else { setDone(true); }
    } else {
      setMsg({ tone: "warn", text: json.reason || "Recording not accepted — replace it before rendering." });
    }
  };

  if (done) {
    return (
      <div data-sprint-summary className="mx-auto max-w-xl space-y-3 text-center">
        <h1 className="text-lg font-semibold text-chalk-50">Sprint complete</h1>
        {prog && <p data-sprint-progress className="text-sm text-chalk-400">{prog.completed} completed · {prog.skipped} skipped · {prog.rejected} rejected · {prog.needsAttention} needs attention · {prog.remaining} remaining</p>}
        <p className="text-[12px] text-chalk-500">Rendering runs in the background. Completed reviews move to Ready to Approve once their render finishes — nothing is approved, scheduled, or sent automatically.</p>
        <Link href="/content-studio/outreach-reviews/sprint" data-sprint-restart className="btn-secondary inline-flex text-xs">Back to sprint start</Link>
      </div>
    );
  }
  if (!card) return <div className="mx-auto max-w-xl p-6 text-center text-[13px] text-chalk-400"><Loader2 className="mx-auto animate-spin" size={18} /> Loading the next business…</div>;

  return (
    <div data-sprint-screen className="mx-auto w-full max-w-xl space-y-4 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/content-studio/outreach-reviews/sprint" data-sprint-exit aria-label="Exit sprint" className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        {prog && <span data-sprint-progress className="text-[12px] text-chalk-400">Business {prog.position + 1} of {prog.total} · {prog.remaining} left</span>}
        <span data-sprint-band className="rounded px-1.5 py-0.5 text-[10px] font-medium text-teal-300">{card.band.replace(/_/g, " ")} · {card.score}</span>
      </div>

      {/* Company + why + recipient */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div data-sprint-company className="text-[15px] font-semibold text-chalk-50">{card.businessName}</div>
        <div className="text-[12px] text-chalk-500">{card.market}</div>
        <p data-sprint-why className="mt-2 text-[12px] leading-snug text-chalk-400">{card.whyShort}</p>
        <p data-sprint-recipient className="mt-1 text-[11px] text-chalk-500">Recipient: {card.recipientRole}{card.recipientVerified ? " ✓ verified" : " · resolution tracked"}</p>
      </div>

      {/* Narration — large readable panel + copy */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-chalk-500">Narration · {card.wordCount} words · ~{card.estimatedSeconds}s</span>
          <button data-sprint-copy onClick={copyNarration} className="btn-secondary flex items-center gap-1.5 text-xs">
            {copied ? <><Check size={13} /> <span data-sprint-copied>Copied</span></> : <><Copy size={13} /> Copy narration</>}
          </button>
        </div>
        <p data-sprint-narration className="whitespace-pre-wrap text-[14px] leading-relaxed text-chalk-100">{card.narration}</p>
      </div>

      {transcript && <p data-sprint-transcript className="text-[11px] text-chalk-500">Recording check: {transcript}</p>}
      {msg && <p data-sprint-msg className={`text-[12px] ${msg.tone === "ok" ? "text-teal-300" : msg.tone === "warn" ? "text-amber-300" : "text-rose-300"}`}>{msg.text}</p>}
      {autoAdvance && (
        <div className="flex items-center gap-2 text-[12px] text-chalk-400">
          <ChevronRight size={14} /> Opening the next business…
          <button data-sprint-stay onClick={() => { if (advanceTimer.current) clearTimeout(advanceTimer.current); setAutoAdvance(null); }} className="btn-ghost text-[11px]">Stay here</button>
          <button data-sprint-next onClick={() => goNext(autoAdvance.route)} className="btn-ghost text-[11px]">Next now</button>
        </div>
      )}

      {/* Secondary actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button data-sprint-skip disabled={!!busy} onClick={() => transition("skip")} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40"><SkipForward size={13} /> Skip for now</button>
        <button data-sprint-attention disabled={!!busy} onClick={() => transition("attention")} className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-40"><AlertTriangle size={13} /> Needs attention</button>
        <button data-sprint-reject disabled={!!busy} onClick={() => { if (confirm(`Reject ${card.businessName}? This removes it from all outreach.`)) transition("reject", { reason: "poor-fit" }); }} className="btn-ghost flex items-center gap-1.5 text-xs text-rose-300/80 disabled:opacity-40"><X size={13} /> Reject</button>
      </div>

      {/* Sticky upload action — clear of the bottom nav (focus mode strips it, but keep safe-area padding) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0B0A09]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <input ref={fileRef} type="file" accept="audio/mp4,audio/x-m4a,audio/aac,audio/mpeg,audio/mp3,audio/wav" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
          <button data-sprint-upload disabled={busy === "upload"} onClick={() => fileRef.current?.click()} className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold disabled:opacity-50">
            {busy === "upload" ? <><Loader2 className="animate-spin" size={16} /> Uploading…</> : <><Upload size={16} /> Upload recording</>}
          </button>
        </div>
      </div>
    </div>
  );
}
