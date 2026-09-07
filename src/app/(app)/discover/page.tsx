import { DiscoverClient } from "@/components/DiscoverClient";
import { createManualLeadAction } from "@/lib/actions";
import { placesMode } from "@/lib/providers/places";
import { ARTIFEX_SERVICES } from "@/lib/types";
import { selectTargetMarkets, DEFAULT_MARKET_POLICY, EXCLUDED_MAJOR_MARKETS } from "@/lib/market-policy";

export const dynamic = "force-dynamic";

const INDUSTRIES = ["Dental practice", "Law firm", "Fitness studio", "Home-service company", "Professional consultant", "Specialty retailer", "Financial services"];

const MODE_COPY: Record<string, string> = {
  google: "Live Google Places search. Business data from Google.",
  mock: "Development mode — results are simulated mock data, clearly labeled. Not real businesses.",
  disabled: "Live discovery is disabled: no Google Places API key is configured. No mock results are shown in production.",
};

export default function DiscoverPage() {
  const mode = placesMode();
  return (
    <div className="space-y-6">
      <div>
        <p className="label">Discover</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Find local businesses to understand</h1>
        <p className="mt-1 text-sm text-chalk-400">{MODE_COPY[mode]}</p>
      </div>

      <DiscoverClient initialMode={mode} />

      {/* Targeting markets (mandate 26 §4) — read-only view of WHICH smaller markets automatic discovery is
          deliberately searching next, and WHY. Major metros are excluded by policy. */}
      <TargetingMarketsPanel />

      {/* Manual add — production-safe way to enter a real business */}
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium text-chalk-200">Add a business manually</summary>
        <form action={createManualLeadAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-1"><span className="field-label">Business name *</span><input name="businessName" required className="input" /></label>
          <label className="block"><span className="field-label">Industry</span>
            <select name="industry" className="input">{INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}</select>
          </label>
          <label className="block"><span className="field-label">Website</span><input name="website" placeholder="https://…" className="input" /></label>
          <label className="block"><span className="field-label">Phone</span><input name="phone" className="input" /></label>
          <label className="block"><span className="field-label">Public email</span><input name="publicEmail" className="input" /></label>
          <label className="block"><span className="field-label">City</span><input name="city" className="input" /></label>
          <label className="block"><span className="field-label">State</span><input name="state" className="input" /></label>
          <label className="block"><span className="field-label">Address</span><input name="address" className="input" /></label>
          <label className="block"><span className="field-label">Rating</span><input name="rating" type="number" step="0.1" min="0" max="5" className="input" /></label>
          <label className="block"><span className="field-label">Review count</span><input name="reviewCount" type="number" min="0" className="input" /></label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn-primary">Create lead & open</button>
          </div>
        </form>
        <p className="mt-2 text-[11px] text-chalk-600">Suggested services: {ARTIFEX_SERVICES.slice(0, 3).join(", ")}…</p>
      </details>
    </div>
  );
}

// Read-only "why these markets" panel — the canonical small-market policy, surfaced so the operator can see
// which secondary/tertiary markets discovery is targeting next and why (mandate 26 §4). M27 expands this into
// the full Targeting view.
function TargetingMarketsPanel() {
  const next = selectTargetMarkets({ cursor: 0, count: 6 });
  return (
    <section data-targeting-markets className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="label">Targeting</p>
          <h2 className="mt-0.5 text-base font-semibold text-chalk-100">Next markets being searched</h2>
        </div>
        <span className="rounded-md border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-300">smaller markets by policy</span>
      </div>
      <p className="mt-1 text-[12px] text-chalk-400">
        Discovery deliberately favors economically active <span className="text-chalk-200">secondary &amp; tertiary</span> markets
        (city ~{DEFAULT_MARKET_POLICY.cityPopMin.toLocaleString()}–{DEFAULT_MARKET_POLICY.cityPopMax.toLocaleString()}, metro ~{DEFAULT_MARKET_POLICY.metroPopMin.toLocaleString()}–{DEFAULT_MARKET_POLICY.metroPopMax.toLocaleString()})
        and excludes {EXCLUDED_MAJOR_MARKETS.length} major metros (Los Angeles, New York, Denver, …). Source: {DEFAULT_MARKET_POLICY.popSource}.
      </p>
      <ul className="mt-3 space-y-2">
        {next.map((s) => (
          <li key={`${s.market.city}-${s.market.state}`} data-target-market={`${s.market.city}, ${s.market.state}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-chalk-100">{s.market.city}, {s.market.state}</span>
              <span data-market-tier={s.tier} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-chalk-400">{s.tier} · {s.market.region}</span>
            </div>
            <p data-market-reason className="mt-1 text-[11px] leading-snug text-chalk-500">{s.reasons[0]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
