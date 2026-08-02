"use client";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Search, Users2 } from "lucide-react";
import { previewTransferAction, applyTransferAction } from "@/lib/operators/actions";
import type { TransferPreview } from "@/lib/operators/transfer";

export interface TransferRow {
  id: string;
  businessName: string;
  owner: string | null;
  ownerName: string;
  stage: string;
  live: boolean;
}

export interface TransferOperator { id: string; name: string }

/**
 * Move work, deliberately.
 *
 * The shape of this screen is an argument: you pick businesses, you pick a
 * destination, and then you are shown WHAT YOU ARE ABOUT TO DO — every current
 * owner, why they hold it, what it does to both people's days, and what
 * conversations you would be handing over mid-thread. Only then does an Apply
 * button exist.
 *
 * The preview is not a rendering of the selection. It is a server round-trip
 * through the same function the apply runs, so the numbers on screen are the
 * numbers that will be written.
 */
export function TransferPanel({ rows, operators }: { rows: TransferRow[]; operators: TransferOperator[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [to, setTo] = useState<string>(operators[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (ownerFilter === "unassigned" ? r.owner != null : ownerFilter !== "all" && r.owner !== ownerFilter) return false;
      return !q || r.businessName.toLowerCase().includes(q);
    });
  }, [rows, filter, ownerFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPreview(null);
      setResult(null);
      return next;
    });

  const target = to === "__unassigned__" ? null : to;
  const ids = [...selected];

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200">
        <Users2 size={15} className="text-azure-300" /> Move work between operators
      </h2>
      <p className="mt-0.5 text-[11px] text-chalk-500">
        A deliberate transfer is the one path that may move a live conversation, because a person decided it.
        Every change is written to the business&apos;s timeline; nothing overwrites what came before.
      </p>

      {/* ── Choose the businesses ──────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[180px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chalk-600" />
          <input
            className="input !py-1.5 !pl-7 text-xs"
            placeholder="Find a business"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <select className="input !w-auto !py-1.5 text-xs" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">Every owner</option>
          <option value="unassigned">Unassigned</option>
          {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 text-xs"
          onClick={() => {
            setSelected(new Set(visible.map((r) => r.id)));
            setPreview(null);
          }}
        >
          Select all {visible.length}
        </button>
        {selected.size > 0 && (
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => { setSelected(new Set()); setPreview(null); }}>
            Clear
          </button>
        )}
      </div>

      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
        {visible.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-azure-400" />
              <span className="flex-1 truncate text-sm text-chalk-100">{r.businessName}</span>
              {r.live && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">live</span>}
              <span className="text-[11px] text-chalk-500">{r.stage}</span>
              <span className="w-20 shrink-0 text-right text-[11px] text-chalk-500">{r.ownerName}</span>
            </label>
          </li>
        ))}
        {!visible.length && <li className="px-2 py-3 text-sm text-chalk-500">Nothing matches.</li>}
      </ul>

      {/* ── Choose the destination ─────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/5 pt-4">
        <label className="text-[11px] text-chalk-500">
          New owner
          <select className="input mt-1 !w-auto !py-1.5 text-xs" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }}>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="__unassigned__">Unassigned — release</option>
          </select>
        </label>
        <label className="flex-1 min-w-[200px] text-[11px] text-chalk-500">
          Reason (goes on the timeline)
          <input
            className="input mt-1 !py-1.5 text-xs"
            placeholder="Why is this moving?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={pending || !selected.size}
          className="btn-secondary !px-3 !py-1.5 text-xs disabled:opacity-40"
          onClick={() =>
            start(async () => {
              setError(null);
              setResult(null);
              try {
                setPreview(await previewTransferAction(ids, target));
              } catch (e) {
                setError(e instanceof Error ? e.message : "Preview failed.");
              }
            })
          }
        >
          Preview {selected.size || ""} transfer{selected.size === 1 ? "" : "s"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-coral-300">{error}</p>}

      {/* ── What you are about to do ───────────────────────────────────────── */}
      {preview && (
        <div className="mt-4 space-y-3 rounded-lg border border-white/5 bg-white/[0.02] p-4">
          <p className="text-sm text-chalk-100">{preview.summary}</p>

          <div className="space-y-1.5">
            {preview.workloads.map((w) => (
              <p key={w.operatorId} className="font-mono text-[11px] text-chalk-400">
                {w.name.padEnd(10)} owns {w.before.leadsOwned} → {w.after.leadsOwned} · today{" "}
                {w.before.dueToday}/{w.before.capacity} → {w.after.dueToday}/{w.after.capacity} · headroom{" "}
                <span className={w.after.headroom < 0 ? "text-coral-300" : "text-chalk-300"}>
                  {w.before.headroom} → {w.after.headroom}
                </span>
              </p>
            ))}
          </div>

          <ul className="space-y-2">
            {preview.lines.map((l) => (
              <li key={l.leadId} className="rounded-md bg-white/[0.03] p-2.5">
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-chalk-100">
                  {l.businessName}
                  <span className="text-[11px] text-chalk-500">{l.fromName}</span>
                  <ArrowRight size={12} className="text-chalk-600" />
                  <span className="text-[11px] text-azure-200">{l.toName}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-chalk-500">Currently owned because: {l.whyOwned}</p>
                {l.warnings.map((w) => <p key={w} className="mt-0.5 text-[11px] text-amber-300/80">{w}</p>)}
                {l.blocked && <p className="mt-0.5 text-[11px] text-coral-300">Skipped — {l.blocked}</p>}
              </li>
            ))}
          </ul>

          {preview.movable.length > 0 && (
            <button
              type="button"
              disabled={pending}
              className="btn-primary !px-3 !py-1.5 text-xs"
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    const r = await applyTransferAction(ids, target, reason);
                    setResult(
                      r.moved === 0
                        ? "Nothing moved."
                        : `${r.moved} ${r.moved === 1 ? "business" : "businesses"} moved to ${preview.toName}. Every change is on the timeline.`,
                    );
                    setPreview(null);
                    setSelected(new Set());
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Transfer failed.");
                  }
                })
              }
            >
              Move {preview.movable.length} to {preview.toName}
            </button>
          )}
        </div>
      )}

      {result && <p className="mt-3 text-sm text-emerald-300">{result}</p>}
    </section>
  );
}
