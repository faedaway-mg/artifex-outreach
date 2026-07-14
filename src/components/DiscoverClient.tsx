"use client";
import { useState, useTransition } from "react";
import { Search, Table2, Map as MapIcon, Plus, Check, Star, Globe, Phone, AlertTriangle, Radio, FlaskConical, Ban } from "lucide-react";
import { searchPlacesAction, saveLeadFromPlace } from "@/lib/actions";
import type { PlaceResult, PlacesSearchResult, PlacesMode } from "@/lib/providers/places";

const CATEGORIES = ["Dental practice", "Law firm", "Fitness studio", "Home-service company", "Professional consultant", "Specialty retailer"];

function ProviderChip({ mode }: { mode: PlacesMode }) {
  if (mode === "google") return <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"><Radio size={12} /> Live — Google Places</span>;
  if (mode === "disabled") return <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300"><Ban size={12} /> Disabled — API key unavailable</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300"><FlaskConical size={12} /> Development — Mock data</span>;
}

export function DiscoverClient({ initialMode }: { initialMode: PlacesMode }) {
  const [pending, start] = useTransition();
  const [meta, setMeta] = useState<PlacesSearchResult | null>(null);
  const [inputError, setInputError] = useState("");
  const [view, setView] = useState<"table" | "map">("table");
  const [saved, setSaved] = useState<Record<string, "saved" | "dup">>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  const results = meta?.results ?? [];

  function onSearch(formData: FormData) {
    const raw = Object.fromEntries(formData.entries());
    setInputError("");
    start(async () => {
      const res = await searchPlacesAction(raw);
      setMeta(res);
      setSaved({});
      setExcluded({});
    });
  }

  function save(place: PlaceResult) {
    start(async () => {
      const res = await saveLeadFromPlace(place);
      setSaved((s) => ({ ...s, [place.googlePlaceId]: res.duplicate ? "dup" : "saved" }));
    });
  }

  const visible = results.filter((r) => !excluded[r.googlePlaceId]);
  const isMock = meta?.provider === "mock";

  return (
    <div className="space-y-5">
      {/* Provider status */}
      <div className="flex items-center justify-between">
        <ProviderChip mode={meta?.mode ?? initialMode} />
        {meta && (
          <span className="text-[11px] text-chalk-600">
            {meta.provider} · {meta.count} result{meta.count === 1 ? "" : "s"} · {new Date(meta.timestamp).toLocaleTimeString()}
            {meta.filtersApplied ? " · filtered" : ""}{meta.pagination ? " · more available" : ""}
          </span>
        )}
      </div>

      {/* Search form */}
      <form action={onSearch} className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Category *">
            <input name="category" required list="cats" defaultValue="Dental practice" className="input" placeholder="e.g. Dental practice" />
            <datalist id="cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="City"><input name="city" className="input" defaultValue="Los Angeles" /></Field>
          <Field label="State"><input name="state" className="input" defaultValue="CA" /></Field>
          <Field label="ZIP"><input name="postalCode" className="input" placeholder="90012" /></Field>
          <Field label="Keyword"><input name="keyword" className="input" placeholder="optional" /></Field>
          <Field label="Radius (mi)"><input name="radiusMiles" type="number" min={1} max={50} defaultValue={10} className="input" /></Field>
          <Field label="Min rating"><input name="minRating" type="number" min={0} max={5} step={0.1} defaultValue={0} className="input" /></Field>
          <Field label="Min reviews"><input name="minReviews" type="number" min={0} defaultValue={0} className="input" /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-chalk-300"><input type="checkbox" name="requireWebsite" value="true" className="accent-azure-500" /> Has website</label>
          <label className="flex items-center gap-2 text-sm text-chalk-300"><input type="checkbox" name="requirePhone" value="true" className="accent-azure-500" /> Has phone</label>
          <button type="submit" disabled={pending || (meta?.mode ?? initialMode) === "disabled"} className="btn-primary ml-auto">
            <Search size={16} /> {pending ? "Searching…" : "Search"}
          </button>
        </div>
        {inputError && <p className="mt-2 text-xs text-red-300">{inputError}</p>}
      </form>

      {/* Error banner — explicit, no mock substitution */}
      {meta && !meta.success && meta.error && (
        <div className="card border-red-500/30 bg-red-500/[0.04] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-200">
                {meta.mode === "disabled"
                  ? "Live discovery is disabled — no Google Places API key is configured."
                  : "Google Places could not complete this search. No mock results were substituted."}
              </p>
              <p className="mt-1 text-xs text-chalk-400">{meta.error.message}</p>
              {(meta.error.httpStatus || meta.error.googleStatus) && (
                <p className="mt-1 font-mono text-[11px] text-chalk-500">
                  provider={meta.error.provider}
                  {meta.error.httpStatus ? ` · http=${meta.error.httpStatus}` : ""}
                  {meta.error.googleStatus ? ` · google=${meta.error.googleStatus}` : ""}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mock banner */}
      {isMock && meta?.success && (
        <div className="card border-amber-400/30 bg-amber-400/[0.04] p-3">
          <p className="flex items-center gap-2 text-xs text-amber-200">
            <FlaskConical size={14} /> These are <strong>mock</strong> businesses for development — every name is prefixed <span className="font-mono">[MOCK]</span>. Not real Google results.
          </p>
        </div>
      )}

      {/* Results */}
      {meta?.success && results.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-chalk-500">
              {visible.length} shown · <span className="uppercase">{meta.provider}</span> · {meta.attribution}
            </p>
            <div className="flex rounded-lg border border-white/10 p-0.5">
              <button onClick={() => setView("table")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "table" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><Table2 size={13} /> Table</button>
              <button onClick={() => setView("map")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "map" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><MapIcon size={13} /> Map</button>
            </div>
          </div>

          {view === "table" ? (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Business</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">Signals</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.googlePlaceId} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-chalk-100">{r.businessName}</p>
                        <p className="text-xs text-chalk-500">{r.address || `${r.city}, ${r.state}`}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-chalk-200"><Star size={12} className="text-amber-400" /> {r.rating ?? "—"}</span>
                        <span className="text-xs text-chalk-500">{r.reviewCount ?? 0} reviews</span>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <div className="flex gap-2 text-chalk-500">
                          {r.website && <Globe size={14} className="text-azure-400" />}
                          {r.phone && <Phone size={14} className="text-indigo-400" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <SaveCell state={saved[r.googlePlaceId]} onSave={() => save(r)} onExclude={() => setExcluded((e) => ({ ...e, [r.googlePlaceId]: true }))} pending={pending} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <MapView results={visible} onSave={save} saved={saved} />
          )}
        </div>
      )}

      {/* Zero matches (real search, no results) */}
      {meta?.success && meta.provider === "google" && results.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-chalk-300">0 Google Places results matched these filters.</p>
          <p className="mt-1 text-xs text-chalk-500">No mock results were substituted. Try loosening the rating/review filters.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function SaveCell({ state, onSave, onExclude, pending }: { state?: "saved" | "dup"; onSave: () => void; onExclude: () => void; pending: boolean }) {
  if (state === "saved") return <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={13} /> Saved</span>;
  if (state === "dup") return <span className="text-xs text-amber-300">Already a lead</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={onExclude} className="btn-ghost !px-2 !py-1 text-xs">Exclude</button>
      <button onClick={onSave} disabled={pending} className="btn-secondary !px-3 !py-1 text-xs"><Plus size={13} /> Save</button>
    </div>
  );
}

function MapView({ results, onSave, saved }: { results: PlaceResult[]; onSave: (p: PlaceResult) => void; saved: Record<string, "saved" | "dup"> }) {
  const lats = results.map((r) => r.latitude ?? 34).filter(Boolean);
  const lngs = results.map((r) => r.longitude ?? -118).filter(Boolean);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const x = (lng: number) => (maxLng === minLng ? 50 : ((lng - minLng) / (maxLng - minLng)) * 90 + 5);
  const y = (lat: number) => (maxLat === minLat ? 50 : (1 - (lat - minLat) / (maxLat - minLat)) * 90 + 5);
  return (
    <div className="card relative aspect-[16/9] overflow-hidden bg-grid-faint">
      {results.map((r) => (
        <div key={r.googlePlaceId} className="group absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(r.longitude ?? -118)}%`, top: `${y(r.latitude ?? 34)}%` }}>
          <button onClick={() => onSave(r)} className={`h-3 w-3 rounded-full ring-4 transition ${saved[r.googlePlaceId] ? "bg-emerald-400 ring-emerald-400/20" : "bg-azure-400 ring-azure-400/20 hover:scale-125"}`} />
          <div className="pointer-events-none absolute left-4 top-0 z-10 hidden whitespace-nowrap rounded-lg border border-white/10 bg-ink-800 px-2 py-1 text-xs text-chalk-200 group-hover:block">
            {r.businessName} · {r.rating ?? "—"}★
          </div>
        </div>
      ))}
      <p className="absolute bottom-2 left-3 text-[10px] text-chalk-600">Tap a marker to save · scatter fallback map</p>
    </div>
  );
}
