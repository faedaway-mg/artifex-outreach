import { DiscoverClient } from "@/components/DiscoverClient";
import { createManualLeadAction } from "@/lib/actions";
import { placesMode } from "@/lib/providers/places";
import { ARTIFEX_SERVICES } from "@/lib/types";

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
