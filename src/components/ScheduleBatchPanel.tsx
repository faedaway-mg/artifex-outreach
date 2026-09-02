"use client";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, Check, X, AlertTriangle, Ban } from "lucide-react";
import { scheduleNextEligibleBatchAction, cancelScheduledAction } from "@/lib/outreach/schedule-actions";

type Item = { leadId: string; business: string; recipient: string; subject: string; pdfFilename: string; revisionId: string; proposedAt: string };
type Scheduled = { leadId: string; business: string; recipient: string; scheduledAt: string; batchId: string; pdfSha256: string };
type NotReady = { leadId: string; business: string; reason: string };
type Receipt = { batchId: string; authorized: number; removed: number; scheduled: Array<{ leadId: string; recipient: string; scheduledAt: string }>; removedItems: Array<{ leadId: string; reason: string }> };

const laTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });

export function ScheduleBatchPanel({ eligible, scheduled, notReady, window, dateKey }: { eligible: Item[]; scheduled: Scheduled[]; notReady: NotReady[]; window: { tz: string; startHour: number; endHour: number }; dateKey: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((e) => e.leadId)));
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, start] = useTransition();
  const allSelected = selected.size === eligible.length && eligible.length > 0;
  const selectedItems = useMemo(() => eligible.filter((e) => selected.has(e.leadId)), [eligible, selected]);
  const dateLabel = new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(eligible.map((e) => e.leadId)));

  function confirmSchedule() {
    start(async () => {
      const res = await scheduleNextEligibleBatchAction([...selected]);
      setReceipt({ batchId: res.batchId, authorized: res.scheduled.length, removed: res.removed.length, scheduled: res.scheduled.map((s) => ({ leadId: s.leadId, recipient: s.recipient, scheduledAt: s.scheduledAt })), removedItems: res.removed });
      setConfirming(false);
    });
  }
  function cancelOne(leadId: string) { start(async () => { await cancelScheduledAction(leadId); }); }

  return (
    <div className="space-y-5">
      {/* Persistent delivery-blocked banner — never implies these will be delivered. */}
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-200">
        <Ban size={15} className="shrink-0" /> <span><b>Delivery blocked — approved transport required.</b> Scheduling prepares + authorizes a batch; nothing will send until a provider with written permission for this outreach is configured.</span>
      </div>

      {/* Receipt (after confirm) */}
      {receipt && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-chalk-50"><Check size={16} className="text-emerald-300" /> Scheduled — batch {receipt.batchId}</div>
          <div className="mt-2 text-[13px] text-chalk-300">{receipt.authorized} authorized · {receipt.removed} removed · {dateLabel} · {String(window.startHour).padStart(2, "0")}:00–{String(window.endHour).padStart(2, "0")}:00 {window.tz} · <span className="text-amber-300">Delivery blocked</span></div>
          <ul className="mt-3 space-y-1.5">
            {receipt.scheduled.map((s) => (
              <li key={s.leadId} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-chalk-200">{s.recipient}</span>
                <span className="shrink-0 tabular-nums text-chalk-400">{laTime(s.scheduledAt)} PT</span>
              </li>
            ))}
          </ul>
          {receipt.removedItems.length > 0 && <div className="mt-3 text-[12px] text-chalk-500">Removed at confirm (no longer eligible): {receipt.removedItems.map((r) => r.reason).join("; ")}</div>}
        </div>
      )}

      {/* Already-scheduled items (with per-message cancel) */}
      {scheduled.length > 0 && (
        <section>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chalk-500">Scheduled ({scheduled.length}) — {dateLabel}</div>
          <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10">
            {scheduled.map((s) => (
              <li key={s.leadId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0"><div className="truncate text-[14px] text-chalk-100">{s.business}</div><div className="truncate text-[12px] text-chalk-500">{s.recipient} · {laTime(s.scheduledAt)} PT · batch {s.batchId}</div></div>
                <button disabled={pending} onClick={() => cancelOne(s.leadId)} className="shrink-0 text-[12px] text-chalk-400 hover:text-rose-300 disabled:opacity-50"><X size={13} className="inline" /> Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Eligible list — select all / individual */}
      <section>
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chalk-500">Eligible to schedule ({eligible.length})</div>
          {eligible.length > 0 && <button onClick={toggleAll} className="text-[12px] text-gold-300 hover:underline">{allSelected ? "Clear all" : "Select all"}</button>}
        </div>
        {eligible.length === 0 ? (
          <p className="mt-2 text-[13px] text-chalk-500">No SENDABLE messages are eligible to schedule right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10">
            {eligible.map((e) => (
              <li key={e.leadId} className="flex items-center gap-3 px-3 py-2.5">
                <input type="checkbox" checked={selected.has(e.leadId)} onChange={() => toggle(e.leadId)} className="h-4 w-4 shrink-0 accent-gold-400" aria-label={`Select ${e.business}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-chalk-100">{e.business}</div>
                  <div className="truncate text-[12px] text-chalk-500">{e.recipient} · {e.subject} · {e.pdfFilename} · rev {e.revisionId.slice(0, 10)}</div>
                </div>
                <span className="shrink-0 tabular-nums text-[12px] text-chalk-400">{laTime(e.proposedAt)} PT</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Not ready (with reasons) */}
      {notReady.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-chalk-500"><AlertTriangle size={12} /> Not ready / removed ({notReady.length})</div>
          <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10">
            {notReady.map((n) => (
              <li key={n.leadId} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"><span className="truncate text-chalk-300">{n.business}</span><span className="shrink-0 text-[12px] text-chalk-500">{n.reason}</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* Confirm action */}
      {!confirming ? (
        <button disabled={pending || selectedItems.length === 0} onClick={() => setConfirming(true)} className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-50">
          <CalendarClock size={17} /> Schedule {selectedItems.length} email{selectedItems.length === 1 ? "" : "s"} for {dateLabel}
        </button>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3.5">
          <div className="text-[13px] text-chalk-200">Schedule <b>{selectedItems.length}</b> email{selectedItems.length === 1 ? "" : "s"} for <b>{dateLabel}</b>, staggered {String(window.startHour).padStart(2, "0")}:00–{String(window.endHour).padStart(2, "0")}:00 {window.tz}. Eligibility is re-checked now; ineligible items are removed. <span className="text-amber-300">Nothing will be delivered (transport required).</span></div>
          <div className="mt-3 flex gap-2">
            <button disabled={pending} onClick={confirmSchedule} className="btn-primary flex-1 justify-center !py-2.5 disabled:opacity-50"><Check size={15} /> {pending ? "Scheduling…" : `Schedule these ${selectedItems.length}`}</button>
            <button disabled={pending} onClick={() => setConfirming(false)} className="btn-secondary justify-center !py-2.5">Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
