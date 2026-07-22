"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Live Meeting Workspace — the room, not a CRM.
//
// A distraction-free place to think while a discovery conversation is happening.
// The operator types notes in their own words; the detection layer quietly surfaces
// candidate memories (Approve / Edit / Dismiss) and gentle prompts for what hasn't
// come up yet. Nothing is saved to memory without an explicit approval, and every
// approved item carries the exact words that produced it. Detection is deterministic
// and runs entirely in the browser — the notes never leave the page until the
// operator decides they should.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Pencil, X, Brain, Sparkles, Circle, Clock } from "lucide-react";
import { detectMemories, missingConcepts, CONCEPT_OF_CATEGORY, type DetectedMemory, type NaturalConcept } from "@/lib/memory-detect";
import { MEMORY_CATEGORIES, MEMORY_CONFIDENCES } from "@/lib/types";
import type { RelationshipMemoryItem } from "@/lib/types";
import { saveDetectedMemoryAction } from "@/lib/memory-actions";

const keyOf = (d: { category: string; quote: string }) => `${d.category}|${d.quote.trim().toLowerCase()}`;

// A timeline entry recorded when the operator commits something — in-session only.
type TimelineEntry = { at: number; label: string };

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
function clockOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const fieldCls = "rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-[13px] text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

function SuggestionCard({
  d,
  onApprove,
  onDismiss,
  busy,
}: {
  d: DetectedMemory;
  onApprove: (edited: DetectedMemory) => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DetectedMemory>(d);

  return (
    <div className="rounded-lg border border-azure-400/15 bg-azure-500/[0.04] p-3">
      {editing ? (
        <div className="space-y-2">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`w-full ${fieldCls}`} />
          <textarea value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} rows={2} className={`w-full ${fieldCls}`} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as DetectedMemory["category"], concept: CONCEPT_OF_CATEGORY[e.target.value as DetectedMemory["category"]] })} className={fieldCls}>
              {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value as DetectedMemory["confidence"] })} className={fieldCls}>
              {MEMORY_CONFIDENCES.map((c) => <option key={c} value={c}>{c} confidence</option>)}
            </select>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-chalk-100">{draft.title}</p>
            <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-chalk-500">{draft.concept}</span>
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-chalk-300">{draft.value}</p>
          <p className="mt-1 text-[11px] italic text-chalk-600">“{draft.quote}”</p>
          <p className="mt-0.5 text-[10.5px] text-chalk-600">{draft.category} · {draft.confidence} confidence</p>
        </>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          disabled={busy}
          onClick={() => onApprove(draft)}
          className="inline-flex items-center gap-1 rounded-md border border-teal-400/25 px-2 py-0.5 text-[11px] text-teal-300 hover:bg-teal-400/[0.06] disabled:opacity-50"
        >
          <Check size={12} /> Approve
        </button>
        <button
          onClick={() => setEditing((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400 hover:text-chalk-100"
        >
          <Pencil size={12} /> {editing ? "Done" : "Edit"}
        </button>
        <button
          onClick={onDismiss}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-chalk-700 hover:text-coral-300"
        >
          <X size={12} /> Dismiss
        </button>
      </div>
    </div>
  );
}

export function LiveMeetingWorkspace({
  leadId,
  businessName,
  objective,
  initialNotes,
  existingMemory,
}: {
  leadId: string;
  businessName: string;
  objective: string;
  initialNotes: string;
  existingMemory: RelationshipMemoryItem[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [pending, startSave] = useTransition();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const startRef = useRef<number>(0);
  const [now, setNow] = useState<number>(0);

  // Meeting clock — starts on mount (client only; Date is fine in the browser).
  useEffect(() => {
    startRef.current = Date.now();
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-save notes to the browser so a refresh mid-conversation loses nothing.
  const storageKey = `meeting-notes:${leadId}`;
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && !initialNotes) setNotes(saved);
    } catch { /* private mode — no-op */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try { window.localStorage.setItem(storageKey, notes); } catch { /* no-op */ }
    }, 400);
    return () => clearTimeout(t);
  }, [notes, storageKey]);

  // Concepts we already know about — from persisted memory (skip re-suggesting).
  const knownValueKeys = useMemo(
    () => new Set(existingMemory.map((m) => `${m.category}|${m.value.trim().toLowerCase()}`)),
    [existingMemory],
  );

  // Live detection — deterministic, runs as they type.
  const detections = useMemo(() => detectMemories(notes), [notes]);
  const suggestions = detections.filter(
    (d) => !dismissed.has(keyOf(d)) && !approved.has(keyOf(d)) && !knownValueKeys.has(`${d.category}|${d.value.trim().toLowerCase()}`),
  );

  // Adaptive assistant — which core concepts still haven't come up at all.
  const covered = useMemo<NaturalConcept[]>(() => {
    const set = new Set<NaturalConcept>();
    existingMemory.forEach((m) => set.add(CONCEPT_OF_CATEGORY[m.category]));
    detections.forEach((d) => set.add(d.concept));
    return [...set];
  }, [existingMemory, detections]);
  const missing = missingConcepts(covered);

  function approve(d: DetectedMemory) {
    const k = keyOf(d);
    setSavingKey(k);
    startSave(async () => {
      await saveDetectedMemoryAction(leadId, { category: d.category, title: d.title, value: d.value, confidence: d.confidence, quote: d.quote });
      setApproved((prev) => new Set(prev).add(k));
      setTimeline((prev) => [{ at: Date.now(), label: `Saved to memory · ${d.title}` }, ...prev]);
      setSavingKey(null);
    });
  }
  function dismiss(d: DetectedMemory) {
    setDismissed((prev) => new Set(prev).add(keyOf(d)));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── Notes: the distraction-free surface ─────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-azure-300" />
            <h2 className="text-sm font-semibold text-chalk-100">Live notes</h2>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-chalk-600">
              <Clock size={12} /> {elapsed(Math.max(0, now - startRef.current))}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-chalk-500">
            Write in their words. Nothing here is saved to the record until you approve it.
          </p>
          <textarea
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={18}
            placeholder="What they said…"
            className="mt-3 w-full resize-y rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[14px] leading-relaxed text-chalk-100 placeholder:text-chalk-700 focus:border-white/20 focus:outline-none"
          />
          <p className="mt-1.5 text-[11px] text-chalk-700">Auto-saved to this browser as you type.</p>
        </div>

        {/* Conversation timeline — what was committed, when (in-session) */}
        {timeline.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-chalk-500" />
              <h2 className="text-sm font-semibold text-chalk-100">This conversation</h2>
            </div>
            <ul className="mt-3 space-y-2">
              {timeline.map((e, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="w-12 shrink-0 text-[11px] text-chalk-600">{clockOf(e.at)}</span>
                  <span className="text-chalk-300">{e.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Assistant column: detected memory + gentle prompts ──────────────── */}
      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-2">
            <Brain size={15} className="text-teal-300" />
            <h2 className="text-sm font-semibold text-chalk-100">Detected memory</h2>
            {suggestions.length > 0 && <span className="ml-auto text-[11px] text-chalk-600">{suggestions.length}</span>}
          </div>
          <p className="mt-1 text-[12px] text-chalk-500">Candidates from what you’ve written. You decide what’s real.</p>
          {suggestions.length === 0 ? (
            <p className="mt-4 text-[13px] text-chalk-600">Nothing to suggest yet — keep listening.</p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {suggestions.map((d) => (
                <SuggestionCard
                  key={keyOf(d)}
                  d={d}
                  busy={pending && savingKey === keyOf(d)}
                  onApprove={approve}
                  onDismiss={() => dismiss(d)}
                />
              ))}
            </div>
          )}
        </div>

        {missing.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <Circle size={13} className="text-amber-300" />
              <h2 className="text-sm font-semibold text-chalk-100">Still worth learning</h2>
            </div>
            <p className="mt-1 text-[12px] text-chalk-500">Not a script — just what hasn’t come up yet.</p>
            <ul className="mt-3 space-y-2">
              {missing.map((m) => (
                <li key={m.concept} className="text-[13px] text-chalk-300">
                  <span className="text-chalk-500">{m.concept} · </span>{m.prompt}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card border-azure-500/15 bg-azure-500/[0.03] p-5">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-chalk-500">Meeting objective</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-chalk-200">{objective}</p>
          <p className="mt-2 text-[11px] text-chalk-600">{businessName}</p>
        </div>
      </div>
    </div>
  );
}
