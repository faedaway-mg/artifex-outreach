"use client";
import { useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY FEED (Part L) — one honest, classified feed. DEFAULT filter = Quick-Cash.
// Legacy scheduled/outreach records render as "LEGACY — FROZEN" and are NEVER shown
// as active Quick-Cash scheduled sends. Filters: All / Quick-Cash / Fulfillment /
// Customer / Legacy-Frozen. History is preserved, never deleted. No sends, no fetch
// that mutates — this is a read-only surface with client-side filtering.
// ─────────────────────────────────────────────────────────────────────────────

type Category = "QUICK_CASH" | "FULFILLMENT" | "CUSTOMER" | "LEGACY_FROZEN";
type Filter = "ALL" | Category;

export interface ActivityItem {
  id: string;
  category: Category;
  frozen: boolean;
  action: string;
  label: string;
  actor: string;
  at: string;
  offerId: string | null;
  leadId: string | null;
}

const TABS: Array<{ key: Filter; label: string }> = [
  { key: "QUICK_CASH", label: "Quick-Cash" },
  { key: "ALL", label: "All" },
  { key: "FULFILLMENT", label: "Fulfillment" },
  { key: "CUSTOMER", label: "Customer" },
  { key: "LEGACY_FROZEN", label: "Legacy-Frozen" },
];

const CAT_META: Record<Category, { text: string; cls: string }> = {
  QUICK_CASH: { text: "QUICK-CASH", cls: "bg-azure-500/15 text-azure-300" },
  FULFILLMENT: { text: "FULFILLMENT", cls: "bg-teal-500/15 text-teal-300" },
  CUSTOMER: { text: "CUSTOMER", cls: "bg-teal-500/15 text-teal-200" },
  LEGACY_FROZEN: { text: "LEGACY — FROZEN", cls: "bg-chalk-600/20 text-chalk-400" },
};

export function ActivityFeed({ items, counts, initialFilter = "QUICK_CASH" }: { items: ActivityItem[]; counts: Record<Category, number>; initialFilter?: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const shown = useMemo(() => (filter === "ALL" ? items : items.filter((i) => i.category === filter)), [items, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const n = t.key === "ALL" ? items.length : counts[t.key as Category];
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-full px-3 py-1 text-[12px] ${active ? "bg-white/10 text-chalk-100" : "border border-white/10 text-chalk-400 hover:bg-white/5"}`}
            >
              {t.label} <span className="text-chalk-500">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-chalk-500">No activity in this view.</div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((it) => {
            const meta = CAT_META[it.category];
            return (
              <li key={it.id} className={`card p-3 ${it.frozen ? "opacity-70" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-chalk-100">{it.label}</div>
                    <div className="mt-0.5 text-[11px] text-chalk-500">{it.actor} · {new Date(it.at).toLocaleString()}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>{meta.text}</span>
                </div>
                {it.offerId && it.category !== "LEGACY_FROZEN" && (
                  <a href={`/revenue/opportunity/${it.offerId}`} className="mt-1.5 inline-block text-[11.5px] text-azure-300 hover:text-azure-200">Open opportunity →</a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
