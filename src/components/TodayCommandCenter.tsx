"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, CalendarClock, Send, Eye, Video, Loader2, RotateCcw, Mail, AlertTriangle, Clock } from "lucide-react";
import { approveSelectedAction, approveAndScheduleSelectedAction, sendEligibleSelectedNowAction, type LeadResult } from "@/lib/outreach/batch-actions";

export interface FunnelCountsView {
  eligibleNow: number; awaitingVideo: number; rendering: number; failed: number;
  blocked: number; scheduled: number; sentToday: number; remainingCapacity: number;
}
export interface ReadyRow { leadId: string; business: string; recipient: string | null; finding: string | null; videoRequired: boolean; packageState: string; }
export interface VideoRow { leadId: string; business: string; finding: string | null; href: string; }
export interface RenderRow { leadId: string; business: string; state: string; stage: string | null; error: string | null; href: string; }
export interface FollowUpRow { leadId: string; business: string; dueLabel: string; href: string; }
export interface RecentRow { leadId: string; business: string; when: string; tz: string; providerState: string; }

export interface TodayCommandCenterProps {
  counts: FunnelCountsView;
  ready: ReadyRow[];
  needsVoiceover: VideoRow[];
  renderingFailed: RenderRow[];
  followUps: FollowUpRow[];
  recent: RecentRow[];
  windowOpen: boolean;
  nextDateLabel: string;
  sendableNow: number;
  preview?: boolean;
}

const Count = ({ label, value, tone = "text-chalk-200" }: { label: string; value: number; tone?: string }) => (
  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
    <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    <div className="text-[10.5px] uppercase tracking-wide text-chalk-500">{label}</div>
  </div>
);

export function TodayCommandCenter(p: TodayCommandCenterProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<LeadResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const allIds = useMemo(() => p.ready.map((r) => r.leadId), [p.ready]);
  const allSelected = selected.size === allIds.length && allIds.length > 0;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const chosen = [...selected];

  const run = (fn: (ids: string[]) => Promise<{ results: LeadResult[]; scheduledInstead?: string; dateKey?: string }>, label: string) => {
    if (p.preview) { setNote("Disabled in preview."); return; }
    if (!chosen.length) { setNote("Select at least one lead."); return; }
    start(async () => {
      setNote(null); setResults(null);
      const r = await fn(chosen);
      setResults(r.results);
      const ok = r.results.filter((x) => x.ok).length;
      setNote(`${label}: ${ok}/${r.results.length} succeeded${r.scheduledInstead ? ` — scheduled for ${p.nextDateLabel} (outside send window)` : ""}.`);
    });
  };

  return (
    <div className="space-y-6">
      {/* Canonical counts — one reconciled snapshot (mandate VI). No contradictory copy. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        <Count label="Eligible now" value={p.counts.eligibleNow} tone="text-teal-300" />
        <Count label="Awaiting video" value={p.counts.awaitingVideo} tone="text-amber-300" />
        <Count label="Rendering/failed" value={p.counts.rendering + p.counts.failed} />
        <Count label="Blocked" value={p.counts.blocked} />
        <Count label="Scheduled" value={p.counts.scheduled} tone="text-azure-300" />
        <Count label="Sent today" value={p.counts.sentToday} />
        <Count label="Remaining cap" value={p.counts.remainingCapacity} />
      </div>
      <p className="text-[12px] text-chalk-500">next window: <span className="text-chalk-300">{p.nextDateLabel}</span> · {p.windowOpen ? "open now" : "closed — Approve & schedule targets the next window"}</p>

      {/* 1 — READY TO APPROVE AND SCHEDULE */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200"><CircleCheck size={15} className="text-teal-300" /> Ready to approve and schedule ({p.ready.length})</h2>
          {p.ready.length > 0 && <button onClick={selectAll} className="text-[12px] text-gold-300 hover:underline">{allSelected ? "Clear all" : "Select all eligible"}</button>}
        </div>
        {p.ready.length === 0 ? (
          <p className="text-[13px] text-chalk-500">Nothing is eligible to approve right now.</p>
        ) : (
          <>
            <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
              {p.ready.map((r) => (
                <li key={r.leadId} className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={selected.has(r.leadId)} onChange={() => toggle(r.leadId)} className="h-4 w-4 shrink-0 accent-gold-400" aria-label={`Select ${r.business}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><Link href={`/leads/${r.leadId}`} className="truncate text-[14px] text-chalk-100 hover:text-azure-300">{r.business}</Link>{r.videoRequired && <span className="rounded border border-azure-400/25 bg-azure-400/10 px-1 text-[10px] text-azure-300">+ video</span>}</div>
                    <div className="truncate text-[12px] text-chalk-500">{r.recipient ?? "no recipient"}{r.finding ? ` · ${r.finding}` : ""} · pkg {r.packageState}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-chalk-500">{selected.size} selected · sendable now: {p.sendableNow} · next window: {p.nextDateLabel}</span>
              <div className="flex-1" />
              <Link href={`/schedule`} className="btn-ghost text-xs"><Eye size={13} /> Preview selected</Link>
              <button disabled={busy} onClick={() => run(approveSelectedAction as any, "Approve selected")} className="btn-secondary text-xs disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <CircleCheck size={13} />} Approve selected</button>
              <button disabled={busy} onClick={() => run(approveAndScheduleSelectedAction as any, "Approve & schedule")} className="btn-primary text-xs disabled:opacity-40"><CalendarClock size={13} /> Approve & schedule selected</button>
              <button disabled={busy || !p.windowOpen} title={p.windowOpen ? "" : "Outside the send window — use Approve & schedule"} onClick={() => run(sendEligibleSelectedNowAction as any, "Send now")} className="btn-secondary text-xs disabled:opacity-40"><Send size={13} /> Send eligible now</button>
            </div>
            {note && <p className="mt-2 text-[12px] text-chalk-400">{note}</p>}
            {results && (
              <ul className="mt-2 space-y-1 text-[12px]">
                {results.map((r) => (
                  <li key={r.leadId} className={r.ok ? "text-teal-300" : "text-amber-300"}>{r.ok ? "✓" : "✗"} {r.business}{r.reason ? ` — ${r.reason}` : ""}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* 2 — NEEDS YOUR VOICEOVER */}
      {p.needsVoiceover.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-chalk-200"><Video size={15} className="text-amber-300" /> Needs your voiceover ({p.needsVoiceover.length})</h2>
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {p.needsVoiceover.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><div className="truncate text-[14px] text-chalk-100">{r.business}</div><div className="truncate text-[12px] text-chalk-500">{r.finding ?? "prospect video package"}</div></div>
                <Link href={r.href} className="btn-secondary shrink-0 text-xs"><Video size={13} /> Open package</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3 — RENDERING OR FAILED */}
      {p.renderingFailed.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-chalk-200"><Loader2 size={15} className="text-azure-300" /> Rendering or failed ({p.renderingFailed.length})</h2>
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {p.renderingFailed.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><div className="truncate text-[14px] text-chalk-100">{r.business}</div><div className="truncate text-[12px] text-chalk-500">{r.state}{r.stage ? ` · ${r.stage}` : ""}{r.error ? ` · ${r.error}` : ""}</div></div>
                <Link href={r.href} className="btn-ghost shrink-0 text-xs">{r.state === "failed" ? <><RotateCcw size={13} /> Retry</> : <>Open</>}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4 — FOLLOW-UPS DUE */}
      {p.followUps.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-chalk-200"><RotateCcw size={15} className="text-amber-300" /> Follow-ups due ({p.followUps.length})</h2>
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {p.followUps.map((r) => (
              <li key={r.leadId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><div className="truncate text-[14px] text-chalk-100">{r.business}</div><div className="truncate text-[12px] text-chalk-500"><Clock size={11} className="inline" /> {r.dueLabel}</div></div>
                <Link href={r.href} className="btn-ghost shrink-0 text-xs"><Mail size={13} /> Follow up</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5 — RECENTLY SCHEDULED OR SENT */}
      {p.recent.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-chalk-200"><Send size={15} className="text-teal-300" /> Recently scheduled or sent ({p.recent.length})</h2>
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {p.recent.map((r) => (
              <li key={`${r.leadId}-${r.when}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><div className="truncate text-[14px] text-chalk-100">{r.business}</div><div className="truncate text-[12px] text-chalk-500">{r.when} {r.tz}</div></div>
                <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-chalk-400">{r.providerState}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
