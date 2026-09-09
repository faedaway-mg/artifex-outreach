// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER RECEIVES MANIFEST (Part H) — renders the ManifestRow[] from
// customerReceivesView / the evidence package. Presentational only, no state, no
// fetch. A MISSING / STALE / UNVERIFIED asset can NEVER render as READY here — the
// row carries the exact status the underlying real binding holds.
// ─────────────────────────────────────────────────────────────────────────────

export interface ManifestRow { key: string; label: string; status: string; detail: string }

const STATUS_META: Record<string, { text: string; cls: string; dot: string }> = {
  READY: { text: "READY", cls: "text-teal-300", dot: "bg-teal-400" },
  MISSING: { text: "MISSING", cls: "text-chalk-500", dot: "bg-chalk-600" },
  STALE: { text: "STALE", cls: "text-amber-300", dot: "bg-amber-400" },
  UNVERIFIED: { text: "UNVERIFIED", cls: "text-amber-300", dot: "bg-amber-400" },
  NOT_APPLICABLE: { text: "N/A", cls: "text-chalk-500", dot: "bg-chalk-700" },
};

export function CustomerReceivesManifest({ rows, title = "What the customer receives" }: { rows: ManifestRow[]; title?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="text-[11px] uppercase tracking-wide text-chalk-500">{title}</div>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => {
          const meta = STATUS_META[r.status] ?? { text: r.status, cls: "text-chalk-400", dot: "bg-chalk-600" };
          return (
            <li key={r.key} className="flex items-start gap-2.5">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-chalk-100">{r.label}</span>
                  <span className={`shrink-0 text-[11px] font-semibold ${meta.cls}`}>{meta.text}</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-chalk-500">{r.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
