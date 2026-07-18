"use client";
// Conversation Mode — a genuine focus environment for a live discovery call.
// Surfaces only what helps in the moment; on wrap-up it summarizes, updates the
// record, refreshes confidence, and suggests next steps.
import { useMemo, useState, useTransition, useEffect } from "react";
import Link from "next/link";
import {
  Play, Pause, RotateCcw, Check, Plus, Save, X, CheckCircle2, HelpCircle, Lightbulb, Sparkles,
  Gauge, AlertCircle, ShieldQuestion, ArrowRight,
} from "lucide-react";
import { saveConversationAction, type WrapUpResult } from "@/lib/conversation-actions";
import { cn } from "@/lib/utils";

interface Props {
  leadId: string;
  leadName: string;
  meetingId: string | null;
  summary: string | null;
  maturity: string | null;
  questions: string[];
  observations: string[];
  strengths: string[];
  friction: string[];
  hypotheses: string[];
  opportunities: string[];
  initialNotes: string;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ConversationMode(props: Props) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [checkedQ, setCheckedQ] = useState<Set<number>>(new Set());
  const [checkedH, setCheckedH] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState(props.initialNotes);
  const [quick, setQuick] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<WrapUpResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<number>>>, i: number) =>
    set((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const addQuick = () => {
    if (!draft.trim()) return;
    setQuick((q) => [...q, draft.trim()]);
    setDraft("");
    setResult(null);
  };

  const summaryText = useMemo(() => {
    const lines: string[] = [`Duration: ${fmt(seconds)}`];
    const cq = props.questions.filter((_, i) => checkedQ.has(i));
    if (cq.length) { lines.push("", "Questions covered:"); cq.forEach((q) => lines.push(`- ${q}`)); }
    const ch = props.hypotheses.filter((_, i) => checkedH.has(i));
    if (ch.length) { lines.push("", "Validated in conversation:"); ch.forEach((h) => lines.push(`- ${h}`)); }
    if (quick.length) { lines.push("", "Captured in the moment:"); quick.forEach((q) => lines.push(`- ${q}`)); }
    if (notes.trim()) { lines.push("", "Notes:", notes.trim()); }
    return lines.join("\n");
  }, [seconds, checkedQ, checkedH, quick, notes, props.questions, props.hypotheses]);

  const wrapUp = () => startTransition(async () => {
    setRunning(false);
    const r = await saveConversationAction({ leadId: props.leadId, meetingId: props.meetingId, notes, summary: summaryText });
    setResult(r);
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Focus bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-ink-950/80 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-chalk-500">In conversation with</p>
          <p className="truncate text-lg font-semibold text-chalk-50">{props.leadName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xl tabular-nums text-chalk-100">{fmt(seconds)}</span>
          <button onClick={() => setRunning((r) => !r)} className="rounded-lg border border-white/10 p-2 text-chalk-200 hover:bg-white/[0.06]" aria-label={running ? "Pause" : "Start"}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
          <button onClick={() => { setSeconds(0); setRunning(false); }} className="rounded-lg border border-white/10 p-2 text-chalk-500 hover:bg-white/[0.06]" aria-label="Reset"><RotateCcw size={15} /></button>
          <Link href={`/leads/${props.leadId}`} className="rounded-lg border border-white/10 p-2 text-chalk-500 hover:bg-white/[0.06]" aria-label="Exit"><X size={16} /></Link>
        </div>
      </div>

      {/* Business summary */}
      {(props.summary || props.maturity) && (
        <div className="card p-5">
          {props.summary && <p className="text-sm leading-relaxed text-chalk-300">{props.summary}</p>}
          {props.maturity && <p className="mt-2 flex items-center gap-1.5 text-xs text-chalk-500"><Gauge size={12} /> {props.maturity}</p>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Questions + hypotheses (things to do live) */}
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-100"><HelpCircle size={15} className="text-azure-300" /> Questions to explore</h2>
            {props.questions.length === 0 ? <p className="text-sm text-chalk-500">No prepared questions. Listen for what matters most to them.</p> : (
              <ul className="space-y-2">
                {props.questions.map((q, i) => (
                  <li key={i}>
                    <button onClick={() => toggle(setCheckedQ, i)} className="flex w-full items-start gap-2.5 text-left">
                      <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border", checkedQ.has(i) ? "border-teal-400 bg-teal-400/20 text-teal-300" : "border-white/20 text-transparent")}><Check size={11} /></span>
                      <span className={cn("text-sm", checkedQ.has(i) ? "text-chalk-500 line-through" : "text-chalk-300")}>{q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {props.hypotheses.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-chalk-100"><ShieldQuestion size={15} className="text-amber-300" /> Evidence to validate</h2>
              <p className="mb-3 text-xs text-chalk-500">Confirm or correct these live — they are inferences, not facts.</p>
              <ul className="space-y-2">
                {props.hypotheses.map((h, i) => (
                  <li key={i}>
                    <button onClick={() => toggle(setCheckedH, i)} className="flex w-full items-start gap-2.5 text-left">
                      <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border", checkedH.has(i) ? "border-teal-400 bg-teal-400/20 text-teal-300" : "border-white/20 text-transparent")}><Check size={10} /></span>
                      <span className={cn("text-sm", checkedH.has(i) ? "text-teal-300" : "text-chalk-300")}>{h}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* What we already know */}
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-100"><CheckCircle2 size={15} className="text-emerald-400" /> What we already know</h2>
          {props.strengths.length > 0 && (
            <div className="mb-3">
              <p className="label mb-1">Strengths to affirm</p>
              <ul className="space-y-1">{props.strengths.slice(0, 4).map((s, i) => <li key={i} className="text-sm text-chalk-300">• {s}</li>)}</ul>
            </div>
          )}
          {props.friction.length > 0 && (
            <div className="mb-3">
              <p className="label mb-1 flex items-center gap-1.5"><AlertCircle size={11} className="text-amber-400" /> Observed friction</p>
              <ul className="space-y-1">{props.friction.slice(0, 4).map((s, i) => <li key={i} className="text-sm text-chalk-300">• {s}</li>)}</ul>
            </div>
          )}
          {props.opportunities.length > 0 && (
            <div>
              <p className="label mb-1 flex items-center gap-1.5"><Sparkles size={11} className="text-azure-300" /> Opportunities to explore</p>
              <ul className="space-y-1">{props.opportunities.slice(0, 4).map((s, i) => <li key={i} className="text-sm text-chalk-300">• {s}</li>)}</ul>
            </div>
          )}
          {props.observations.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-chalk-500">Confirmed observations ({props.observations.length})</summary>
              <ul className="mt-1.5 space-y-1">{props.observations.map((o, i) => <li key={i} className="text-xs text-chalk-400">• {o}</li>)}</ul>
            </details>
          )}
        </div>
      </div>

      {/* Quick capture */}
      <div className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-100"><Lightbulb size={15} className="text-amber-300" /> Capture as you go</h2>
        <div className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQuick(); } }} placeholder="Something they said, a friction point, a next step…" className="input flex-1 text-sm" />
          <button onClick={addQuick} className="btn-secondary shrink-0 text-xs"><Plus size={13} /> Add</button>
        </div>
        {quick.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {quick.map((q, i) => <li key={i} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-chalk-200"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" /> {q}</li>)}
          </ul>
        )}
        <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setResult(null); }} rows={4} placeholder="Longer notes from the conversation…" className="input mt-3 text-sm" />
      </div>

      {/* Wrap up */}
      {result?.saved ? (
        <div className="card border-teal-400/30 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-teal-200"><CheckCircle2 size={16} /> Conversation captured</p>
          <ul className="mt-2 space-y-1 text-sm text-chalk-300">
            <li className="flex items-center gap-2"><Check size={13} className="text-teal-400" /> Summary composed and saved to the business record</li>
            <li className="flex items-center gap-2"><Check size={13} className="text-teal-400" /> Meeting notes updated</li>
            {result.evidenceConfidence != null && <li className="flex items-center gap-2"><Check size={13} className="text-teal-400" /> Intelligence refreshed — evidence confidence {result.evidenceConfidence}%</li>}
          </ul>
          {result.nextSteps.length > 0 && (
            <div className="mt-3">
              <p className="label mb-1.5">Suggested next steps</p>
              <ul className="space-y-1">{result.nextSteps.map((s, i) => <li key={i} className="flex items-start gap-2 text-sm text-chalk-200"><ArrowRight size={13} className="mt-0.5 shrink-0 text-azure-300" /> {s}</li>)}</ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Link href={`/leads/${props.leadId}/relationship`} className="btn-secondary text-xs">View relationship</Link>
            <Link href={`/leads/${props.leadId}`} className="btn-primary text-xs">Back to business</Link>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-chalk-500">On wrap-up, the notes are summarized, the record is updated, confidence is refreshed, and next steps are suggested.</p>
          <button onClick={wrapUp} disabled={pending} className="btn-primary text-sm disabled:opacity-60"><Save size={15} /> {pending ? "Wrapping up…" : "Wrap up & save"}</button>
        </div>
      )}
    </div>
  );
}
